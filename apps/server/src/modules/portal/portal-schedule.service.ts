import type {
  ClassBookingDto,
  MyAppointmentDto,
  MyBookingBrief,
  MyClassSessionDto,
  MyScheduleItemDto,
  PublicTrainerDto,
  classSessionListQuerySchema,
} from '@gms/shared';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db } from '../../db/client';
import { appointments, classBookings, classSessions, fitnessClasses, users } from '../../db/schema';
import type { RequestContext } from '../../lib/request-context';
import {
  listMyAppointments,
  setAppointmentStatus,
  toMyAppointment,
} from '../appointments/appointments.service';
import { bookSession, cancelBooking, waitlistRank } from '../classes/bookings.service';
import { selectSessions, sessionRangeFilter, toSessionDto } from '../classes/classes.service';
import { addMinutes, eligibilityProblem, loadActiveMemberships } from '../scheduling/scheduling';
import { loadSettingsRow } from '../settings/settings.service';
import { listPublicTrainers } from '../trainers/trainers.service';
import { requireOwnRow } from './portal.service';

type SessionListQuery = z.output<typeof classSessionListQuerySchema>;

/**
 * Member portal: classes, personal training and trainers (PLAN §4.10). The member always comes
 * from the session; a booking or appointment id belonging to someone else reads as 404.
 */

export async function myTrainers(userId: string): Promise<PublicTrainerDto[]> {
  const member = await requireOwnRow(db, userId);
  return listPublicTrainers(member.id);
}

const memberActor = async (memberId: string) => ({
  kind: 'member' as const,
  memberId,
  cutoffMinutes: (await loadSettingsRow(db)).classBookingCutoffMinutes,
});

/** Sessions in the range with the member's own booking and whether they can book now. */
export async function myClassSessions(
  userId: string,
  query: SessionListQuery,
): Promise<MyClassSessionDto[]> {
  const member = await requireOwnRow(db, userId);
  const [rows, mine, active, settings] = await Promise.all([
    selectSessions()
      .where(sessionRangeFilter({ ...query, includeCancelled: true }))
      .orderBy(asc(classSessions.startsAt), asc(fitnessClasses.name)),
    db
      .select({
        id: classBookings.id,
        sessionId: classBookings.sessionId,
        status: classBookings.status,
        rank: waitlistRank,
      })
      .from(classBookings)
      .where(
        and(
          eq(classBookings.memberId, member.id),
          inArray(classBookings.status, ['BOOKED', 'WAITLISTED', 'ATTENDED', 'NO_SHOW']),
        ),
      ),
    loadActiveMemberships(db, member.id),
    loadSettingsRow(db),
  ]);
  const bookingBySession = new Map<string, MyBookingBrief>(
    mine.map((b) => [b.sessionId, { id: b.id, status: b.status, waitlistPosition: b.rank }]),
  );
  const now = new Date();
  const cutoff = settings.classBookingCutoffMinutes;
  return rows
    .filter((row) => row.session.status !== 'CANCELLED' || bookingBySession.has(row.session.id))
    .map((row) => {
      const { cancelReason: _hidden, ...dto } = toSessionDto(row, now);
      const myBooking = bookingBySession.get(row.session.id) ?? null;
      let reason: string | null = null;
      if (myBooking) {
        // Already booked or waitlisted: the booking itself is shown instead.
      } else if (row.session.status !== 'SCHEDULED') reason = 'This class has been cancelled.';
      else if (addMinutes(row.session.startsAt, -cutoff) <= now) {
        reason = 'Online booking for this class has closed.';
      } else {
        reason =
          eligibilityProblem(member, active, {
            startsAt: row.session.startsAt,
            endsAt: row.session.endsAt,
          })?.message ?? null;
      }
      return {
        ...dto,
        myBooking,
        bookable: !myBooking && reason === null,
        notBookableReason: reason,
      };
    });
}

export async function bookMyClass(
  userId: string,
  sessionId: string,
  ctx: RequestContext,
): Promise<ClassBookingDto> {
  const member = await requireOwnRow(db, userId);
  return bookSession(sessionId, member.id, await memberActor(member.id), ctx);
}

export async function cancelMyBooking(
  userId: string,
  bookingId: string,
  ctx: RequestContext,
): Promise<ClassBookingDto> {
  const member = await requireOwnRow(db, userId);
  return cancelBooking(bookingId, await memberActor(member.id), ctx);
}

export async function myAppointments(userId: string): Promise<MyAppointmentDto[]> {
  const member = await requireOwnRow(db, userId);
  return listMyAppointments(member.id);
}

export async function cancelMyAppointment(
  userId: string,
  appointmentId: string,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<MyAppointmentDto> {
  const member = await requireOwnRow(db, userId);
  const dto = await setAppointmentStatus(
    appointmentId,
    'CANCELLED',
    { kind: 'member', memberId: member.id },
    reason,
    ctx,
  );
  return toMyAppointment(dto);
}

const scheduleTrainer = alias(users, 'schedule_trainer');

/** Everything still to come: class places, waitlist places and booked personal training. */
export async function mySchedule(userId: string): Promise<MyScheduleItemDto[]> {
  const member = await requireOwnRow(db, userId);
  const now = new Date();
  const [classes, sessions] = await Promise.all([
    db
      .select({
        id: classBookings.id,
        status: classBookings.status,
        rank: waitlistRank,
        title: fitnessClasses.name,
        startsAt: classSessions.startsAt,
        endsAt: classSessions.endsAt,
        room: classSessions.room,
        trainerFirstName: scheduleTrainer.firstName,
        trainerLastName: scheduleTrainer.lastName,
      })
      .from(classBookings)
      .innerJoin(classSessions, eq(classSessions.id, classBookings.sessionId))
      .innerJoin(fitnessClasses, eq(fitnessClasses.id, classSessions.classId))
      .innerJoin(scheduleTrainer, eq(scheduleTrainer.id, classSessions.trainerId))
      .where(
        and(
          eq(classBookings.memberId, member.id),
          inArray(classBookings.status, ['BOOKED', 'WAITLISTED']),
          eq(classSessions.status, 'SCHEDULED'),
          gt(classSessions.endsAt, now),
        ),
      ),
    db
      .select({
        id: appointments.id,
        status: appointments.status,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        trainerFirstName: scheduleTrainer.firstName,
        trainerLastName: scheduleTrainer.lastName,
      })
      .from(appointments)
      .innerJoin(scheduleTrainer, eq(scheduleTrainer.id, appointments.trainerId))
      .where(
        and(
          eq(appointments.memberId, member.id),
          eq(appointments.status, 'BOOKED'),
          gt(appointments.endsAt, now),
        ),
      ),
  ]);
  const items: MyScheduleItemDto[] = [
    ...classes.map((row) => ({
      kind: 'CLASS' as const,
      id: row.id,
      title: row.title,
      trainerName: `${row.trainerFirstName} ${row.trainerLastName}`,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      room: row.room,
      status: row.status,
      waitlistPosition: row.rank,
    })),
    ...sessions.map((row) => ({
      kind: 'APPOINTMENT' as const,
      id: row.id,
      title: 'Personal training',
      trainerName: `${row.trainerFirstName} ${row.trainerLastName}`,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      room: null,
      status: row.status,
      waitlistPosition: null,
    })),
  ];
  return items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
