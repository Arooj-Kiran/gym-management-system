import {
  ERROR_CODES,
  type AttendanceCorrectionDto,
  type AttendanceDto,
  type CorrectionField,
  type MyAttendanceDto,
  type attendanceCorrectionSchema,
  type attendanceListQuerySchema,
} from '@gms/shared';
import { and, asc, count, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import {
  attendanceCorrections,
  attendanceRecords,
  members,
  memberships,
  users,
} from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { gymDayStart, gymToday } from '../../lib/dates';
import { AppError, conflict, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';
import { memberPhotoUrl } from '../members/members.service';
import { assignedMemberSql } from '../trainers/trainer-scope';
import type { AttendanceReadScope } from './attendance.policy';

type AttendanceListQuery = z.output<typeof attendanceListQuerySchema>;
type AttendanceCorrection = z.output<typeof attendanceCorrectionSchema>;
type AttendanceRow = typeof attendanceRecords.$inferSelect;

const correctionCount = sql<number>`(
  select count(*)::int from ${attendanceCorrections}
  where ${attendanceCorrections.attendanceId} = ${attendanceRecords.id}
)`;

function selectAttendance() {
  return db
    .select({
      record: attendanceRecords,
      memberCode: members.memberCode,
      firstName: members.firstName,
      lastName: members.lastName,
      photoKey: members.profilePhotoKey,
      planName: memberships.planNameSnapshot,
      creatorFirstName: users.firstName,
      creatorLastName: users.lastName,
      correctionCount,
    })
    .from(attendanceRecords)
    .innerJoin(members, eq(members.id, attendanceRecords.memberId))
    .innerJoin(memberships, eq(memberships.id, attendanceRecords.membershipId))
    .leftJoin(users, eq(users.id, attendanceRecords.createdBy));
}

type SelectedAttendance = Awaited<ReturnType<typeof selectAttendance>>[number];

function toDto(row: SelectedAttendance): AttendanceDto {
  const { record } = row;
  return {
    id: record.id,
    member: {
      id: record.memberId,
      memberCode: row.memberCode,
      firstName: row.firstName,
      lastName: row.lastName,
      photoUrl: memberPhotoUrl(`/api/v1/members/${record.memberId}/photo`, row.photoKey),
    },
    membershipId: record.membershipId,
    planName: row.planName,
    checkInAt: record.checkInAt.toISOString(),
    checkOutAt: record.checkOutAt?.toISOString() ?? null,
    source: record.source,
    status: record.status,
    accessAttemptId: record.accessAttemptId,
    createdByName: row.creatorFirstName ? `${row.creatorFirstName} ${row.creatorLastName}` : null,
    correctionCount: row.correctionCount,
  };
}

export async function listAttendance(
  query: AttendanceListQuery,
  scope: AttendanceReadScope,
  fixed: { memberId?: string } = {},
) {
  const filters: (SQL | undefined)[] = [];
  if (scope.kind === 'assigned') {
    filters.push(assignedMemberSql(attendanceRecords.memberId, scope.trainerUserId));
  }
  const memberId = fixed.memberId ?? query.memberId;
  if (memberId) filters.push(eq(attendanceRecords.memberId, memberId));
  if (query.date) {
    filters.push(gte(attendanceRecords.checkInAt, gymDayStart(query.date)));
    filters.push(lt(attendanceRecords.checkInAt, gymDayStart(query.date, 1)));
  } else {
    if (query.from) filters.push(gte(attendanceRecords.checkInAt, gymDayStart(query.from)));
    if (query.to) filters.push(lt(attendanceRecords.checkInAt, gymDayStart(query.to, 1)));
  }
  if (query.source) filters.push(eq(attendanceRecords.source, query.source));
  if (query.status) filters.push(eq(attendanceRecords.status, query.status));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(
        ilike(sql`${members.firstName} || ' ' || ${members.lastName}`, pattern),
        ilike(members.memberCode, pattern),
      ),
    );
  }
  const where = and(...filters);
  const direction = (query.order ?? 'desc') === 'asc' ? asc : desc;

  const [rows, [totals]] = await Promise.all([
    selectAttendance()
      .where(where)
      .orderBy(direction(attendanceRecords.checkInAt), direction(attendanceRecords.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(attendanceRecords)
      .innerJoin(members, eq(members.id, attendanceRecords.memberId))
      .where(where),
  ]);
  return paginated(rows.map(toDto), query.page, query.pageSize, totals?.total ?? 0);
}

/** Today's check-ins in gym time. */
export function listToday(query: AttendanceListQuery, scope: AttendanceReadScope) {
  return listAttendance({ ...query, date: gymToday(), from: null, to: null }, scope);
}

/** For the object-level scope check on single-record routes. */
export async function attendanceMemberId(id: string): Promise<string> {
  const [row] = await db
    .select({ memberId: attendanceRecords.memberId })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.id, id))
    .limit(1);
  if (!row) throw notFound('Attendance record');
  return row.memberId;
}

async function getAttendance(id: string): Promise<AttendanceDto> {
  const [row] = await selectAttendance().where(eq(attendanceRecords.id, id)).limit(1);
  if (!row) throw notFound('Attendance record');
  return toDto(row);
}

async function lockAttendance(tx: DbExecutor, id: string) {
  const [row] = await tx
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.id, id))
    .limit(1)
    .for('update');
  if (!row) throw notFound('Attendance record');
  return row;
}

/** Check-out is informational only; the access decision never reads it (PLAN §6.3). */
export async function checkOut(id: string): Promise<AttendanceDto> {
  await db.transaction(async (tx) => {
    const record = await lockAttendance(tx, id);
    if (record.status === 'VOIDED') {
      throw conflict(ERROR_CODES.ATTENDANCE_VOIDED, 'This check-in was voided.');
    }
    if (record.checkOutAt) {
      throw conflict(ERROR_CODES.ALREADY_CHECKED_OUT, 'This member is already checked out.');
    }
    await tx
      .update(attendanceRecords)
      // A check-in stamped by a device clock a moment ahead must still end after it starts.
      .set({
        checkOutAt: sql`greatest(now(), ${attendanceRecords.checkInAt} + interval '1 second')`,
      })
      .where(eq(attendanceRecords.id, id));
  });
  return getAttendance(id);
}

const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * Staff fix a wrong record. Each changed field gets its own append-only correction row, and the
 * change is audit-logged with the reason.
 */
export async function correctAttendance(
  id: string,
  input: AttendanceCorrection,
  ctx: RequestContext,
): Promise<AttendanceDto> {
  await db.transaction(async (tx) => {
    const record = await lockAttendance(tx, id);
    const next: Pick<AttendanceRow, 'checkInAt' | 'checkOutAt' | 'status'> = {
      checkInAt: input.checkInAt !== undefined ? new Date(input.checkInAt) : record.checkInAt,
      checkOutAt:
        input.checkOutAt !== undefined
          ? input.checkOutAt === null
            ? null
            : new Date(input.checkOutAt)
          : record.checkOutAt,
      status: input.status ?? record.status,
    };
    if (next.checkInAt.getTime() > Date.now() + 60_000) {
      throw validationFailed([{ path: 'checkInAt', message: 'Check-in cannot be in the future' }]);
    }
    if (next.checkOutAt && next.checkOutAt.getTime() > Date.now() + 60_000) {
      throw validationFailed([
        { path: 'checkOutAt', message: 'Check-out cannot be in the future' },
      ]);
    }
    if (next.checkOutAt && next.checkOutAt <= next.checkInAt) {
      throw validationFailed([{ path: 'checkOutAt', message: 'Check-out must be after check-in' }]);
    }

    const changes: { field: CorrectionField; oldValue: string | null; newValue: string | null }[] =
      [];
    if (iso(record.checkInAt) !== iso(next.checkInAt)) {
      changes.push({
        field: 'CHECK_IN_AT',
        oldValue: iso(record.checkInAt),
        newValue: iso(next.checkInAt),
      });
    }
    if (iso(record.checkOutAt) !== iso(next.checkOutAt)) {
      changes.push({
        field: 'CHECK_OUT_AT',
        oldValue: iso(record.checkOutAt),
        newValue: iso(next.checkOutAt),
      });
    }
    if (record.status !== next.status) {
      changes.push({ field: 'STATUS', oldValue: record.status, newValue: next.status });
    }
    if (changes.length === 0) {
      throw new AppError(422, ERROR_CODES.VALIDATION_FAILED, 'Nothing changed.', [
        { path: '', message: 'These values are already recorded' },
      ]);
    }

    await tx.update(attendanceRecords).set(next).where(eq(attendanceRecords.id, id));
    await tx.insert(attendanceCorrections).values(
      changes.map((change) => ({
        attendanceId: id,
        ...change,
        reason: input.reason,
        correctedBy: ctx.actorUserId!,
      })),
    );
    await recordAudit(tx, ctx, {
      action: 'ATTENDANCE_CORRECTED',
      entityType: 'ATTENDANCE',
      entityId: id,
      before: Object.fromEntries(changes.map((c) => [c.field, c.oldValue])),
      after: Object.fromEntries(changes.map((c) => [c.field, c.newValue])),
      reason: input.reason,
    });
  });
  return getAttendance(id);
}

export async function listCorrections(id: string): Promise<AttendanceCorrectionDto[]> {
  const rows = await db
    .select({
      correction: attendanceCorrections,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(attendanceCorrections)
    .leftJoin(users, eq(users.id, attendanceCorrections.correctedBy))
    .where(eq(attendanceCorrections.attendanceId, id))
    .orderBy(desc(attendanceCorrections.createdAt), desc(attendanceCorrections.id));
  return rows.map(({ correction, firstName, lastName }) => ({
    id: correction.id,
    field: correction.field,
    oldValue: correction.oldValue,
    newValue: correction.newValue,
    reason: correction.reason,
    correctedByName: firstName ? `${firstName} ${lastName}` : null,
    createdAt: correction.createdAt.toISOString(),
  }));
}

/** Portal: the signed-in member's own valid check-ins. The member ID comes from the session. */
export async function listMyAttendance(userId: string, page: number, pageSize: number) {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, userId), isNull(members.archivedAt)))
    .limit(1);
  if (!member) throw notFound('Member profile');
  const where = and(
    eq(attendanceRecords.memberId, member.id),
    eq(attendanceRecords.status, 'VALID'),
  );
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(attendanceRecords)
      .where(where)
      .orderBy(desc(attendanceRecords.checkInAt), desc(attendanceRecords.id))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.select({ total: count() }).from(attendanceRecords).where(where),
  ]);
  const data: MyAttendanceDto[] = rows.map((row) => ({
    id: row.id,
    checkInAt: row.checkInAt.toISOString(),
    checkOutAt: row.checkOutAt?.toISOString() ?? null,
    source: row.source,
  }));
  return paginated(data, page, pageSize, totals?.total ?? 0);
}
