import { ERROR_CODES, permissionsForRole, type MeResponse } from '@gms/shared';
import { eq, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { AppError, validationFailed } from '../../lib/errors';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../lib/passwords';
import type { RequestContext } from '../../lib/request-context';
import { getGymName } from '../settings/settings.service';
import {
  createSession,
  revokeSession,
  revokeUserSessions,
  type NewSession,
} from './session.service';

/** One message for every login failure, so responses never reveal whether an account exists. */
const invalidCredentials = () =>
  new AppError(
    401,
    ERROR_CODES.INVALID_CREDENTIALS,
    'Incorrect email or password, or the account is temporarily locked.',
  );

type FailureReason = 'UNKNOWN_ACCOUNT' | 'BAD_PASSWORD' | 'ACCOUNT_LOCKED' | 'ACCOUNT_INACTIVE';

async function auditLoginFailure(
  ctx: RequestContext,
  reason: FailureReason,
  userId: string | null,
  email: string,
) {
  await recordAudit(db, ctx, {
    action: 'LOGIN_FAILED',
    entityType: 'USER',
    entityId: userId,
    after: { reason, email },
  });
}

export async function login(
  email: string,
  password: string,
  ctx: RequestContext,
): Promise<NewSession> {
  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    await burnPasswordCheck(password);
    await auditLoginFailure(ctx, 'UNKNOWN_ACCOUNT', null, email);
    throw invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await burnPasswordCheck(password);
    await auditLoginFailure(ctx, 'ACCOUNT_LOCKED', user.id, email);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    await registerFailedAttempt(user.id, email, ctx);
    throw invalidCredentials();
  }

  if (!user.isActive) {
    await auditLoginFailure(ctx, 'ACCOUNT_INACTIVE', user.id, email);
    throw invalidCredentials();
  }

  return db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));
    const session = await createSession(tx, user.id, { ip: ctx.ip, userAgent: ctx.userAgent });
    await recordAudit(
      tx,
      { ...ctx, actorUserId: user.id, actorRole: user.role },
      {
        action: 'LOGIN_SUCCEEDED',
        entityType: 'USER',
        entityId: user.id,
      },
    );
    return session;
  });
}

async function registerFailedAttempt(userId: string, email: string, ctx: RequestContext) {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(users)
      .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
      .where(eq(users.id, userId))
      .returning({ failedLoginCount: users.failedLoginCount });

    await recordAudit(tx, ctx, {
      action: 'LOGIN_FAILED',
      entityType: 'USER',
      entityId: userId,
      after: { reason: 'BAD_PASSWORD', email },
    });

    if (updated && updated.failedLoginCount >= config.accountLockoutThreshold) {
      const lockedUntil = new Date(Date.now() + config.accountLockoutMinutes * 60_000);
      await tx.update(users).set({ failedLoginCount: 0, lockedUntil }).where(eq(users.id, userId));
      await recordAudit(tx, ctx, {
        action: 'ACCOUNT_LOCKED',
        entityType: 'USER',
        entityId: userId,
        after: { lockedUntil, failedAttempts: updated.failedLoginCount },
      });
    }
  });
}

export async function logout(auth: Express.AuthContext, ctx: RequestContext) {
  await db.transaction(async (tx) => {
    await revokeSession(tx, auth.sessionId);
    await recordAudit(tx, ctx, { action: 'LOGOUT', entityType: 'USER', entityId: auth.user.id });
  });
}

export async function me(auth: Express.AuthContext): Promise<MeResponse> {
  const { user } = auth;
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    },
    permissions: permissionsForRole(user.role),
    csrfToken: auth.csrfToken,
    gym: { name: await getGymName() },
  };
}

/** Changing the password ends every other session of this user. */
export async function changePassword(
  auth: Express.AuthContext,
  currentPassword: string,
  newPassword: string,
  ctx: RequestContext,
) {
  const [row] = await db
    .select({ passwordHash: users.passwordHash, email: users.email })
    .from(users)
    .where(eq(users.id, auth.user.id))
    .limit(1);
  if (!row || !(await verifyPassword(row.passwordHash, currentPassword))) {
    throw validationFailed([{ path: 'currentPassword', message: 'Current password is incorrect' }]);
  }
  if (await verifyPassword(row.passwordHash, newPassword)) {
    throw validationFailed([
      { path: 'newPassword', message: 'Choose a password you have not just used' },
    ]);
  }
  const emailName = row.email.split('@')[0]!.toLowerCase();
  if (emailName.length >= 4 && newPassword.toLowerCase().includes(emailName)) {
    throw validationFailed([
      { path: 'newPassword', message: 'Do not include your email name in the password' },
    ]);
  }

  const passwordHash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, auth.user.id));
    await revokeUserSessions(tx, auth.user.id, auth.sessionId);
    await recordAudit(tx, ctx, {
      action: 'PASSWORD_CHANGED',
      entityType: 'USER',
      entityId: auth.user.id,
      after: { otherSessionsRevoked: true },
    });
  });
}
