import {
  ERROR_CODES,
  STAFF_ROLES,
  type StaffDto,
  type StaffRole,
  type createStaffSchema,
  type staffListQuerySchema,
  type updateStaffSchema,
} from '@gms/shared';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { staffProfiles, userPublicColumns, users } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, notFound } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import { hashPassword } from '../../lib/passwords';
import type { RequestContext } from '../../lib/request-context';
import { revokeUserSessions } from '../auth/session.service';

type CreateStaff = z.output<typeof createStaffSchema>;
type UpdateStaff = z.output<typeof updateStaffSchema>;
type StaffListQuery = z.output<typeof staffListQuerySchema>;

const staffColumns = {
  ...userPublicColumns,
  jobTitle: staffProfiles.jobTitle,
  hireDate: staffProfiles.hireDate,
  notes: staffProfiles.notes,
};

const isStaffAccount = inArray(users.role, [...STAFF_ROLES]);

function toDto(row: Awaited<ReturnType<typeof findStaffRow>> & object): StaffDto {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    role: row.role as StaffRole,
    isActive: row.isActive,
    isLocked: !!row.lockedUntil && row.lockedUntil.getTime() > Date.now(),
    mustChangePassword: row.mustChangePassword,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    jobTitle: row.jobTitle,
    hireDate: row.hireDate,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findStaffRow(executor: DbExecutor, id: string, forUpdate = false) {
  const query = executor
    .select(staffColumns)
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .where(and(eq(users.id, id), isStaffAccount))
    .limit(1);
  const [row] = forUpdate ? await query.for('update', { of: users }) : await query;
  return row;
}

async function requireStaffRow(executor: DbExecutor, id: string, forUpdate = false) {
  const row = await findStaffRow(executor, id, forUpdate);
  if (!row) throw notFound('Staff member');
  return row;
}

const duplicateEmail = () =>
  conflict(ERROR_CODES.DUPLICATE_EMAIL, 'Another account already uses this email address.');

function rethrowDuplicateEmail(error: unknown): never {
  if (isUniqueViolation(error, 'users_email_key')) throw duplicateEmail();
  throw error;
}

const SORT_COLUMNS = {
  name: [users.lastName, users.firstName],
  email: [users.email],
  role: [users.role, users.lastName],
  createdAt: [users.createdAt],
  lastLoginAt: [users.lastLoginAt],
} as const;

export async function listStaff(query: StaffListQuery) {
  const filters: (SQL | undefined)[] = [isStaffAccount];
  if (query.role) filters.push(eq(users.role, query.role));
  if (query.status) filters.push(eq(users.isActive, query.status === 'active'));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(
        ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, pattern),
        ilike(users.email, pattern),
        ilike(staffProfiles.jobTitle, pattern),
      ),
    );
  }
  const where = and(...filters);
  const direction = (query.order ?? 'asc') === 'asc' ? asc : desc;
  const orderBy = SORT_COLUMNS[query.sort].map((column) =>
    column === users.lastLoginAt ? sql`${direction(column)} nulls last` : direction(column),
  );

  const [rows, [totals]] = await Promise.all([
    db
      .select(staffColumns)
      .from(users)
      .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
      .where(where)
      .orderBy(...orderBy, asc(users.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(users)
      .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
      .where(where),
  ]);
  return paginated(rows.map(toDto), query.page, query.pageSize, totals?.total ?? 0);
}

export async function getStaff(id: string): Promise<StaffDto> {
  return toDto(await requireStaffRow(db, id));
}

export async function createStaff(input: CreateStaff, ctx: RequestContext): Promise<StaffDto> {
  const passwordHash = await hashPassword(input.temporaryPassword);
  try {
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          role: input.role,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      await tx.insert(staffProfiles).values({
        userId: user!.id,
        jobTitle: input.jobTitle,
        hireDate: input.hireDate,
        notes: input.notes,
      });
      const created = await requireStaffRow(tx, user!.id);
      const { temporaryPassword: _secret, ...auditable } = input;
      await recordAudit(tx, ctx, {
        action: 'STAFF_CREATED',
        entityType: 'USER',
        entityId: created.id,
        after: auditable,
      });
      return toDto(created);
    });
  } catch (error) {
    rethrowDuplicateEmail(error);
  }
}

export async function updateStaff(
  id: string,
  input: UpdateStaff,
  ctx: RequestContext,
): Promise<StaffDto> {
  try {
    return await db.transaction(async (tx) => {
      const current = await requireStaffRow(tx, id, true);
      const diff = diffFields(current, input);
      if (!diff.changed) return toDto(current);

      const { email, firstName, lastName, phone, jobTitle, hireDate, notes } =
        diff.after as UpdateStaff;
      const userChanges = { email, firstName, lastName, phone };
      if (Object.values(userChanges).some((value) => value !== undefined)) {
        await tx.update(users).set(userChanges).where(eq(users.id, id));
      }
      const profileChanges = { jobTitle, hireDate, notes };
      if (Object.values(profileChanges).some((value) => value !== undefined)) {
        await tx
          .insert(staffProfiles)
          .values({ userId: id, ...profileChanges })
          .onConflictDoUpdate({ target: staffProfiles.userId, set: profileChanges });
      }
      await recordAudit(tx, ctx, {
        action: 'STAFF_UPDATED',
        entityType: 'USER',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
      return toDto(await requireStaffRow(tx, id));
    });
  } catch (error) {
    rethrowDuplicateEmail(error);
  }
}

function refuseSelf(id: string, ctx: RequestContext, action: string) {
  if (id === ctx.actorUserId) {
    throw conflict(ERROR_CODES.SELF_ACTION_NOT_ALLOWED, `You cannot ${action} your own account.`);
  }
}

/** Locks the active admin rows so two admins cannot demote or deactivate each other at once. */
async function assertAnotherActiveAdmin(tx: DbExecutor, excludingId: string) {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), ne(users.id, excludingId)))
    .for('update');
  if (admins.length === 0) {
    throw conflict(ERROR_CODES.LAST_ADMIN, 'The gym must keep at least one active Admin.');
  }
}

export async function changeRole(
  id: string,
  role: StaffRole,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<StaffDto> {
  refuseSelf(id, ctx, 'change the role of');
  return db.transaction(async (tx) => {
    const current = await requireStaffRow(tx, id, true);
    if (current.role === role) return toDto(current);
    if (current.role === 'ADMIN' && current.isActive) await assertAnotherActiveAdmin(tx, id);

    await tx.update(users).set({ role }).where(eq(users.id, id));
    await recordAudit(tx, ctx, {
      action: 'ROLE_CHANGED',
      entityType: 'USER',
      entityId: id,
      before: { role: current.role },
      after: { role },
      reason,
    });
    return toDto(await requireStaffRow(tx, id));
  });
}

export async function setActive(
  id: string,
  isActive: boolean,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<StaffDto> {
  if (!isActive) refuseSelf(id, ctx, 'deactivate');
  return db.transaction(async (tx) => {
    const current = await requireStaffRow(tx, id, true);
    if (current.isActive === isActive) return toDto(current);
    if (!isActive && current.role === 'ADMIN') await assertAnotherActiveAdmin(tx, id);

    await tx
      .update(users)
      .set(isActive ? { isActive, failedLoginCount: 0, lockedUntil: null } : { isActive })
      .where(eq(users.id, id));
    if (!isActive) await revokeUserSessions(tx, id);
    await recordAudit(tx, ctx, {
      action: isActive ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED',
      entityType: 'USER',
      entityId: id,
      before: { isActive: current.isActive },
      after: { isActive, ...(isActive ? {} : { sessionsRevoked: true }) },
      reason,
    });
    return toDto(await requireStaffRow(tx, id));
  });
}

/** Sets an admin-chosen temporary password, forces a change at next sign-in, ends all sessions. */
export async function resetPassword(id: string, temporaryPassword: string, ctx: RequestContext) {
  refuseSelf(id, ctx, 'reset the password of');
  const passwordHash = await hashPassword(temporaryPassword);
  return db.transaction(async (tx) => {
    await requireStaffRow(tx, id, true);
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, id));
    await revokeUserSessions(tx, id);
    await recordAudit(tx, ctx, {
      action: 'STAFF_PASSWORD_RESET',
      entityType: 'USER',
      entityId: id,
      // Key names avoid "password" on purpose: stripSecrets would drop them.
      after: { changeRequiredAtNextSignIn: true, sessionsRevoked: true },
    });
    return toDto(await requireStaffRow(tx, id));
  });
}
