import {
  ACCESS_REASONS,
  ACCESS_RESULTS,
  ACCESS_SOURCES,
  ATTENDANCE_STATUSES,
  CORRECTION_FIELDS,
  DEVICE_HEALTH,
  DEVICE_STATUSES,
  DEVICE_TYPES,
} from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, timestamptz } from './columns';
import { members } from './members';
import { memberships } from './memberships';
import { users } from './users';

export const deviceTypeEnum = pgEnum('device_type', DEVICE_TYPES);
export const deviceStatusEnum = pgEnum('device_status', DEVICE_STATUSES);
export const deviceHealthEnum = pgEnum('device_health', DEVICE_HEALTH);
export const accessSourceEnum = pgEnum('access_source', ACCESS_SOURCES);
export const accessResultEnum = pgEnum('access_result', ACCESS_RESULTS);
export const accessReasonEnum = pgEnum('access_reason', ACCESS_REASONS);
export const attendanceStatusEnum = pgEnum('attendance_status', ATTENDANCE_STATUSES);
export const correctionFieldEnum = pgEnum('correction_field', CORRECTION_FIELDS);

/**
 * Scanners (real or simulated). The source of every attempt is derived from `device_type` on the
 * server, never from the client (PLAN §3.5). Only the SHA-256 of the device key is stored.
 */
export const accessDevices = pgTable(
  'access_devices',
  {
    id: primaryId(),
    name: varchar('name', { length: 80 }).notNull(),
    location: varchar('location', { length: 80 }).notNull(),
    deviceType: deviceTypeEnum('device_type').notNull(),
    vendor: varchar('vendor', { length: 40 }),
    model: varchar('model', { length: 60 }),
    serialNumber: varchar('serial_number', { length: 60 }),
    apiKeyHash: varchar('api_key_hash', { length: 64 }).notNull(),
    keyRotatedAt: timestamptz('key_rotated_at').notNull().defaultNow(),
    status: deviceStatusEnum('status').notNull().default('ACTIVE'),
    lastSeenAt: timestamptz('last_seen_at'),
    lastHealth: deviceHealthEnum('last_health'),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('access_devices_api_key_hash_key').on(t.apiKeyHash),
    check('access_devices_api_key_hash_hex', sql`${t.apiKeyHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'access_devices_simulated_has_no_hardware',
      sql`${t.deviceType} = 'REAL' or (${t.vendor} is null and ${t.model} is null and ${t.serialNumber} is null)`,
    ),
  ],
);

/**
 * Every scan, granted or denied. Append-only: a trigger rejects UPDATE and DELETE (migrations).
 * `attendance_id` references attendance_records through a DEFERRABLE foreign key declared in the
 * migrations: the attempt is written first, its attendance row second, in one transaction.
 */
export const accessAttempts = pgTable(
  'access_attempts',
  {
    id: primaryId(),
    /** Device time, sanity-checked against the server clock. */
    occurredAt: timestamptz('occurred_at').notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
    deviceId: uuid('device_id').references(() => accessDevices.id, { onDelete: 'restrict' }),
    source: accessSourceEnum('source').notNull(),
    eventId: uuid('event_id'),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'restrict' }),
    membershipId: uuid('membership_id').references(() => memberships.id, {
      onDelete: 'restrict',
    }),
    result: accessResultEnum('result').notNull(),
    reason: accessReasonEnum('reason').notNull(),
    isDuplicate: boolean('is_duplicate').notNull().default(false),
    attendanceId: uuid('attendance_id'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    uploadedFromOutbox: boolean('uploaded_from_outbox').notNull().default(false),
    /** The scanner's own error code for SCANNER_UNAVAILABLE. */
    errorCode: varchar('error_code', { length: 64 }),
  },
  (t) => [
    uniqueIndex('access_attempts_device_event_key')
      .on(t.deviceId, t.eventId)
      .where(sql`${t.eventId} is not null`),
    index('access_attempts_occurred_idx').on(t.occurredAt.desc()),
    index('access_attempts_member_occurred_idx').on(t.memberId, t.occurredAt.desc()),
    index('access_attempts_result_reason_occurred_idx').on(t.result, t.reason, t.occurredAt),
    index('access_attempts_attendance_idx').on(t.attendanceId),
    check('access_attempts_result_matches_reason', sql`(${t.result} = 'GRANTED') = (${t.reason} = 'GRANTED')`),
    check(
      'access_attempts_granted_is_complete',
      sql`${t.result} = 'DENIED' or (${t.memberId} is not null and ${t.membershipId} is not null and ${t.attendanceId} is not null)`,
    ),
    check('access_attempts_duplicate_is_granted', sql`not ${t.isDuplicate} or ${t.result} = 'GRANTED'`),
    check(
      'access_attempts_manual_is_verified',
      sql`(${t.source} = 'MANUAL') = (${t.verifiedByUserId} is not null)`,
    ),
    check('access_attempts_manual_has_no_device', sql`${t.source} <> 'MANUAL' or ${t.deviceId} is null`),
    check(
      'access_attempts_outbox_is_denied',
      sql`not ${t.uploadedFromOutbox} or (${t.result} = 'DENIED' and ${t.reason} = 'AUTHORIZATION_UNAVAILABLE')`,
    ),
  ],
);

/** One row per granted entry. Never deleted: corrections void it instead. */
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: primaryId(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** The membership that authorized the entry. */
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'restrict' }),
    checkInAt: timestamptz('check_in_at').notNull(),
    /** Never read by the access decision (PLAN §6.3). */
    checkOutAt: timestamptz('check_out_at'),
    source: accessSourceEnum('source').notNull(),
    accessAttemptId: uuid('access_attempt_id')
      .notNull()
      .references(() => accessAttempts.id, { onDelete: 'restrict' }),
    status: attendanceStatusEnum('status').notNull().default('VALID'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('attendance_records_access_attempt_key').on(t.accessAttemptId),
    index('attendance_records_member_check_in_idx').on(t.memberId, t.checkInAt.desc()),
    index('attendance_records_check_in_idx').on(t.checkInAt),
    check(
      'attendance_records_check_out_after_check_in',
      sql`${t.checkOutAt} is null or ${t.checkOutAt} > ${t.checkInAt}`,
    ),
    check('attendance_records_manual_has_creator', sql`${t.source} <> 'MANUAL' or ${t.createdBy} is not null`),
  ],
);

/** Append-only history of attendance corrections (trigger in the migrations). */
export const attendanceCorrections = pgTable(
  'attendance_corrections',
  {
    id: primaryId(),
    attendanceId: uuid('attendance_id')
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: 'restrict' }),
    field: correctionFieldEnum('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    reason: text('reason').notNull(),
    correctedBy: uuid('corrected_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('attendance_corrections_attendance_created_idx').on(t.attendanceId, t.createdAt),
    check('attendance_corrections_reason_present', sql`char_length(trim(${t.reason})) >= 3`),
  ],
);
