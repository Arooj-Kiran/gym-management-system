import { and, eq, isNull, ne } from 'drizzle-orm';
import { config } from '../../config/env';
import { db, type DbExecutor } from '../../db/client';
import { userSessions, users } from '../../db/schema';
import { randomToken, sha256Hex } from '../../lib/tokens';

const TOUCH_INTERVAL_MS = 60_000;

export interface NewSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  executor: DbExecutor,
  userId: string,
  client: { ip: string | null; userAgent: string | null },
): Promise<NewSession> {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3_600_000);
  await executor.insert(userSessions).values({
    tokenHash: sha256Hex(token),
    userId,
    csrfToken,
    expiresAt,
    ip: client.ip,
    userAgent: client.userAgent,
  });
  return { token, csrfToken, expiresAt };
}

/**
 * Resolve a raw cookie token to a live session. Revoked, expired (absolute or idle) sessions and
 * deactivated users resolve to null; stale sessions are revoked as a side effect.
 */
export async function resolveSession(token: string): Promise<Express.AuthContext | null> {
  const [row] = await db
    .select({
      sessionId: userSessions.id,
      csrfToken: userSessions.csrfToken,
      expiresAt: userSessions.expiresAt,
      lastSeenAt: userSessions.lastSeenAt,
      revokedAt: userSessions.revokedAt,
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.tokenHash, sha256Hex(token)))
    .limit(1);

  if (!row || row.revokedAt) return null;

  const now = Date.now();
  const idleDeadline = row.lastSeenAt.getTime() + config.sessionIdleMinutes * 60_000;
  if (row.expiresAt.getTime() <= now || idleDeadline <= now || !row.isActive) {
    await revokeSession(db, row.sessionId);
    return null;
  }

  if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(userSessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(userSessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    csrfToken: row.csrfToken,
    user: {
      id: row.userId,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt,
    },
  };
}

export async function revokeSession(executor: DbExecutor, sessionId: string) {
  await executor
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)));
}

/** Revoke every live session of a user, optionally keeping the caller's current session. */
export async function revokeUserSessions(
  executor: DbExecutor,
  userId: string,
  exceptSessionId?: string,
) {
  await executor
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessions.userId, userId),
        isNull(userSessions.revokedAt),
        exceptSessionId ? ne(userSessions.id, exceptSessionId) : undefined,
      ),
    );
}
