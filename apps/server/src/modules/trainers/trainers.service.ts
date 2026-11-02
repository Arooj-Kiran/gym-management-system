import {
  addDays,
  ERROR_CODES,
  permissionScope,
  SCOPES,
  TRAINER_LIMITS,
  TRAINER_SELF_EDITABLE_FIELDS,
  timeToMinutes,
  type AvailabilitySlotDto,
  type AvailableSlotDto,
  type MembershipBrief,
  type Permission,
  type PublicTrainerDto,
  type ScheduleItemDto,
  type TimeOffDto,
  type TrainerAssignmentDto,
  type TrainerAvailabilityDto,
  type TrainerDto,
  type TrainerMemberDto,
  type assignmentListQuerySchema,
  type availableSlotsQuerySchema,
  type createAssignmentSchema,
  type createTimeOffSchema,
  type scheduleQuerySchema,
  type setAvailabilitySchema,
  type updateTrainerProfileSchema,
} from '@gms/shared';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import {
  appointments,
  classSessions,
  fitnessClasses,
  members,
  staffShifts,
  trainerAssignments,
  trainerAvailability,
  trainerProfiles,
  trainerTimeOff,
  users,
} from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { gymLocalToInstant, gymToday, isoWeekday } from '../../lib/dates';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, forbidden, notFound, validationFailed } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import { currentMembershipBriefSql, qualified } from '../memberships/current-membership';
import { toTrainerSafe } from '../members/members.service';
import {
  addMinutes,
  lockTrainerSchedule,
  requireTrainer,
  type TimeWindow,
} from '../scheduling/scheduling';

type UpdateProfile = z.output<typeof updateTrainerProfileSchema>;
type SetAvailability = z.output<typeof setAvailabilitySchema>;
type CreateTimeOff = z.output<typeof createTimeOffSchema>;
type ScheduleQuery = z.output<typeof scheduleQuerySchema>;
type SlotsQuery = z.output<typeof availableSlotsQuerySchema>;
type CreateAssignment = z.output<typeof createAssignmentSchema>;
type AssignmentListQuery = z.output<typeof assignmentListQuerySchema>;
type Auth = Express.AuthContext;

const hhmm = (value: string) => value.slice(0, 5);

/** OWN-scoped roles (a trainer) may act on their own trainer record only. */
export function assertSelfWhenOwn(auth: Auth, permission: Permission, trainerId: string) {
  if (permissionScope(auth.user.role, permission) === SCOPES.OWN && auth.user.id !== trainerId) {
    throw forbidden('You can only do this for yourself.');
  }
}

// --- Trainers -----------------------------------------------------------------------------

const activeMemberCount = sql<number>`(select count(*)::int from trainer_assignments ta
  join members m on m.id = ta.member_id
  where ta.trainer_id = ${qualified(users.id)} and ta.end_date is null and m.archived_at is null)`;

/** Any weekly hours that have not ended yet (in force today, or starting later). */
const hasWeeklyHours = (
  today: string,
) => sql<boolean>`exists (select 1 from trainer_availability tav
  where tav.trainer_id = ${qualified(users.id)}
    and (tav.effective_to is null or tav.effective_to >= ${today}::date))`;

function selectTrainers(executor: DbExecutor = db) {
  const today = gymToday();
  return executor
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      isActive: users.isActive,
      bio: trainerProfiles.bio,
      specializations: trainerProfiles.specializations,
      certifications: trainerProfiles.certifications,
      isBookable: trainerProfiles.isBookable,
      activeMemberCount,
      hasWeeklyHours: hasWeeklyHours(today),
    })
    .from(users)
    .leftJoin(trainerProfiles, eq(trainerProfiles.userId, users.id));
}

type TrainerRow = Awaited<ReturnType<typeof selectTrainers>>[number];

/** A trainer without a profile row reads as bookable with an empty profile. */
function toTrainerDto(row: TrainerRow): TrainerDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    isActive: row.isActive,
    bio: row.bio ?? null,
    specializations: row.specializations ?? [],
    certifications: row.certifications ?? [],
    isBookable: row.isBookable ?? true,
    activeMemberCount: row.activeMemberCount,
    hasWeeklyHours: row.hasWeeklyHours,
  };
}

export async function listTrainers(): Promise<TrainerDto[]> {
  const rows = await selectTrainers()
    .where(eq(users.role, 'TRAINER'))
    .orderBy(desc(users.isActive), asc(users.firstName), asc(users.lastName));
  return rows.map(toTrainerDto);
}

export async function getTrainer(id: string, executor: DbExecutor = db): Promise<TrainerDto> {
  const [row] = await selectTrainers(executor)
    .where(and(eq(users.id, id), eq(users.role, 'TRAINER')))
    .limit(1);
  if (!row) throw notFound('Trainer');
  return toTrainerDto(row);
}

/** Portal: active trainers' public fields, flagging the member's own trainers. */
export async function listPublicTrainers(memberId: string): Promise<PublicTrainerDto[]> {
  const rows = await selectTrainers()
    .where(and(eq(users.role, 'TRAINER'), eq(users.isActive, true)))
    .orderBy(asc(users.firstName), asc(users.lastName));
  const mine = await db
    .select({ trainerId: trainerAssignments.trainerId })
    .from(trainerAssignments)
    .where(and(eq(trainerAssignments.memberId, memberId), isNull(trainerAssignments.endDate)));
  const assigned = new Set(mine.map((row) => row.trainerId));
  return rows.map((row) => {
    const dto = toTrainerDto(row);
    return {
      id: dto.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
      bio: dto.bio,
      specializations: dto.specializations,
      certifications: dto.certifications,
      isBookable: dto.isBookable,
      assignedToMe: assigned.has(dto.id),
    };
  });
}

/** A trainer may edit their own bio and specializations; everything else is Admin/Manager. */
export async function updateProfile(
  trainerId: string,
  input: UpdateProfile,
  auth: Auth,
  ctx: RequestContext,
): Promise<TrainerDto> {
  assertSelfWhenOwn(auth, 'trainers:manage', trainerId);
  if (permissionScope(auth.user.role, 'trainers:manage') === SCOPES.OWN) {
    const allowed: readonly string[] = TRAINER_SELF_EDITABLE_FIELDS;
    const blocked = Object.keys(input).filter(
      (key) => input[key as keyof UpdateProfile] !== undefined && !allowed.includes(key),
    );
    if (blocked.length > 0) {
      throw forbidden('You can change your bio and specializations only.');
    }
  }
  return db.transaction(async (tx) => {
    const before = await getTrainer(trainerId, tx);
    const changes = {
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
      ...(input.specializations ? { specializations: input.specializations } : {}),
      ...(input.certifications ? { certifications: input.certifications } : {}),
      ...(input.isBookable !== undefined ? { isBookable: input.isBookable } : {}),
    };
    await tx
      .insert(trainerProfiles)
      .values({ userId: trainerId, ...changes })
      .onConflictDoUpdate({ target: trainerProfiles.userId, set: { ...changes } });
    const diff = diffFields(before as unknown as Record<string, unknown>, changes);
    if (Object.keys(diff.after).length > 0) {
      await recordAudit(tx, ctx, {
        action: 'TRAINER_PROFILE_UPDATED',
        entityType: 'TRAINER',
        entityId: trainerId,
        before: diff.before,
        after: diff.after,
      });
    }
    return getTrainer(trainerId, tx);
  });
}

// --- Availability and time off ------------------------------------------------------------

function toSlotDto(row: typeof trainerAvailability.$inferSelect): AvailabilitySlotDto {
  return {
    id: row.id,
    weekday: row.weekday,
    startTime: hhmm(row.startTime),
    endTime: hhmm(row.endTime),
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

function toTimeOffDto(row: typeof trainerTimeOff.$inferSelect): TimeOffDto {
  return {
    id: row.id,
    trainerId: row.trainerId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

const bySlotOrder = (a: AvailabilitySlotDto, b: AvailabilitySlotDto) =>
  a.weekday - b.weekday || timeToMinutes(a.startTime) - timeToMinutes(b.startTime);

export async function getAvailability(trainerId: string): Promise<TrainerAvailabilityDto> {
  await getTrainer(trainerId);
  const today = gymToday();
  const [rows, timeOff] = await Promise.all([
    db
      .select()
      .from(trainerAvailability)
      .where(
        and(
          eq(trainerAvailability.trainerId, trainerId),
          or(isNull(trainerAvailability.effectiveTo), gte(trainerAvailability.effectiveTo, today)),
        ),
      ),
    db
      .select()
      .from(trainerTimeOff)
      .where(
        and(
          eq(trainerTimeOff.trainerId, trainerId),
          eq(trainerTimeOff.status, 'ACTIVE'),
          gt(trainerTimeOff.endsAt, new Date()),
        ),
      )
      .orderBy(asc(trainerTimeOff.startsAt)),
  ]);
  const slots = rows.map(toSlotDto);
  const current = slots.filter((slot) => slot.effectiveFrom <= today).sort(bySlotOrder);
  const nextFrom = slots
    .map((slot) => slot.effectiveFrom)
    .filter((from) => from > today)
    .sort()[0];
  return {
    current,
    upcoming: nextFrom
      ? {
          effectiveFrom: nextFrom,
          slots: slots.filter((slot) => slot.effectiveFrom === nextFrom).sort(bySlotOrder),
        }
      : null,
    timeOff: timeOff.map(toTimeOffDto),
  };
}

/**
 * Replace the weekly hours from `effectiveFrom` (default today): rows that start on or after it
 * are dropped, rows still open then are closed the day before, and the new slots start then.
 * Booked appointments are kept; staff move them by hand if the hours shrink.
 */
export async function setAvailability(
  trainerId: string,
  input: SetAvailability,
  auth: Auth,
  ctx: RequestContext,
): Promise<TrainerAvailabilityDto> {
  assertSelfWhenOwn(auth, 'trainers:manage-availability', trainerId);
  const today = gymToday();
  const from = input.effectiveFrom ?? today;
  if (from < today) {
    throw validationFailed([{ path: 'effectiveFrom', message: 'Cannot change past weeks' }]);
  }
  await db.transaction(async (tx) => {
    await requireTrainer(tx, trainerId);
    await lockTrainerSchedule(tx, trainerId);
    const before = await tx
      .select()
      .from(trainerAvailability)
      .where(
        and(
          eq(trainerAvailability.trainerId, trainerId),
          or(isNull(trainerAvailability.effectiveTo), gte(trainerAvailability.effectiveTo, from)),
        ),
      );
    await tx
      .delete(trainerAvailability)
      .where(
        and(
          eq(trainerAvailability.trainerId, trainerId),
          gte(trainerAvailability.effectiveFrom, from),
        ),
      );
    await tx
      .update(trainerAvailability)
      .set({ effectiveTo: addDays(from, -1) })
      .where(
        and(
          eq(trainerAvailability.trainerId, trainerId),
          lt(trainerAvailability.effectiveFrom, from),
          or(isNull(trainerAvailability.effectiveTo), gte(trainerAvailability.effectiveTo, from)),
        ),
      );
    if (input.slots.length > 0) {
      await tx.insert(trainerAvailability).values(
        input.slots.map((slot) => ({
          trainerId,
          weekday: slot.weekday,
          startTime: slot.startTime,
          endTime: slot.endTime,
          effectiveFrom: from,
        })),
      );
    }
    await recordAudit(tx, ctx, {
      action: 'TRAINER_AVAILABILITY_UPDATED',
      entityType: 'TRAINER',
      entityId: trainerId,
      before: { slots: before.map(toSlotDto).map(({ id: _id, ...slot }) => slot) },
      after: { effectiveFrom: from, slots: input.slots },
    });
  });
  return getAvailability(trainerId);
}

/** Time off cannot cover anything already booked: move or cancel it first. */
export async function addTimeOff(
  trainerId: string,
  input: CreateTimeOff,
  auth: Auth,
  ctx: RequestContext,
): Promise<TimeOffDto> {
  assertSelfWhenOwn(auth, 'trainers:manage-availability', trainerId);
  const window = { startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) };
  if (window.endsAt.getTime() <= Date.now()) {
    throw validationFailed([{ path: 'endsAt', message: 'Time off must end in the future' }]);
  }
  return db.transaction(async (tx) => {
    await requireTrainer(tx, trainerId);
    await lockTrainerSchedule(tx, trainerId);
    const busy = await busyItems(tx, trainerId, window, { timeOff: false });
    if (busy.length > 0) {
      throw conflict(
        ERROR_CODES.SCHEDULE_CONFLICT,
        `The trainer has ${busy.length} booked ${busy.length === 1 ? 'class or appointment' : 'classes or appointments'} then. Move or cancel ${busy.length === 1 ? 'it' : 'them'} first.`,
      );
    }
    const [row] = await tx
      .insert(trainerTimeOff)
      .values({
        trainerId,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        reason: input.reason,
        createdBy: ctx.actorUserId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: 'TRAINER_TIME_OFF_ADDED',
      entityType: 'TRAINER_TIME_OFF',
      entityId: row!.id,
      after: { trainerId, startsAt: input.startsAt, endsAt: input.endsAt },
      reason: input.reason,
    });
    return toTimeOffDto(row!);
  });
}

export async function cancelTimeOff(
  id: string,
  reason: string | undefined,
  auth: Auth,
  ctx: RequestContext,
): Promise<TimeOffDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(trainerTimeOff)
      .where(eq(trainerTimeOff.id, id))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Time off');
    assertSelfWhenOwn(auth, 'trainers:manage-availability', row.trainerId);
    if (row.status !== 'ACTIVE') {
      throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This time off is already cancelled.');
    }
    const [updated] = await tx
      .update(trainerTimeOff)
      .set({ status: 'CANCELLED' })
      .where(eq(trainerTimeOff.id, id))
      .returning();
    await recordAudit(tx, ctx, {
      action: 'TRAINER_TIME_OFF_CANCELLED',
      entityType: 'TRAINER_TIME_OFF',
      entityId: id,
      before: { status: 'ACTIVE' },
      after: { status: 'CANCELLED' },
      reason,
    });
    return toTimeOffDto(updated!);
  });
}

// --- Schedule -----------------------------------------------------------------------------

const inWindow = (startCol: SQL, endCol: SQL, w: TimeWindow) =>
  sql`${startCol} < ${w.endsAt.toISOString()}::timestamptz and ${endCol} > ${w.startsAt.toISOString()}::timestamptz`;

/** Booked classes and appointments (and optionally active time off) overlapping the window. */
async function busyItems(
  executor: DbExecutor,
  trainerId: string,
  window: TimeWindow,
  options: { timeOff: boolean },
): Promise<TimeWindow[]> {
  const [sessions, booked, off] = await Promise.all([
    executor
      .select({ startsAt: classSessions.startsAt, endsAt: classSessions.endsAt })
      .from(classSessions)
      .where(
        and(
          eq(classSessions.trainerId, trainerId),
          eq(classSessions.status, 'SCHEDULED'),
          inWindow(sql`${classSessions.startsAt}`, sql`${classSessions.endsAt}`, window),
        ),
      ),
    executor
      .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.trainerId, trainerId),
          eq(appointments.status, 'BOOKED'),
          inWindow(sql`${appointments.startsAt}`, sql`${appointments.endsAt}`, window),
        ),
      ),
    options.timeOff
      ? executor
          .select({ startsAt: trainerTimeOff.startsAt, endsAt: trainerTimeOff.endsAt })
          .from(trainerTimeOff)
          .where(
            and(
              eq(trainerTimeOff.trainerId, trainerId),
              eq(trainerTimeOff.status, 'ACTIVE'),
              inWindow(sql`${trainerTimeOff.startsAt}`, sql`${trainerTimeOff.endsAt}`, window),
            ),
          )
      : Promise.resolve([]),
  ]);
  return [...sessions, ...booked, ...off];
}

/** The instants bounding inclusive gym-time dates. */
export function gymDateWindow(from: string, to: string): TimeWindow {
  return {
    startsAt: gymLocalToInstant(from, '00:00'),
    endsAt: gymLocalToInstant(addDays(to, 1), '00:00'),
  };
}

const appointmentMember = alias(members, 'appointment_member');

/**
 * Everything on a trainer's calendar in the window, in time order. `showPrivate` adds member
 * names and time-off reasons (the trainer themself, or front-desk and managers); `showShifts`
 * adds the trainer's shifts (roles that may read that user's shifts).
 */
export async function trainerScheduleItems(
  trainerId: string,
  window: TimeWindow,
  options: { showPrivate: boolean; showShifts: boolean },
): Promise<ScheduleItemDto[]> {
  const now = new Date();
  const [sessions, booked, off, shifts] = await Promise.all([
    db
      .select({
        id: classSessions.id,
        startsAt: classSessions.startsAt,
        endsAt: classSessions.endsAt,
        status: classSessions.status,
        room: classSessions.room,
        capacity: classSessions.capacity,
        className: fitnessClasses.name,
        booked: sql<number>`(select count(*)::int from class_bookings cb
          where cb.session_id = ${qualified(classSessions.id)}
          and cb.status in ('BOOKED', 'ATTENDED', 'NO_SHOW'))`,
      })
      .from(classSessions)
      .innerJoin(fitnessClasses, eq(fitnessClasses.id, classSessions.classId))
      .where(
        and(
          eq(classSessions.trainerId, trainerId),
          ne(classSessions.status, 'CANCELLED'),
          inWindow(sql`${classSessions.startsAt}`, sql`${classSessions.endsAt}`, window),
        ),
      ),
    db
      .select({
        id: appointments.id,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        firstName: appointmentMember.firstName,
        lastName: appointmentMember.lastName,
      })
      .from(appointments)
      .innerJoin(appointmentMember, eq(appointmentMember.id, appointments.memberId))
      .where(
        and(
          eq(appointments.trainerId, trainerId),
          ne(appointments.status, 'CANCELLED'),
          inWindow(sql`${appointments.startsAt}`, sql`${appointments.endsAt}`, window),
        ),
      ),
    db
      .select()
      .from(trainerTimeOff)
      .where(
        and(
          eq(trainerTimeOff.trainerId, trainerId),
          eq(trainerTimeOff.status, 'ACTIVE'),
          inWindow(sql`${trainerTimeOff.startsAt}`, sql`${trainerTimeOff.endsAt}`, window),
        ),
      ),
    options.showShifts
      ? db
          .select()
          .from(staffShifts)
          .where(
            and(
              eq(staffShifts.userId, trainerId),
              eq(staffShifts.status, 'SCHEDULED'),
              inWindow(sql`${staffShifts.startsAt}`, sql`${staffShifts.endsAt}`, window),
            ),
          )
      : Promise.resolve([]),
  ]);

  const items: ScheduleItemDto[] = [
    ...sessions.map((row) => ({
      kind: 'CLASS' as const,
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      title: row.className,
      detail: row.room,
      status: row.status === 'SCHEDULED' && row.endsAt <= now ? 'COMPLETED' : row.status,
      booked: row.booked,
      capacity: row.capacity,
    })),
    ...booked.map((row) => ({
      kind: 'APPOINTMENT' as const,
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      title: 'Personal training',
      detail: options.showPrivate ? `${row.firstName} ${row.lastName}` : null,
      status: row.status,
    })),
    ...off.map((row) => ({
      kind: 'TIME_OFF' as const,
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      title: 'Time off',
      detail: options.showPrivate ? row.reason : null,
      status: row.status,
    })),
    ...shifts.map((row) => ({
      kind: 'SHIFT' as const,
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      title: 'Shift',
      detail: row.roleNote,
      status: row.status,
    })),
  ];
  return items.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.kind.localeCompare(b.kind));
}

export async function getSchedule(
  trainerId: string,
  query: ScheduleQuery,
  auth: Auth,
): Promise<ScheduleItemDto[]> {
  await getTrainer(trainerId);
  const self = auth.user.id === trainerId;
  return trainerScheduleItems(trainerId, gymDateWindow(query.from, query.to), {
    showPrivate: self || auth.user.role !== 'TRAINER',
    showShifts: self || permissionScope(auth.user.role, 'schedules:read') === SCOPES.ALL,
  });
}

/**
 * Start times on a 30-minute grid inside the trainer's weekly hours on `date`, that are still in
 * the future and clear of classes, appointments and time off.
 */
export async function availableSlots(
  trainerId: string,
  query: SlotsQuery,
  auth: Auth,
): Promise<AvailableSlotDto[]> {
  assertSelfWhenOwn(auth, 'appointments:read', trainerId);
  const trainer = await getTrainer(trainerId);
  if (!trainer.isActive || !trainer.isBookable) return [];
  const slots = await db
    .select()
    .from(trainerAvailability)
    .where(
      and(
        eq(trainerAvailability.trainerId, trainerId),
        eq(trainerAvailability.weekday, isoWeekday(query.date)),
        lte(trainerAvailability.effectiveFrom, query.date),
        or(
          isNull(trainerAvailability.effectiveTo),
          gte(trainerAvailability.effectiveTo, query.date),
        ),
      ),
    );
  if (slots.length === 0) return [];
  const busy = await busyItems(db, trainerId, gymDateWindow(query.date, query.date), {
    timeOff: true,
  });
  const now = Date.now();
  const result: AvailableSlotDto[] = [];
  for (const slot of slots.map(toSlotDto).sort(bySlotOrder)) {
    const end = timeToMinutes(slot.endTime);
    for (
      let start = timeToMinutes(slot.startTime);
      start + query.durationMinutes <= end;
      start += TRAINER_LIMITS.slotStepMinutes
    ) {
      const time = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
      const startsAt = gymLocalToInstant(query.date, time);
      const endsAt = addMinutes(startsAt, query.durationMinutes);
      if (startsAt.getTime() <= now) continue;
      const clash = busy.some((item) => item.startsAt < endsAt && item.endsAt > startsAt);
      if (!clash) result.push({ startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
    }
  }
  return result;
}

// --- Assignments --------------------------------------------------------------------------

const assignedBy = alias(users, 'assigned_by_user');
const assignmentTrainer = alias(users, 'assignment_trainer');

const currentMembershipColumn = () => ({
  currentMembership: currentMembershipBriefSql(members.id, gymToday()).mapWith(
    (value) => value as MembershipBrief,
  ),
});

function selectAssignments(executor: DbExecutor = db) {
  return executor
    .select({
      assignment: trainerAssignments,
      trainerFirstName: assignmentTrainer.firstName,
      trainerLastName: assignmentTrainer.lastName,
      assignedByFirstName: assignedBy.firstName,
      assignedByLastName: assignedBy.lastName,
      member: { ...getTableColumns(members), ...currentMembershipColumn() },
    })
    .from(trainerAssignments)
    .innerJoin(members, eq(members.id, trainerAssignments.memberId))
    .innerJoin(assignmentTrainer, eq(assignmentTrainer.id, trainerAssignments.trainerId))
    .leftJoin(assignedBy, eq(assignedBy.id, trainerAssignments.assignedBy));
}

type AssignmentRow = Awaited<ReturnType<typeof selectAssignments>>[number];

function toAssignmentDto(row: AssignmentRow): TrainerAssignmentDto {
  const { assignment } = row;
  return {
    id: assignment.id,
    trainer: {
      id: assignment.trainerId,
      firstName: row.trainerFirstName,
      lastName: row.trainerLastName,
    },
    member: toTrainerSafe(row.member),
    startDate: assignment.startDate,
    endDate: assignment.endDate,
    notes: assignment.notes,
    assignedByName: row.assignedByFirstName
      ? `${row.assignedByFirstName} ${row.assignedByLastName}`
      : null,
    createdAt: assignment.createdAt.toISOString(),
  };
}

async function readAssignment(executor: DbExecutor, id: string) {
  const [row] = await selectAssignments(executor).where(eq(trainerAssignments.id, id)).limit(1);
  if (!row) throw notFound('Assignment');
  return toAssignmentDto(row);
}

/** Open assignments, newest first. A trainer only ever sees their own. */
export async function listAssignments(
  query: AssignmentListQuery,
  auth: Auth,
): Promise<TrainerAssignmentDto[]> {
  const own = permissionScope(auth.user.role, 'trainer-assignments:read') === SCOPES.OWN;
  if (own && query.trainerId && query.trainerId !== auth.user.id) {
    throw forbidden('You can only see your own members.');
  }
  const trainerId = own ? auth.user.id : query.trainerId;
  const rows = await selectAssignments()
    .where(
      and(
        isNull(trainerAssignments.endDate),
        trainerId ? eq(trainerAssignments.trainerId, trainerId) : undefined,
        query.memberId ? eq(trainerAssignments.memberId, query.memberId) : undefined,
      ),
    )
    .orderBy(desc(trainerAssignments.startDate), desc(trainerAssignments.createdAt));
  return rows.map(toAssignmentDto);
}

const lastCheckIn = sql<Date | null>`(select max(ar.check_in_at) from attendance_records ar
  where ar.member_id = ${qualified(members.id)} and ar.status = 'VALID')`.mapWith(
  (value: string | null) => (value ? new Date(value) : null),
);

/** GET /trainers/:id/members — the trainer's current members (trainer-safe fields). */
export async function listTrainerMembers(
  trainerId: string,
  auth: Auth,
): Promise<TrainerMemberDto[]> {
  assertSelfWhenOwn(auth, 'trainer-assignments:read', trainerId);
  await getTrainer(trainerId);
  const rows = await db
    .select({
      assignmentId: trainerAssignments.id,
      startDate: trainerAssignments.startDate,
      notes: trainerAssignments.notes,
      member: { ...getTableColumns(members), ...currentMembershipColumn() },
      lastCheckInAt: lastCheckIn,
    })
    .from(trainerAssignments)
    .innerJoin(members, eq(members.id, trainerAssignments.memberId))
    .where(
      and(
        eq(trainerAssignments.trainerId, trainerId),
        isNull(trainerAssignments.endDate),
        isNull(members.archivedAt),
      ),
    )
    .orderBy(asc(members.firstName), asc(members.lastName));
  return rows.map((row) => ({
    assignmentId: row.assignmentId,
    startDate: row.startDate,
    notes: row.notes,
    member: toTrainerSafe(row.member),
    lastCheckInAt: row.lastCheckInAt?.toISOString() ?? null,
  }));
}

export async function createAssignment(
  input: CreateAssignment,
  ctx: RequestContext,
): Promise<TrainerAssignmentDto> {
  const today = gymToday();
  const startDate = input.startDate ?? today;
  if (startDate > today) {
    throw validationFailed([{ path: 'startDate', message: 'Cannot start in the future' }]);
  }
  try {
    return await db.transaction(async (tx) => {
      await requireTrainer(tx, input.trainerId);
      const [member] = await tx
        .select({ archivedAt: members.archivedAt })
        .from(members)
        .where(eq(members.id, input.memberId))
        .limit(1);
      if (!member) throw notFound('Member');
      if (member.archivedAt) {
        throw conflict(ERROR_CODES.MEMBER_ARCHIVED, 'This member is archived.');
      }
      const [row] = await tx
        .insert(trainerAssignments)
        .values({
          trainerId: input.trainerId,
          memberId: input.memberId,
          startDate,
          notes: input.notes,
          assignedBy: ctx.actorUserId,
        })
        .returning({ id: trainerAssignments.id });
      await recordAudit(tx, ctx, {
        action: 'TRAINER_ASSIGNED',
        entityType: 'TRAINER_ASSIGNMENT',
        entityId: row!.id,
        after: { trainerId: input.trainerId, memberId: input.memberId, startDate },
      });
      return readAssignment(tx, row!.id);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'trainer_assignments_active_key')) {
      throw conflict(
        ERROR_CODES.ASSIGNMENT_EXISTS,
        'This member is already assigned to this trainer.',
      );
    }
    throw error;
  }
}

export async function endAssignment(
  id: string,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<TrainerAssignmentDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(trainerAssignments)
      .where(eq(trainerAssignments.id, id))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Assignment');
    if (row.endDate) {
      throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This assignment has already ended.');
    }
    const today = gymToday();
    const endDate = row.startDate > today ? row.startDate : today;
    await tx
      .update(trainerAssignments)
      .set({ endDate, endedBy: ctx.actorUserId })
      .where(eq(trainerAssignments.id, id));
    await recordAudit(tx, ctx, {
      action: 'TRAINER_ASSIGNMENT_ENDED',
      entityType: 'TRAINER_ASSIGNMENT',
      entityId: id,
      before: { endDate: null },
      after: { trainerId: row.trainerId, memberId: row.memberId, endDate },
      reason,
    });
    return readAssignment(tx, id);
  });
}
