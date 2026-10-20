import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';

/**
 * Empty all tables between test files and restore default settings.
 * TRUNCATE is used on purpose: the append-only trigger blocks row-level UPDATE/DELETE only.
 */
export async function resetTables() {
  await db.execute(
    sql`truncate table attendance_corrections, biometric_enrollments, biometric_consents, attendance_records, access_attempts, access_devices, audit_logs, membership_events, memberships, members, membership_plans, user_sessions, staff_profiles, users restart identity cascade`,
  );
  await db.execute(sql`
    update gym_settings set
      gym_name = default,
      expiry_reminder_days = default,
      payment_due_reminder_days = default,
      invoice_due_days = default,
      biometric_retention_days = default,
      class_booking_cutoff_minutes = default
  `);
}
