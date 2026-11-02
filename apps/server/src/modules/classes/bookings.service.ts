import {
  ERROR_CODES,
  permissionScope,
  SCOPES,
  type ClassAttendanceStatus,
  type ClassBookingDto,
} from '@gms/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, type DbExecutor } from '../../db/client';
import { classBookings, classSessions, members, users } from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, forbidden, notFound } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import { memberPhotoUrl } from '../members/members.service';
import { qualified } from '../memberships/current-membership';
import {
  addMinutes,
  assertMemberEligible,
  assertMemberFree,
  hasStarted,
  lockMemberSchedule,
} from '../scheduling/scheduling';

type Auth = Express.AuthContext;
type SessionRow = typeof classSessions.$inferSelect;

/**
 * Who is booking or cancelling. Staff may act until the class starts; a member through the
 * portal only until `cutoffMinutes` before it (gym setting class_booking_cutoff_minutes).
 */
export type BookingActor =
  { kind: 'staff' } | { kind: 'member'; memberId: string; cutoffMinutes: number };

/** Lock a session row. Every booking change for a session serialises on this lock (§3.9). */
export async function lockSession(tx: DbExecutor, id: string): Promise<SessionRow> {
  const [row] = await tx
    .select()
    .from(classSessions)
    .where(eq(classSessions.id, id))
    .for('update')
    .limit(1);
  if (!row) throw notFound('Class session');
  return row;
}

/** Places taken: booked, attended or no-show (a no-show still used the place). */
export async function seatedCount(tx: DbExecutor, sessionId: string): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(classBookings)
    .where(
      and(
        eq(classBookings.sessionId, sessionId),
        inArray(classBookings.status, ['BOOKED', 'ATTENDED', 'NO_SHOW']),
      ),
    );
  return row?.count ?? 0;
}

/**
 * Fill free places from the waitlist, first in line first. Call with the session row locked.
 * Promoted members were eligible and free when they joined the waitlist, and a waitlist place
 * keeps their time blocked, so no re-check is needed.
 */
export async function promoteWaitlist(
  tx: DbExecutor,
  sessionId: string,
  capacity: number,
  ctx: RequestContext,
): Promise<number> {
  const free = capacity - (await seatedCount(tx, sessionId));
  if (free <= 0) return 0;
  const next = await tx
    .select({ id: classBookings.id, memberId: classBookings.memberId })
    .from(classBookings)
    .where(and(eq(classBookings.sessionId, sessionId), eq(classBookings.status, 'WAITLISTED')))
    .orderBy(asc(classBookings.waitlistPosition))
    .limit(free);
  for (const booking of next) {
    await tx
      .update(classBookings)
      .set({ status: 'BOOKED', waitlistPosition: null })
      .where(eq(classBookings.id, booking.id));
    await recordAudit(tx, ctx, {
      action: 'CLASS_WAITLIST_PROMOTED',
      entityType: 'CLASS_BOOKING',
      entityId: booking.id,
      before: { status: 'WAITLISTED' },
      after: { status: 'BOOKED', sessionId, memberId: booking.memberId },
    });
  }
  return next.length;
}

const bookedByUser = alias(users, 'booked_by_user');

/** Waitlist rank (1 = next in line), counted live so gaps in positions never show. */
export const waitlistRank = sql<number | null>`case when ${classBookings.status} = 'WAITLISTED' then
  (select count(*)::int from class_bookings w where w.session_id = ${qualified(classBookings.sessionId)}
    and w.status = 'WAITLISTED' and w.waitlist_position <= ${qualified(classBookings.waitlistPosition)})
  end`;

function selectBookings(executor: DbExecutor = db) {
  return executor
    .select({
      booking: classBookings,
      waitlistRank,
      memberCode: members.memberCode,
      firstName: members.firstName,
      lastName: members.lastName,
      photoKey: members.profilePhotoKey,
      bookedByFirstName: bookedByUser.firstName,
      bookedByLastName: bookedByUser.lastName,
    })
    .from(classBookings)
    .innerJoin(members, eq(members.id, classBookings.memberId))
    .leftJoin(bookedByUser, eq(bookedByUser.id, classBookings.bookedBy));
}

type BookingRow = Awaited<ReturnType<typeof selectBookings>>[number];

function toBookingDto(row: BookingRow): ClassBookingDto {
  const { booking } = row;
  return {
    id: booking.id,
    sessionId: booking.sessionId,
    status: booking.status,
    waitlistPosition: row.waitlistRank,
    bookedAt: booking.bookedAt.toISOString(),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    member: {
      id: booking.memberId,
      memberCode: row.memberCode,
      firstName: row.firstName,
      lastName: row.lastName,
      photoUrl: memberPhotoUrl(`/api/v1/members/${booking.memberId}/photo`, row.photoKey),
    },
    bookedByName: row.bookedByFirstName ? `${row.bookedByFirstName} ${row.bookedByLastName}` : null,
  };
}

export async function readBooking(executor: DbExecutor, id: string): Promise<ClassBookingDto> {
  const [row] = await selectBookings(executor).where(eq(classBookings.id, id)).limit(1);
  if (!row) throw notFound('Booking');
  return toBookingDto(row);
}

/** OWN_SESSIONS (trainers): only the sessions they teach. */
function assertSessionInScope(
  auth: Auth,
  permission: 'bookings:read' | 'classes:mark-attendance',
  session: { trainerId: string },
) {
  if (
    permissionScope(auth.user.role, permission) === SCOPES.OWN_SESSIONS &&
    session.trainerId !== auth.user.id
  ) {
    throw forbidden('You can only do this for classes you teach.');
  }
}

/** The roster: places in booking order, then the waitlist in line order, then cancellations. */
export async function listSessionBookings(sessionId: string, auth: Auth) {
  const [session] = await db
    .select({ trainerId: classSessions.trainerId })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
    .limit(1);
  if (!session) throw notFound('Class session');
  assertSessionInScope(auth, 'bookings:read', session);
  const rows = await selectBookings()
    .where(eq(classBookings.sessionId, sessionId))
    .orderBy(
      sql`case ${classBookings.status} when 'WAITLISTED' then 1 when 'CANCELLED' then 2 else 0 end`,
      asc(classBookings.waitlistPosition),
      asc(classBookings.bookedAt),
    );
  return rows.map(toBookingDto);
}

function assertOpen(session: SessionRow, actor: BookingActor, action: 'book' | 'cancel') {
  if (session.status !== 'SCHEDULED') {
    throw conflict(ERROR_CODES.CLASS_NOT_BOOKABLE, 'This class has been cancelled.');
  }
  if (hasStarted(session.startsAt)) {
    throw conflict(ERROR_CODES.BOOKING_CLOSED, 'This class has already started.');
  }
  if (actor.kind === 'member' && hasStarted(addMinutes(session.startsAt, -actor.cutoffMinutes))) {
    throw conflict(
      ERROR_CODES.BOOKING_CLOSED,
      `Online ${action === 'book' ? 'booking' : 'cancellation'} closes ${actor.cutoffMinutes} minutes before the class. Please contact the front desk.`,
    );
  }
}

/**
 * Book a place, or a waitlist place when the class is full (PLAN §3.9). The session row lock
 * serialises concurrent bookings, so capacity can never be exceeded; the partial unique index
 * is the backstop against a duplicate.
 */
export async function bookSession(
  sessionId: string,
  memberId: string,
  actor: BookingActor,
  ctx: RequestContext,
): Promise<ClassBookingDto> {
  try {
    return await db.transaction(async (tx) => {
      const session = await lockSession(tx, sessionId);
      assertOpen(session, actor, 'book');
      await lockMemberSchedule(tx, memberId);
      const window = { startsAt: session.startsAt, endsAt: session.endsAt };
      await assertMemberEligible(tx, memberId, window);
      const [existing] = await tx
        .select({ id: classBookings.id })
        .from(classBookings)
        .where(
          and(
            eq(classBookings.sessionId, sessionId),
            eq(classBookings.memberId, memberId),
            inArray(classBookings.status, ['BOOKED', 'WAITLISTED']),
          ),
        )
        .limit(1);
      if (existing) throw duplicateBooking();
      await assertMemberFree(tx, memberId, window, { sessionId });

      const seated = await seatedCount(tx, sessionId);
      let waitlistPosition: number | null = null;
      if (seated >= session.capacity) {
        const [last] = await tx
          .select({ max: sql<number | null>`max(${classBookings.waitlistPosition})` })
          .from(classBookings)
          .where(eq(classBookings.sessionId, sessionId));
        waitlistPosition = (last?.max ?? 0) + 1;
      }
      const status = waitlistPosition === null ? 'BOOKED' : 'WAITLISTED';
      const [row] = await tx
        .insert(classBookings)
        .values({ sessionId, memberId, status, waitlistPosition, bookedBy: ctx.actorUserId })
        .returning({ id: classBookings.id });
      await recordAudit(tx, ctx, {
        action: 'CLASS_BOOKED',
        entityType: 'CLASS_BOOKING',
        entityId: row!.id,
        after: { sessionId, memberId, status, via: actor.kind === 'member' ? 'PORTAL' : 'STAFF' },
      });
      return readBooking(tx, row!.id);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'class_bookings_active_key')) throw duplicateBooking();
    throw error;
  }
}

const duplicateBooking = () =>
  conflict(ERROR_CODES.DUPLICATE_BOOKING, 'This member is already booked on this class.');

/**
 * Cancel a place or waitlist place. A freed place goes to the first person on the waitlist in
 * the same transaction. A member can only reach their own bookings (another id reads as 404).
 */
export async function cancelBooking(
  bookingId: string,
  actor: BookingActor,
  ctx: RequestContext,
): Promise<ClassBookingDto> {
  const [found] = await db
    .select({ sessionId: classBookings.sessionId, memberId: classBookings.memberId })
    .from(classBookings)
    .where(eq(classBookings.id, bookingId))
    .limit(1);
  if (!found || (actor.kind === 'member' && found.memberId !== actor.memberId)) {
    throw notFound('Booking');
  }
  return db.transaction(async (tx) => {
    const session = await lockSession(tx, found.sessionId);
    const [booking] = await tx
      .select()
      .from(classBookings)
      .where(eq(classBookings.id, bookingId))
      .for('update')
      .limit(1);
    if (!booking || (booking.status !== 'BOOKED' && booking.status !== 'WAITLISTED')) {
      throw conflict(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        'Only a booked or waitlisted place can be cancelled.',
      );
    }
    assertOpen(session, actor, 'cancel');
    await tx
      .update(classBookings)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), waitlistPosition: null })
      .where(eq(classBookings.id, bookingId));
    await recordAudit(tx, ctx, {
      action: 'CLASS_BOOKING_CANCELLED',
      entityType: 'CLASS_BOOKING',
      entityId: bookingId,
      before: { status: booking.status },
      after: {
        status: 'CANCELLED',
        sessionId: booking.sessionId,
        memberId: booking.memberId,
        via: actor.kind === 'member' ? 'PORTAL' : 'STAFF',
      },
    });
    if (booking.status === 'BOOKED') {
      await promoteWaitlist(tx, session.id, session.capacity, ctx);
    }
    return readBooking(tx, bookingId);
  });
}

/** Attended or no-show, once the class has started. Trainers mark their own classes only. */
export async function markAttendance(
  bookingId: string,
  status: ClassAttendanceStatus,
  auth: Auth,
  ctx: RequestContext,
): Promise<ClassBookingDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ booking: classBookings, session: classSessions })
      .from(classBookings)
      .innerJoin(classSessions, eq(classSessions.id, classBookings.sessionId))
      .where(eq(classBookings.id, bookingId))
      .for('update', { of: classBookings })
      .limit(1);
    if (!row) throw notFound('Booking');
    assertSessionInScope(auth, 'classes:mark-attendance', row.session);
    if (row.session.status === 'CANCELLED') {
      throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This class was cancelled.');
    }
    if (!hasStarted(row.session.startsAt)) {
      throw conflict(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        'Attendance can be marked once the class has started.',
      );
    }
    const before = row.booking.status;
    if (before !== 'BOOKED' && before !== 'ATTENDED' && before !== 'NO_SHOW') {
      throw conflict(
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        'Only members with a place can be marked.',
      );
    }
    if (before !== status) {
      await tx.update(classBookings).set({ status }).where(eq(classBookings.id, bookingId));
      await recordAudit(tx, ctx, {
        action: 'CLASS_ATTENDANCE_MARKED',
        entityType: 'CLASS_BOOKING',
        entityId: bookingId,
        before: { status: before },
        after: { status, sessionId: row.session.id, memberId: row.booking.memberId },
      });
    }
    return readBooking(tx, bookingId);
  });
}
