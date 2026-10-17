import { MEMBERSHIP_EVENT_TYPES, MEMBERSHIP_STATUSES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz } from './columns';
import { members } from './members';
import { membershipPlans } from './membership-plans';
import { users } from './users';

export const membershipStatusEnum = pgEnum('membership_status', MEMBERSHIP_STATUSES);
export const membershipEventTypeEnum = pgEnum('membership_event_type', MEMBERSHIP_EVENT_TYPES);

/**
 * One row per membership period; a renewal creates a new row (PLAN §3.3).
 * The exclusion constraint `memberships_no_overlap` (no overlapping current periods per member)
 * is hand-written in the migration: Drizzle cannot declare it.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: primaryId(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => membershipPlans.id, { onDelete: 'restrict' }),
    planNameSnapshot: varchar('plan_name_snapshot', { length: 80 }).notNull(),
    priceMinorSnapshot: bigint('price_minor_snapshot', { mode: 'number' }).notNull(),
    accessDaysSnapshot: smallint('access_days_snapshot').array(),
    accessStartTimeSnapshot: time('access_start_time_snapshot'),
    accessEndTimeSnapshot: time('access_end_time_snapshot'),
    /** Inclusive calendar days in gym time. */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    status: membershipStatusEnum('status').notNull().default('PENDING'),
    activatedAt: timestamptz('activated_at'),
    activatedBy: uuid('activated_by').references(() => users.id, { onDelete: 'restrict' }),
    suspendedAt: timestamptz('suspended_at'),
    suspensionReason: varchar('suspension_reason', { length: 500 }),
    cancelledAt: timestamptz('cancelled_at'),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    cancellationReason: varchar('cancellation_reason', { length: 500 }),
    totalSuspendedDays: integer('total_suspended_days').notNull().default(0),
    renewedFromId: uuid('renewed_from_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull().default(1),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: 'memberships_renewed_from_id_fk',
      columns: [t.renewedFromId],
      foreignColumns: [t.id],
    }).onDelete('restrict'),
    index('memberships_member_start_idx').on(t.memberId, t.startDate.desc()),
    index('memberships_status_end_idx').on(t.status, t.endDate),
    index('memberships_plan_idx').on(t.planId),
    index('memberships_renewed_from_idx').on(t.renewedFromId),
    check('memberships_dates_ordered', sql`${t.endDate} >= ${t.startDate}`),
    check('memberships_price_non_negative', sql`${t.priceMinorSnapshot} >= 0`),
    check('memberships_suspended_days_non_negative', sql`${t.totalSuspendedDays} >= 0`),
    check('memberships_version_positive', sql`${t.version} > 0`),
    check('memberships_not_renewed_from_self', sql`${t.renewedFromId} <> ${t.id}`),
    check(
      'memberships_activation_recorded',
      sql`${t.status} not in ('ACTIVE', 'SUSPENDED', 'EXPIRED') or ${t.activatedAt} is not null`,
    ),
    check(
      'memberships_suspension_consistent',
      sql`(${t.status} = 'SUSPENDED') = (${t.suspendedAt} is not null)`,
    ),
    check(
      'memberships_cancellation_consistent',
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} is not null)`,
    ),
  ],
);

/** Status and change history. Append-only: a trigger rejects UPDATE and DELETE (migrations). */
export const membershipEvents = pgTable(
  'membership_events',
  {
    id: primaryId(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    eventType: membershipEventTypeEnum('event_type').notNull(),
    fromStatus: membershipStatusEnum('from_status'),
    toStatus: membershipStatusEnum('to_status').notNull(),
    oldValues: jsonb('old_values').$type<Record<string, unknown>>(),
    newValues: jsonb('new_values').$type<Record<string, unknown>>(),
    reason: text('reason'),
    /** null when the system job made the change. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('membership_events_membership_created_idx').on(t.membershipId, t.createdAt),
    index('membership_events_member_created_idx').on(t.memberId, t.createdAt),
    index('membership_events_type_created_idx').on(t.eventType, t.createdAt),
  ],
);
