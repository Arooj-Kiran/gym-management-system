import { APPOINTMENT_STATUSES, BOOKING_STATUSES, CLASS_SESSION_STATUSES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, primaryId, timestamps, timestamptz } from './columns';
import { members } from './members';
import { users } from './users';

export const classSessionStatusEnum = pgEnum('class_session_status', CLASS_SESSION_STATUSES);
export const bookingStatusEnum = pgEnum('booking_status', BOOKING_STATUSES);
export const appointmentStatusEnum = pgEnum('appointment_status', APPOINTMENT_STATUSES);

/** Class templates (PLAN §3.9). Archived with is_active = false, never deleted. */
export const fitnessClasses = pgTable(
  'fitness_classes',
  {
    id: primaryId(),
    name: citext('name').notNull(),
    description: varchar('description', { length: 1000 }),
    defaultDurationMinutes: smallint('default_duration_minutes').notNull(),
    defaultCapacity: smallint('default_capacity').notNull(),
    defaultTrainerId: uuid('default_trainer_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('fitness_classes_name_key').on(t.name),
    check('fitness_classes_duration', sql`${t.defaultDurationMinutes} between 15 and 240`),
    check('fitness_classes_capacity', sql`${t.defaultCapacity} between 1 and 200`),
  ],
);

/**
 * One occurrence of a class. Exclusion constraints (migrations): no overlapping SCHEDULED sessions
 * for the same trainer, or for the same room.
 */
export const classSessions = pgTable(
  'class_sessions',
  {
    id: primaryId(),
    classId: uuid('class_id')
      .notNull()
      .references(() => fitnessClasses.id, { onDelete: 'restrict' }),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    capacity: smallint('capacity').notNull(),
    room: citext('room'),
    status: classSessionStatusEnum('status').notNull().default('SCHEDULED'),
    cancelReason: varchar('cancel_reason', { length: 500 }),
    ...timestamps(),
  },
  (t) => [
    index('class_sessions_starts_idx').on(t.startsAt),
    index('class_sessions_trainer_starts_idx').on(t.trainerId, t.startsAt),
    index('class_sessions_class_idx').on(t.classId),
    check('class_sessions_range', sql`${t.endsAt} > ${t.startsAt}`),
    check('class_sessions_capacity', sql`${t.capacity} between 1 and 200`),
    check(
      'class_sessions_cancel_reason',
      sql`(${t.status} = 'CANCELLED') = (${t.cancelReason} is not null)`,
    ),
  ],
);

/**
 * A member's place (or waitlist spot) in a session. The partial unique index blocks a second
 * active booking; capacity is checked with the session row locked FOR UPDATE.
 */
export const classBookings = pgTable(
  'class_bookings',
  {
    id: primaryId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    status: bookingStatusEnum('status').notNull(),
    /** Order on the waitlist (gaps allowed; the shown position is the rank). */
    waitlistPosition: integer('waitlist_position'),
    bookedAt: timestamptz('booked_at').notNull().defaultNow(),
    cancelledAt: timestamptz('cancelled_at'),
    bookedBy: uuid('booked_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('class_bookings_active_key')
      .on(t.sessionId, t.memberId)
      .where(sql`${t.status} in ('BOOKED', 'WAITLISTED')`),
    index('class_bookings_session_idx').on(t.sessionId, t.status),
    index('class_bookings_member_idx').on(t.memberId),
    check(
      'class_bookings_waitlist_position',
      sql`(${t.status} = 'WAITLISTED') = (${t.waitlistPosition} is not null)`,
    ),
    check(
      'class_bookings_cancelled_at',
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} is not null)`,
    ),
  ],
);

/**
 * Personal training. Exclusion constraints (migrations): no overlap per trainer and none per
 * member while BOOKED. Class and time-off conflicts are checked in the service under a
 * per-trainer advisory lock.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: primaryId(),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    status: appointmentStatusEnum('status').notNull().default('BOOKED'),
    notes: varchar('notes', { length: 500 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    index('appointments_trainer_starts_idx').on(t.trainerId, t.startsAt),
    index('appointments_member_starts_idx').on(t.memberId, t.startsAt),
    check('appointments_range', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);
