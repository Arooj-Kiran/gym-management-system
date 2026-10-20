import { ENROLLMENT_STATUSES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { accessDevices } from './access';
import { primaryId, timestamptz } from './columns';
import { members } from './members';
import { users } from './users';

export const enrollmentStatusEnum = pgEnum('enrollment_status', ENROLLMENT_STATUSES);

/** A versioned consent record; enrollment is impossible without one in force (PLAN §3.6). */
export const biometricConsents = pgTable(
  'biometric_consents',
  {
    id: primaryId(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    consentVersion: varchar('consent_version', { length: 32 }).notNull(),
    consentTextSha256: varchar('consent_text_sha256', { length: 64 }).notNull(),
    givenAt: timestamptz('given_at').notNull().defaultNow(),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    withdrawnAt: timestamptz('withdrawn_at'),
    withdrawnRecordedBy: uuid('withdrawn_recorded_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
  },
  (t) => [
    index('biometric_consents_member_idx').on(t.memberId),
    /** At most one consent in force per member. */
    uniqueIndex('biometric_consents_member_current_key')
      .on(t.memberId)
      .where(sql`${t.withdrawnAt} is null`),
    check('biometric_consents_text_hash_hex', sql`${t.consentTextSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'biometric_consents_withdrawal_consistent',
      sql`(${t.withdrawnAt} is null) = (${t.withdrawnRecordedBy} is null)`,
    ),
  ],
);

/**
 * Only the device-side user ID is stored (`template_ref`), never an image or template. It is
 * never logged, masked in responses, and erased once the device confirms deletion (PLAN §6.6).
 */
export const biometricEnrollments = pgTable(
  'biometric_enrollments',
  {
    id: primaryId(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => accessDevices.id, { onDelete: 'restrict' }),
    /** SIMULATED, or the vendor code of a real scanner (ZKTECO, SUPREMA, …). */
    provider: varchar('provider', { length: 32 }).notNull(),
    templateRef: varchar('template_ref', { length: 64 }),
    consentId: uuid('consent_id')
      .notNull()
      .references(() => biometricConsents.id, { onDelete: 'restrict' }),
    status: enrollmentStatusEnum('status').notNull().default('ACTIVE'),
    enrolledBy: uuid('enrolled_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    enrolledAt: timestamptz('enrolled_at').notNull().defaultNow(),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamptz('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 500 }),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    uniqueIndex('biometric_enrollments_device_ref_active_key')
      .on(t.deviceId, t.templateRef)
      .where(sql`${t.status} = 'ACTIVE'`),
    /** One live enrollment per member per device. */
    uniqueIndex('biometric_enrollments_member_device_active_key')
      .on(t.memberId, t.deviceId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('biometric_enrollments_member_idx').on(t.memberId),
    index('biometric_enrollments_device_status_idx').on(t.deviceId, t.status),
    check(
      'biometric_enrollments_sim_ref_matches_provider',
      sql`${t.templateRef} is null or ((${t.provider} = 'SIMULATED') = (${t.templateRef} like 'SIM-%'))`,
    ),
    check(
      'biometric_enrollments_deleted_has_no_ref',
      sql`(${t.status} = 'DELETED') = (${t.templateRef} is null) and (${t.status} = 'DELETED') = (${t.deletedAt} is not null)`,
    ),
    check(
      'biometric_enrollments_revocation_recorded',
      sql`(${t.status} = 'ACTIVE') = (${t.revokedAt} is null)`,
    ),
  ],
);
