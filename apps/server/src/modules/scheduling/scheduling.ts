import { ERROR_CODES, WEEKDAY_LABELS } from '@gms/shared';
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import {
  appointments,
  classBookings,
  classSessions,
  members,
  memberships,
  trainerAvailability,
  trainerProfiles,
  trainerTimeOff,
  users,
} from '../../db/schema';
import { gymWallClock } from '../../lib/dates';
import { conflict, notFound, type AppError } from '../../lib/errors';

/**
 * Shared rules for everything that puts a trainer or a member on the calendar (PLAN §3.9).
 *
 * Lock order, always: the class session row (bookings) → the trainer → the member. Every writer
 * takes the locks it needs in that order, so two requests can never wait on each other in a cycle.
 * The exclusion constraints stay the last line of defence for same-table overlaps.
 */

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

export const lockTrainerSchedule = (tx: DbExecutor, trainerId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trainer-schedule:${trainerId}`}))`);

export const lockMemberSchedule = (tx: DbExecutor, memberId: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`member-schedule:${memberId}`}))`);

const overlaps = (start: SQL, end: SQL, w: TimeWindow) =>
  sql`${start} < ${w.endsAt.toISOString()}::timestamptz and ${end} > ${w.startsAt.toISOString()}::timestamptz`;

const formatTime = (instant: Date) => gymWallClock(instant).time;

/** The trainer, who must hold the TRAINER role and be active; optionally bookable too. */
export async function requireTrainer(
  executor: DbExecutor,
  trainerId: string,
  options: { bookable?: boolean } = {},
) {
  const [row] = await executor
    .select({
      id: users.id,
      role: users.role,
      isActive: users.isActive,
      firstName: users.firstName,
      lastName: users.lastName,
      isBookable: trainerProfiles.isBookable,
    })
    .from(users)
    .leftJoin(trainerProfiles, eq(trainerProfiles.userId, users.id))
    .where(eq(users.id, trainerId))
    .limit(1);
  if (!row || row.role === 'MEMBER') throw notFound('Trainer');
  if (row.role !== 'TRAINER') {
    throw conflict(ERROR_CODES.NOT_A_TRAINER, 'Choose a staff member with the Trainer role.');
  }
  if (!row.isActive) {
    throw conflict(ERROR_CODES.NOT_A_TRAINER, 'This trainer account is deactivated.');
  }
  if (options.bookable && row.isBookable === false) {
    throw conflict(
      ERROR_CODES.TRAINER_NOT_BOOKABLE,
      `${row.firstName} is not taking personal-training bookings.`,
    );
  }
  return row;
}

/**
 * 409 SCHEDULE_CONFLICT when the trainer already teaches a class, has an appointment, or is on
 * time off during the window. Call with the trainer lock held.
 */
export async function assertTrainerFree(
  tx: DbExecutor,
  trainerId: string,
  window: TimeWindow,
  exclude: { sessionId?: string; appointmentId?: string } = {},
) {
  const [session] = await tx
    .select({ startsAt: classSessions.startsAt })
    .from(classSessions)
    .where(
      and(
        eq(classSessions.trainerId, trainerId),
        eq(classSessions.status, 'SCHEDULED'),
        overlaps(sql`${classSessions.startsAt}`, sql`${classSessions.endsAt}`, window),
        exclude.sessionId ? ne(classSessions.id, exclude.sessionId) : undefined,
      ),
    )
    .limit(1);
  if (session) {
    throw conflict(
      ERROR_CODES.SCHEDULE_CONFLICT,
      `The trainer is teaching a class at ${formatTime(session.startsAt)} then.`,
    );
  }
  const [appointment] = await tx
    .select({ startsAt: appointments.startsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.trainerId, trainerId),
        eq(appointments.status, 'BOOKED'),
        overlaps(sql`${appointments.startsAt}`, sql`${appointments.endsAt}`, window),
        exclude.appointmentId ? ne(appointments.id, exclude.appointmentId) : undefined,
      ),
    )
    .limit(1);
  if (appointment) {
    throw conflict(
      ERROR_CODES.SCHEDULE_CONFLICT,
      `The trainer has an appointment at ${formatTime(appointment.startsAt)} then.`,
    );
  }
  const [off] = await tx
    .select({ id: trainerTimeOff.id })
    .from(trainerTimeOff)
    .where(
      and(
        eq(trainerTimeOff.trainerId, trainerId),
        eq(trainerTimeOff.status, 'ACTIVE'),
        overlaps(sql`${trainerTimeOff.startsAt}`, sql`${trainerTimeOff.endsAt}`, window),
      ),
    )
    .limit(1);
  if (off) {
    throw conflict(ERROR_CODES.SCHEDULE_CONFLICT, 'The trainer is on time off then.');
  }
}

/**
 * 409 MEMBER_SCHEDULE_CONFLICT when the member already has a class place (or waitlist spot) or
 * an appointment during the window. Call with the member lock held.
 */
export async function assertMemberFree(
  tx: DbExecutor,
  memberId: string,
  window: TimeWindow,
  exclude: { sessionId?: string; appointmentId?: string } = {},
) {
  const [booking] = await tx
    .select({ startsAt: classSessions.startsAt })
    .from(classBookings)
    .innerJoin(classSessions, eq(classSessions.id, classBookings.sessionId))
    .where(
      and(
        eq(classBookings.memberId, memberId),
        inArray(classBookings.status, ['BOOKED', 'WAITLISTED']),
        eq(classSessions.status, 'SCHEDULED'),
        overlaps(sql`${classSessions.startsAt}`, sql`${classSessions.endsAt}`, window),
        exclude.sessionId ? ne(classSessions.id, exclude.sessionId) : undefined,
      ),
    )
    .limit(1);
  const [appointment] = booking
    ? []
    : await tx
        .select({ startsAt: appointments.startsAt })
        .from(appointments)
        .where(
          and(
            eq(appointments.memberId, memberId),
            eq(appointments.status, 'BOOKED'),
            overlaps(sql`${appointments.startsAt}`, sql`${appointments.endsAt}`, window),
            exclude.appointmentId ? ne(appointments.id, exclude.appointmentId) : undefined,
          ),
        )
        .limit(1);
  const clash = booking ?? appointment;
  if (clash) {
    throw conflict(
      ERROR_CODES.MEMBER_SCHEDULE_CONFLICT,
      `The member already has a ${booking ? 'class' : 'session'} at ${formatTime(clash.startsAt)} then.`,
    );
  }
}

/** Personal training must sit inside one of the trainer's weekly slots for that gym date. */
export async function assertWithinAvailability(
  tx: DbExecutor,
  trainerId: string,
  window: TimeWindow,
) {
  const start = gymWallClock(window.startsAt);
  const end = gymWallClock(window.endsAt);
  // A slot ends at the latest at 23:59 on its own day; a session ending at midnight sits on the next.
  const sameDay = end.date === start.date;
  // The whole day's hours, so a refusal can say what the trainer does work that day.
  const hours = await tx
    .select({ startTime: trainerAvailability.startTime, endTime: trainerAvailability.endTime })
    .from(trainerAvailability)
    .where(
      and(
        eq(trainerAvailability.trainerId, trainerId),
        eq(trainerAvailability.weekday, start.weekday),
        sql`${trainerAvailability.effectiveFrom} <= ${start.date}::date`,
        sql`(${trainerAvailability.effectiveTo} is null or ${trainerAvailability.effectiveTo} >= ${start.date}::date)`,
      ),
    )
    .orderBy(asc(trainerAvailability.startTime));
  const slots = hours.map((slot) => ({
    start: slot.startTime.slice(0, 5),
    end: slot.endTime.slice(0, 5),
  }));
  // Zero-padded HH:MM compares correctly as text.
  if (sameDay && slots.some((slot) => slot.start <= start.time && slot.end >= end.time)) return;

  const day = WEEKDAY_LABELS[start.weekday];
  const worked = slots.map((slot) => `${slot.start}–${slot.end}`).join(', ');
  throw conflict(
    ERROR_CODES.OUTSIDE_AVAILABILITY,
    slots.length === 0
      ? `The trainer has no weekly hours on ${day}, so no session can be booked that day.`
      : `${day} ${start.time}–${end.time} is outside the trainer's hours that day (${worked}).`,
  );
}

const MEMBER_NOT_ELIGIBLE = (message: string) =>
  conflict(ERROR_CODES.MEMBERSHIP_NOT_ELIGIBLE, message);

export interface EligibilityMember {
  archivedAt: Date | null;
  accountStatus: string;
  accessBlocked: boolean;
}

export interface EligibilityMembership {
  startDate: string;
  endDate: string;
  accessDays: number[] | null;
  accessStartTime: string | null;
  accessEndTime: string | null;
}

/** The member's ACTIVE memberships, as needed by `eligibilityProblem`. */
export function loadActiveMemberships(executor: DbExecutor, memberId: string) {
  return executor
    .select({
      startDate: memberships.startDate,
      endDate: memberships.endDate,
      accessDays: memberships.accessDaysSnapshot,
      accessStartTime: memberships.accessStartTimeSnapshot,
      accessEndTime: memberships.accessEndTimeSnapshot,
    })
    .from(memberships)
    .where(and(eq(memberships.memberId, memberId), eq(memberships.status, 'ACTIVE')));
}

/**
 * PLAN §3.9: a member can be booked only with an ACTIVE membership covering the session's gym
 * date (and its access days and hours, when the plan limits them), an active account, and no
 * entry block. Returns the error to throw, or null when the member may be booked.
 */
export function eligibilityProblem(
  member: EligibilityMember,
  active: EligibilityMembership[],
  window: TimeWindow,
): AppError | null {
  if (member.archivedAt) return conflict(ERROR_CODES.MEMBER_ARCHIVED, 'This member is archived.');
  if (member.accountStatus !== 'ACTIVE') {
    return MEMBER_NOT_ELIGIBLE('The member account is inactive.');
  }
  if (member.accessBlocked) return MEMBER_NOT_ELIGIBLE('Entry is blocked for this member.');

  const start = gymWallClock(window.startsAt);
  const end = gymWallClock(window.endsAt);
  const membership = active.find((m) => m.startDate <= start.date && m.endDate >= start.date);
  if (!membership) return MEMBER_NOT_ELIGIBLE(`No active membership covers ${start.date}.`);
  if (membership.accessDays && !membership.accessDays.includes(start.weekday)) {
    return MEMBER_NOT_ELIGIBLE(
      `The membership does not include ${WEEKDAY_LABELS[start.weekday]}s.`,
    );
  }
  if (membership.accessStartTime && membership.accessEndTime) {
    const from = membership.accessStartTime.slice(0, 5);
    const to = membership.accessEndTime.slice(0, 5);
    const endTime = end.date === start.date ? end.time : '24:00';
    if (start.time < from || endTime > to) {
      return MEMBER_NOT_ELIGIBLE(`The membership allows visits ${from}–${to} only.`);
    }
  }
  return null;
}

/** Throws unless the member may be booked for the window (see `eligibilityProblem`). */
export async function assertMemberEligible(tx: DbExecutor, memberId: string, window: TimeWindow) {
  const [member] = await tx
    .select({
      id: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      archivedAt: members.archivedAt,
      accountStatus: members.accountStatus,
      accessBlocked: members.accessBlocked,
    })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw notFound('Member');
  const problem = eligibilityProblem(member, await loadActiveMemberships(tx, memberId), window);
  if (problem) throw problem;
  return member;
}

/** Instant comparisons that read well at call sites. */
export const hasStarted = (startsAt: Date, now = new Date()) => startsAt.getTime() <= now.getTime();

export const minutesBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / 60_000);

export const addMinutes = (instant: Date, minutes: number) =>
  new Date(instant.getTime() + minutes * 60_000);
