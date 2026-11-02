import {
  addDays,
  CLASS_LIMITS,
  ERROR_CODES,
  type ClassSessionDto,
  type FitnessClassDto,
  type classListQuerySchema,
  type classSessionListQuerySchema,
  type createClassSchema,
  type createClassSessionSchema,
  type updateClassSchema,
  type updateClassSessionSchema,
} from '@gms/shared';
import { and, asc, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { classBookings, classSessions, fitnessClasses, users } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { gymLocalToInstant, gymWallClock } from '../../lib/dates';
import { isExclusionViolation, isUniqueViolation } from '../../lib/db-errors';
import { conflict, notFound, validationFailed } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import { qualified } from '../memberships/current-membership';
import {
  addMinutes,
  assertTrainerFree,
  hasStarted,
  lockTrainerSchedule,
  minutesBetween,
  requireTrainer,
  type TimeWindow,
} from '../scheduling/scheduling';
import { gymDateWindow } from '../trainers/trainers.service';
import { lockSession, promoteWaitlist, seatedCount } from './bookings.service';

type CreateClass = z.output<typeof createClassSchema>;
type UpdateClass = z.output<typeof updateClassSchema>;
type ClassListQuery = z.output<typeof classListQuerySchema>;
type CreateSession = z.output<typeof createClassSessionSchema>;
type UpdateSession = z.output<typeof updateClassSessionSchema>;
type SessionListQuery = z.output<typeof classSessionListQuerySchema>;

// --- Class templates ----------------------------------------------------------------------

const defaultTrainer = alias(users, 'default_trainer');

const upcomingSessions = sql<number>`(select count(*)::int from class_sessions cs
  where cs.class_id = ${qualified(fitnessClasses.id)} and cs.status = 'SCHEDULED'
  and cs.starts_at > now())`;

function selectClasses(executor: DbExecutor = db) {
  return executor
    .select({
      cls: fitnessClasses,
      trainerFirstName: defaultTrainer.firstName,
      trainerLastName: defaultTrainer.lastName,
      upcomingSessions,
    })
    .from(fitnessClasses)
    .leftJoin(defaultTrainer, eq(defaultTrainer.id, fitnessClasses.defaultTrainerId));
}

type ClassRow = Awaited<ReturnType<typeof selectClasses>>[number];

function toClassDto(row: ClassRow): FitnessClassDto {
  const { cls } = row;
  return {
    id: cls.id,
    name: cls.name,
    description: cls.description,
    defaultDurationMinutes: cls.defaultDurationMinutes,
    defaultCapacity: cls.defaultCapacity,
    defaultTrainer:
      cls.defaultTrainerId && row.trainerFirstName
        ? {
            id: cls.defaultTrainerId,
            firstName: row.trainerFirstName,
            lastName: row.trainerLastName ?? '',
          }
        : null,
    isActive: cls.isActive,
    upcomingSessions: row.upcomingSessions,
    createdAt: cls.createdAt.toISOString(),
    updatedAt: cls.updatedAt.toISOString(),
  };
}

async function readClass(executor: DbExecutor, id: string): Promise<FitnessClassDto> {
  const [row] = await selectClasses(executor).where(eq(fitnessClasses.id, id)).limit(1);
  if (!row) throw notFound('Class');
  return toClassDto(row);
}

export async function listClasses(query: ClassListQuery): Promise<FitnessClassDto[]> {
  const rows = await selectClasses()
    .where(query.includeArchived ? undefined : eq(fitnessClasses.isActive, true))
    .orderBy(sql`${fitnessClasses.isActive} desc`, asc(fitnessClasses.name));
  return rows.map(toClassDto);
}

export const getClass = (id: string) => readClass(db, id);

const duplicateName = () =>
  conflict(ERROR_CODES.DUPLICATE_CLASS_NAME, 'A class with this name already exists.');

export async function createClass(input: CreateClass, ctx: RequestContext) {
  try {
    return await db.transaction(async (tx) => {
      if (input.defaultTrainerId) await requireTrainer(tx, input.defaultTrainerId);
      const [row] = await tx
        .insert(fitnessClasses)
        .values({
          name: input.name,
          description: input.description,
          defaultDurationMinutes: input.defaultDurationMinutes,
          defaultCapacity: input.defaultCapacity,
          defaultTrainerId: input.defaultTrainerId ?? null,
        })
        .returning({ id: fitnessClasses.id });
      await recordAudit(tx, ctx, {
        action: 'CLASS_CREATED',
        entityType: 'FITNESS_CLASS',
        entityId: row!.id,
        after: { ...input },
      });
      return readClass(tx, row!.id);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'fitness_classes_name_key')) throw duplicateName();
    throw error;
  }
}

export async function updateClass(id: string, input: UpdateClass, ctx: RequestContext) {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(fitnessClasses)
        .where(eq(fitnessClasses.id, id))
        .for('update')
        .limit(1);
      if (!row) throw notFound('Class');
      if (!row.isActive) throw conflict(ERROR_CODES.CLASS_ARCHIVED, 'This class is archived.');
      if (input.defaultTrainerId) await requireTrainer(tx, input.defaultTrainerId);
      const changes = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ) as Partial<typeof fitnessClasses.$inferInsert>;
      const diff = diffFields(row as unknown as Record<string, unknown>, changes);
      if (Object.keys(diff.after).length > 0) {
        await tx.update(fitnessClasses).set(changes).where(eq(fitnessClasses.id, id));
        await recordAudit(tx, ctx, {
          action: 'CLASS_UPDATED',
          entityType: 'FITNESS_CLASS',
          entityId: id,
          before: diff.before,
          after: diff.after,
        });
      }
      return readClass(tx, id);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'fitness_classes_name_key')) throw duplicateName();
    throw error;
  }
}

/** Archiving hides the class from new scheduling; sessions already planned stay as they are. */
export async function archiveClass(id: string, ctx: RequestContext) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ isActive: fitnessClasses.isActive })
      .from(fitnessClasses)
      .where(eq(fitnessClasses.id, id))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Class');
    if (!row.isActive) {
      throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This class is already archived.');
    }
    await tx.update(fitnessClasses).set({ isActive: false }).where(eq(fitnessClasses.id, id));
    await recordAudit(tx, ctx, {
      action: 'CLASS_ARCHIVED',
      entityType: 'FITNESS_CLASS',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });
    return readClass(tx, id);
  });
}

// --- Sessions -----------------------------------------------------------------------------

const sessionTrainer = alias(users, 'session_trainer');

const bookingCount = (statuses: SQL) => sql<number>`(select count(*)::int from class_bookings cb
  where cb.session_id = ${qualified(classSessions.id)} and cb.status in ${statuses})`;

export const sessionCounts = {
  bookedCount: bookingCount(sql.raw(`('BOOKED', 'ATTENDED', 'NO_SHOW')`)),
  waitlistCount: bookingCount(sql.raw(`('WAITLISTED')`)),
};

export function selectSessions(executor: DbExecutor = db) {
  return executor
    .select({
      session: classSessions,
      className: fitnessClasses.name,
      description: fitnessClasses.description,
      trainerFirstName: sessionTrainer.firstName,
      trainerLastName: sessionTrainer.lastName,
      ...sessionCounts,
    })
    .from(classSessions)
    .innerJoin(fitnessClasses, eq(fitnessClasses.id, classSessions.classId))
    .innerJoin(sessionTrainer, eq(sessionTrainer.id, classSessions.trainerId));
}

export type SessionRow = Awaited<ReturnType<typeof selectSessions>>[number];

export function toSessionDto(row: SessionRow, now = new Date()): ClassSessionDto {
  const { session } = row;
  return {
    id: session.id,
    classId: session.classId,
    className: row.className,
    description: row.description,
    trainer: {
      id: session.trainerId,
      firstName: row.trainerFirstName,
      lastName: row.trainerLastName,
    },
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    durationMinutes: minutesBetween(session.startsAt, session.endsAt),
    capacity: session.capacity,
    room: session.room,
    status: session.status,
    effectiveStatus:
      session.status === 'SCHEDULED' && session.endsAt <= now ? 'COMPLETED' : session.status,
    cancelReason: session.cancelReason,
    bookedCount: row.bookedCount,
    waitlistCount: row.waitlistCount,
    spotsLeft: Math.max(0, session.capacity - row.bookedCount),
  };
}

export async function readSession(executor: DbExecutor, id: string): Promise<ClassSessionDto> {
  const [row] = await selectSessions(executor).where(eq(classSessions.id, id)).limit(1);
  if (!row) throw notFound('Class session');
  return toSessionDto(row);
}

/** Sessions overlapping the gym-date range, in time order. */
export function sessionRangeFilter(query: SessionListQuery): SQL | undefined {
  const window = gymDateWindow(query.from, query.to);
  return and(
    sql`${classSessions.startsAt} < ${window.endsAt.toISOString()}::timestamptz`,
    gt(classSessions.endsAt, window.startsAt),
    query.trainerId ? eq(classSessions.trainerId, query.trainerId) : undefined,
    query.classId ? eq(classSessions.classId, query.classId) : undefined,
    query.includeCancelled ? undefined : ne(classSessions.status, 'CANCELLED'),
  );
}

export async function listSessions(query: SessionListQuery): Promise<ClassSessionDto[]> {
  const rows = await selectSessions()
    .where(sessionRangeFilter(query))
    .orderBy(asc(classSessions.startsAt), asc(fitnessClasses.name));
  const now = new Date();
  return rows.map((row) => toSessionDto(row, now));
}

export const getSession = (id: string) => readSession(db, id);

function sessionWriteError(error: unknown): unknown {
  if (isExclusionViolation(error, 'class_sessions_trainer_no_overlap')) {
    return conflict(ERROR_CODES.SCHEDULE_CONFLICT, 'The trainer is teaching another class then.');
  }
  if (isExclusionViolation(error, 'class_sessions_room_no_overlap')) {
    return conflict(ERROR_CODES.ROOM_CONFLICT, 'Another class is using this room then.');
  }
  return error;
}

/** The first start plus one per week at the same gym wall time, up to `until` (inclusive). */
function weeklyStarts(first: Date, until: string | undefined): Date[] {
  if (!until) return [first];
  const { date, time } = gymWallClock(first);
  if (until < date) {
    throw validationFailed([
      { path: 'repeatWeeklyUntil', message: 'Must be on or after the first date' },
    ]);
  }
  const starts: Date[] = [];
  for (let day = date; day <= until; day = addDays(day, 7)) {
    if (starts.length === CLASS_LIMITS.maxOccurrences) {
      throw validationFailed([
        {
          path: 'repeatWeeklyUntil',
          message: `A series can have at most ${CLASS_LIMITS.maxOccurrences} sessions`,
        },
      ]);
    }
    starts.push(day === date ? first : gymLocalToInstant(day, time));
  }
  return starts;
}

/**
 * One session, or a weekly series (all or nothing). Each occurrence must leave the trainer free
 * (no class, appointment or time off) and the room unused.
 */
export async function createSessions(
  input: CreateSession,
  ctx: RequestContext,
): Promise<ClassSessionDto[]> {
  const first = new Date(input.startsAt);
  if (hasStarted(first)) {
    throw validationFailed([{ path: 'startsAt', message: 'Must be in the future' }]);
  }
  try {
    return await db.transaction(async (tx) => {
      const [cls] = await tx
        .select()
        .from(fitnessClasses)
        .where(eq(fitnessClasses.id, input.classId))
        .limit(1);
      if (!cls) throw notFound('Class');
      if (!cls.isActive) throw conflict(ERROR_CODES.CLASS_ARCHIVED, 'This class is archived.');
      const trainerId = input.trainerId ?? cls.defaultTrainerId;
      if (!trainerId) {
        throw validationFailed([
          { path: 'trainerId', message: 'Choose a trainer (the class has no default)' },
        ]);
      }
      await requireTrainer(tx, trainerId);
      const duration = input.durationMinutes ?? cls.defaultDurationMinutes;
      const windows: TimeWindow[] = weeklyStarts(first, input.repeatWeeklyUntil ?? undefined).map(
        (startsAt) => ({ startsAt, endsAt: addMinutes(startsAt, duration) }),
      );
      await lockTrainerSchedule(tx, trainerId);
      for (const window of windows) await assertTrainerFree(tx, trainerId, window);
      const rows = await tx
        .insert(classSessions)
        .values(
          windows.map((window) => ({
            classId: cls.id,
            trainerId,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            capacity: input.capacity ?? cls.defaultCapacity,
            room: input.room ?? null,
          })),
        )
        .returning({ id: classSessions.id });
      await recordAudit(tx, ctx, {
        action: 'CLASS_SESSIONS_CREATED',
        entityType: 'CLASS_SESSION',
        entityId: rows[0]!.id,
        after: {
          classId: cls.id,
          className: cls.name,
          trainerId,
          firstStartsAt: first.toISOString(),
          occurrences: rows.length,
          sessionIds: rows.map((row) => row.id),
        },
      });
      const created = await selectSessions(tx)
        .where(
          inArray(
            classSessions.id,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(classSessions.startsAt));
      return created.map((row) => toSessionDto(row));
    });
  } catch (error) {
    throw sessionWriteError(error);
  }
}

function assertEditable(session: typeof classSessions.$inferSelect) {
  if (session.status !== 'SCHEDULED') {
    throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This session is cancelled.');
  }
  if (hasStarted(session.startsAt)) {
    throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This session has already started.');
  }
}

/**
 * Move, re-staff or resize a future session. Lowering capacity below the places already taken
 * is refused; raising it promotes from the waitlist in the same transaction.
 */
export async function updateSession(id: string, input: UpdateSession, ctx: RequestContext) {
  try {
    return await db.transaction(async (tx) => {
      const session = await lockSession(tx, id);
      assertEditable(session);
      const trainerId = input.trainerId ?? session.trainerId;
      const startsAt = input.startsAt ? new Date(input.startsAt) : session.startsAt;
      if (input.startsAt && hasStarted(startsAt)) {
        throw validationFailed([{ path: 'startsAt', message: 'Must be in the future' }]);
      }
      const duration = input.durationMinutes ?? minutesBetween(session.startsAt, session.endsAt);
      const window = { startsAt, endsAt: addMinutes(startsAt, duration) };
      const moved =
        trainerId !== session.trainerId ||
        window.startsAt.getTime() !== session.startsAt.getTime() ||
        window.endsAt.getTime() !== session.endsAt.getTime();
      if (trainerId !== session.trainerId) await requireTrainer(tx, trainerId);
      if (moved) {
        await lockTrainerSchedule(tx, trainerId);
        await assertTrainerFree(tx, trainerId, window, { sessionId: id });
      }
      const capacity = input.capacity ?? session.capacity;
      const seated = await seatedCount(tx, id);
      if (capacity < seated) {
        throw conflict(
          ERROR_CODES.CAPACITY_BELOW_BOOKINGS,
          `${seated} places are already booked; capacity cannot go below that.`,
        );
      }
      const changes = {
        trainerId,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        capacity,
        ...(input.room !== undefined ? { room: input.room } : {}),
      };
      const diff = diffFields(
        {
          trainerId: session.trainerId,
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          capacity: session.capacity,
          room: session.room,
        },
        {
          ...changes,
          startsAt: window.startsAt.toISOString(),
          endsAt: window.endsAt.toISOString(),
        },
      );
      if (Object.keys(diff.after).length > 0) {
        await tx.update(classSessions).set(changes).where(eq(classSessions.id, id));
        await recordAudit(tx, ctx, {
          action: 'CLASS_SESSION_UPDATED',
          entityType: 'CLASS_SESSION',
          entityId: id,
          before: diff.before,
          after: diff.after,
        });
      }
      if (capacity > session.capacity) await promoteWaitlist(tx, id, capacity, ctx);
      return readSession(tx, id);
    });
  } catch (error) {
    throw sessionWriteError(error);
  }
}

/** Cancelling a session cancels every booking and waitlist place in it. */
export async function cancelSession(id: string, reason: string, ctx: RequestContext) {
  return db.transaction(async (tx) => {
    const session = await lockSession(tx, id);
    assertEditable(session);
    await tx
      .update(classSessions)
      .set({ status: 'CANCELLED', cancelReason: reason })
      .where(eq(classSessions.id, id));
    const cancelled = await tx
      .update(classBookings)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), waitlistPosition: null })
      .where(
        and(
          eq(classBookings.sessionId, id),
          sql`${classBookings.status} in ('BOOKED', 'WAITLISTED')`,
        ),
      )
      .returning({ id: classBookings.id });
    await recordAudit(tx, ctx, {
      action: 'CLASS_SESSION_CANCELLED',
      entityType: 'CLASS_SESSION',
      entityId: id,
      before: { status: 'SCHEDULED' },
      after: { status: 'CANCELLED', bookingsCancelled: cancelled.length },
      reason,
    });
    return readSession(tx, id);
  });
}
