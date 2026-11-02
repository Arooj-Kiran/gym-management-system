import { SHIFT_STATUSES, TIME_OFF_STATUSES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz } from './columns';
import { members } from './members';
import { users } from './users';

export const timeOffStatusEnum = pgEnum('time_off_status', TIME_OFF_STATUSES);
export const shiftStatusEnum = pgEnum('shift_status', SHIFT_STATUSES);

/**
 * Public and booking details of a TRAINER user (PLAN §3.7). Optional: a trainer without a row
 * reads as bookable with an empty profile, and the first edit creates it. Every trainer_id in the
 * scheduling tables points at users.id, so the profile never gates scheduling integrity.
 */
export const trainerProfiles = pgTable(
  'trainer_profiles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    bio: text('bio'),
    specializations: varchar('specializations', { length: 60 })
      .array()
      .notNull()
      .default(sql`'{}'`),
    certifications: varchar('certifications', { length: 60 })
      .array()
      .notNull()
      .default(sql`'{}'`),
    isBookable: boolean('is_bookable').notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex('trainer_profiles_user_key').on(t.userId)],
);

/** Which trainer looks after which member. Active while end_date is null; ended, never deleted. */
export const trainerAssignments = pgTable(
  'trainer_assignments',
  {
    id: primaryId(),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'restrict' }),
    endedBy: uuid('ended_by').references(() => users.id, { onDelete: 'restrict' }),
    notes: varchar('notes', { length: 500 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('trainer_assignments_active_key')
      .on(t.trainerId, t.memberId)
      .where(sql`${t.endDate} is null`),
    index('trainer_assignments_member_idx').on(t.memberId),
    check('trainer_assignments_dates', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

/** Weekly working hours in gym time. A change closes the open rows and adds new ones. */
export const trainerAvailability = pgTable(
  'trainer_availability',
  {
    id: primaryId(),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    ...timestamps(),
  },
  (t) => [
    index('trainer_availability_trainer_idx').on(t.trainerId, t.weekday),
    check('trainer_availability_weekday', sql`${t.weekday} between 1 and 7`),
    check('trainer_availability_times', sql`${t.endTime} > ${t.startTime}`),
    check(
      'trainer_availability_effective',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
);

export const trainerTimeOff = pgTable(
  'trainer_time_off',
  {
    id: primaryId(),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    reason: varchar('reason', { length: 500 }),
    status: timeOffStatusEnum('status').notNull().default('ACTIVE'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    index('trainer_time_off_trainer_idx').on(t.trainerId, t.startsAt),
    check('trainer_time_off_range', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Staff rota. No overlapping SCHEDULED shifts per user (exclusion constraint in the migrations). */
export const staffShifts = pgTable(
  'staff_shifts',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at').notNull(),
    roleNote: varchar('role_note', { length: 120 }),
    status: shiftStatusEnum('status').notNull().default('SCHEDULED'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    index('staff_shifts_user_starts_idx').on(t.userId, t.startsAt),
    index('staff_shifts_starts_idx').on(t.startsAt),
    check('staff_shifts_range', sql`${t.endsAt} > ${t.startsAt}`),
    check('staff_shifts_max_length', sql`${t.endsAt} - ${t.startsAt} <= interval '16 hours'`),
  ],
);
