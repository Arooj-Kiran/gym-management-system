import { DURATION_UNITS, PLAN_TYPES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';

export const planTypeEnum = pgEnum('plan_type', PLAN_TYPES);
export const durationUnitEnum = pgEnum('duration_unit', DURATION_UNITS);

export const membershipPlans = pgTable(
  'membership_plans',
  {
    id: primaryId(),
    name: varchar('name', { length: 80 }).notNull(),
    planType: planTypeEnum('plan_type').notNull(),
    durationValue: integer('duration_value').notNull(),
    durationUnit: durationUnitEnum('duration_unit').notNull(),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull(),
    description: text('description'),
    benefits: text('benefits')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowPartialPayment: boolean('allow_partial_payment').notNull().default(false),
    /** ISO weekdays 1–7; null = every day. */
    accessDays: smallint('access_days').array(),
    accessStartTime: time('access_start_time'),
    accessEndTime: time('access_end_time'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('membership_plans_name_key').on(sql`lower(${t.name})`),
    index('membership_plans_active_idx').on(t.isActive),
    check('membership_plans_name_length', sql`char_length(${t.name}) between 2 and 80`),
    check('membership_plans_price_non_negative', sql`${t.priceMinor} >= 0`),
    check('membership_plans_duration_positive', sql`${t.durationValue} > 0`),
    check(
      'membership_plans_duration_matches_type',
      sql`case ${t.planType}
        when 'MONTHLY' then ${t.durationUnit} = 'MONTH' and ${t.durationValue} = 1
        when 'QUARTERLY' then ${t.durationUnit} = 'MONTH' and ${t.durationValue} = 3
        when 'SIX_MONTH' then ${t.durationUnit} = 'MONTH' and ${t.durationValue} = 6
        when 'ANNUAL' then ${t.durationUnit} = 'MONTH' and ${t.durationValue} = 12
        else true end`,
    ),
    check(
      'membership_plans_description_length',
      sql`${t.description} is null or char_length(${t.description}) <= 2000`,
    ),
    check(
      'membership_plans_access_days_valid',
      sql`${t.accessDays} is null or (cardinality(${t.accessDays}) between 1 and 7 and ${t.accessDays} <@ array[1,2,3,4,5,6,7]::smallint[])`,
    ),
    check(
      'membership_plans_access_hours_valid',
      sql`(${t.accessStartTime} is null and ${t.accessEndTime} is null) or (${t.accessStartTime} is not null and ${t.accessEndTime} is not null and ${t.accessStartTime} < ${t.accessEndTime})`,
    ),
  ],
);
