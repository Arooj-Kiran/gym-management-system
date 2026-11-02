import {
  ERROR_CODES,
  permissionScope,
  SCOPES,
  SHIFT_LIMITS,
  type ShiftDto,
  type StaffRole,
  type createShiftSchema,
  type shiftListQuerySchema,
  type updateShiftSchema,
} from '@gms/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { staffShifts, users } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { isExclusionViolation } from '../../lib/db-errors';
import { conflict, forbidden, notFound, validationFailed } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import { gymDateWindow } from '../trainers/trainers.service';

type CreateShift = z.output<typeof createShiftSchema>;
type UpdateShift = z.output<typeof updateShiftSchema>;
type ShiftListQuery = z.output<typeof shiftListQuerySchema>;
type Auth = Express.AuthContext;

const HOUR_MS = 3_600_000;

function selectShifts(executor: DbExecutor = db) {
  return executor
    .select({
      shift: staffShifts,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(staffShifts)
    .innerJoin(users, eq(users.id, staffShifts.userId));
}

type ShiftRow = Awaited<ReturnType<typeof selectShifts>>[number];

function toDto(row: ShiftRow): ShiftDto {
  return {
    id: row.shift.id,
    userId: row.shift.userId,
    staffName: `${row.firstName} ${row.lastName}`,
    role: row.role as StaffRole,
    startsAt: row.shift.startsAt.toISOString(),
    endsAt: row.shift.endsAt.toISOString(),
    roleNote: row.shift.roleNote,
    status: row.shift.status,
    createdAt: row.shift.createdAt.toISOString(),
  };
}

async function readShift(executor: DbExecutor, id: string): Promise<ShiftDto> {
  const [row] = await selectShifts(executor).where(eq(staffShifts.id, id)).limit(1);
  if (!row) throw notFound('Shift');
  return toDto(row);
}

/** Receptionists and trainers read their own shifts only (PLAN §5 schedules:read OWN). */
export async function listShifts(query: ShiftListQuery, auth: Auth): Promise<ShiftDto[]> {
  const own = permissionScope(auth.user.role, 'schedules:read') === SCOPES.OWN;
  if (own && query.userId && query.userId !== auth.user.id) {
    throw forbidden('You can only see your own shifts.');
  }
  const userId = own ? auth.user.id : query.userId;
  const window = gymDateWindow(query.from, query.to);
  const rows = await selectShifts()
    .where(
      and(
        userId ? eq(staffShifts.userId, userId) : undefined,
        query.includeCancelled ? undefined : eq(staffShifts.status, 'SCHEDULED'),
        sql`${staffShifts.startsAt} < ${window.endsAt.toISOString()}::timestamptz`,
        sql`${staffShifts.endsAt} > ${window.startsAt.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(staffShifts.startsAt), asc(users.firstName));
  return rows.map(toDto);
}

/** Shifts are for active staff accounts only. */
async function requireStaff(executor: DbExecutor, userId: string) {
  const [user] = await executor
    .select({ role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.role === 'MEMBER') throw notFound('Staff member');
  if (!user.isActive) {
    throw validationFailed([{ path: 'userId', message: 'This staff account is deactivated' }]);
  }
}

const overlapError = () =>
  conflict(ERROR_CODES.SHIFT_OVERLAP, 'This staff member already has a shift at that time.');

export async function createShift(input: CreateShift, ctx: RequestContext): Promise<ShiftDto> {
  try {
    return await db.transaction(async (tx) => {
      await requireStaff(tx, input.userId);
      const [row] = await tx
        .insert(staffShifts)
        .values({
          userId: input.userId,
          startsAt: new Date(input.startsAt),
          endsAt: new Date(input.endsAt),
          roleNote: input.roleNote,
          createdBy: ctx.actorUserId,
        })
        .returning({ id: staffShifts.id });
      await recordAudit(tx, ctx, {
        action: 'SHIFT_CREATED',
        entityType: 'STAFF_SHIFT',
        entityId: row!.id,
        after: { userId: input.userId, startsAt: input.startsAt, endsAt: input.endsAt },
      });
      return readShift(tx, row!.id);
    });
  } catch (error) {
    if (isExclusionViolation(error, 'staff_shifts_no_overlap')) throw overlapError();
    throw error;
  }
}

export async function updateShift(
  id: string,
  input: UpdateShift,
  ctx: RequestContext,
): Promise<ShiftDto> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(staffShifts)
        .where(eq(staffShifts.id, id))
        .for('update')
        .limit(1);
      if (!row) throw notFound('Shift');
      if (row.status !== 'SCHEDULED') {
        throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This shift is cancelled.');
      }
      const startsAt = input.startsAt ? new Date(input.startsAt) : row.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : row.endsAt;
      const span = endsAt.getTime() - startsAt.getTime();
      if (span <= 0) {
        throw validationFailed([{ path: 'endsAt', message: 'Must be after the start' }]);
      }
      if (span > SHIFT_LIMITS.maxHours * HOUR_MS) {
        throw validationFailed([
          { path: 'endsAt', message: `A shift can last at most ${SHIFT_LIMITS.maxHours} hours` },
        ]);
      }
      const changes = {
        startsAt,
        endsAt,
        ...(input.roleNote !== undefined ? { roleNote: input.roleNote } : {}),
      };
      await tx.update(staffShifts).set(changes).where(eq(staffShifts.id, id));
      const diff = diffFields(
        {
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          roleNote: row.roleNote,
        },
        {
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          ...(input.roleNote !== undefined ? { roleNote: input.roleNote } : {}),
        },
      );
      if (Object.keys(diff.after).length > 0) {
        await recordAudit(tx, ctx, {
          action: 'SHIFT_UPDATED',
          entityType: 'STAFF_SHIFT',
          entityId: id,
          before: diff.before,
          after: diff.after,
        });
      }
      return readShift(tx, id);
    });
  } catch (error) {
    if (isExclusionViolation(error, 'staff_shifts_no_overlap')) throw overlapError();
    throw error;
  }
}

export async function cancelShift(
  id: string,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<ShiftDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(staffShifts)
      .where(eq(staffShifts.id, id))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Shift');
    if (row.status !== 'SCHEDULED') {
      throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This shift is already cancelled.');
    }
    await tx.update(staffShifts).set({ status: 'CANCELLED' }).where(eq(staffShifts.id, id));
    await recordAudit(tx, ctx, {
      action: 'SHIFT_CANCELLED',
      entityType: 'STAFF_SHIFT',
      entityId: id,
      before: { status: 'SCHEDULED' },
      after: { status: 'CANCELLED' },
      reason,
    });
    return readShift(tx, id);
  });
}
