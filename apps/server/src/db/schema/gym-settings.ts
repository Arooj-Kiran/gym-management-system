import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, varchar } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from './columns';

/** Exactly one row (enforced by a unique expression index in the migrations). */
export const gymSettings = pgTable(
  'gym_settings',
  {
    id: primaryId(),
    gymName: varchar('gym_name', { length: 120 }).notNull().default('My Gym'),
    expiryReminderDays: integer('expiry_reminder_days').notNull().default(7),
    paymentDueReminderDays: integer('payment_due_reminder_days').notNull().default(3),
    invoiceDueDays: integer('invoice_due_days').notNull().default(0),
    biometricRetentionDays: integer('biometric_retention_days').notNull().default(30),
    classBookingCutoffMinutes: integer('class_booking_cutoff_minutes').notNull().default(60),
    /** C1 (PLAN §3.3): off by default; only the Admin may change it. */
    requireFullPaymentBeforeActivation: boolean('require_full_payment_before_activation')
      .notNull()
      .default(false),
    ...timestamps(),
  },
  (t) => [
    check('gym_settings_gym_name_length', sql`char_length(${t.gymName}) between 1 and 120`),
    check('gym_settings_expiry_reminder_days', sql`${t.expiryReminderDays} between 1 and 60`),
    check(
      'gym_settings_payment_due_reminder_days',
      sql`${t.paymentDueReminderDays} between 0 and 30`,
    ),
    check('gym_settings_invoice_due_days', sql`${t.invoiceDueDays} between 0 and 60`),
    check(
      'gym_settings_biometric_retention_days',
      sql`${t.biometricRetentionDays} between 1 and 365`,
    ),
    check(
      'gym_settings_class_booking_cutoff_minutes',
      sql`${t.classBookingCutoffMinutes} between 0 and 1440`,
    ),
  ],
);
