import { MEMBER_ACCOUNT_STATUSES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgSequence,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, primaryId, timestamps, timestamptz } from './columns';
import { users } from './users';

export const memberAccountStatusEnum = pgEnum('member_account_status', MEMBER_ACCOUNT_STATUSES);

export const memberCodeSeq = pgSequence('member_code_seq', { startWith: 1, increment: 1 });

const E164 = `'^\\+[1-9][0-9]{6,14}$'`;

export const members = pgTable(
  'members',
  {
    id: primaryId(),
    /** GM-000001 … Immutable: a trigger rejects changes (see migrations). */
    memberCode: varchar('member_code', { length: 16 })
      .notNull()
      .default(sql`'GM-' || lpad(nextval('member_code_seq')::text, 6, '0')`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    email: citext('email'),
    phoneE164: varchar('phone_e164', { length: 16 }).notNull(),
    profilePhotoKey: varchar('profile_photo_key', { length: 200 }),
    emergencyContactName: varchar('emergency_contact_name', { length: 80 }),
    emergencyContactPhone: varchar('emergency_contact_phone', { length: 16 }),
    emergencyContactRelation: varchar('emergency_contact_relation', { length: 40 }),
    registrationDate: date('registration_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    accountStatus: memberAccountStatusEnum('account_status').notNull().default('ACTIVE'),
    accessBlocked: boolean('access_blocked').notNull().default(false),
    accessBlockReason: varchar('access_block_reason', { length: 500 }),
    accessBlockedAt: timestamptz('access_blocked_at'),
    accessBlockedBy: uuid('access_blocked_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    archivedAt: timestamptz('archived_at'),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('members_member_code_key').on(t.memberCode),
    uniqueIndex('members_user_id_key').on(t.userId),
    /** C2: email is a hard block among current members; archived members free their email. */
    uniqueIndex('members_email_active_key')
      .on(sql`lower(${t.email})`)
      .where(sql`${t.archivedAt} is null and ${t.email} is not null`),
    /** C2: phone is deliberately NOT unique (families share numbers); this serves the lookup. */
    index('members_phone_active_idx')
      .on(t.phoneE164)
      .where(sql`${t.archivedAt} is null`),
    index('members_registration_date_idx').on(t.registrationDate),
    index('members_account_status_idx').on(t.accountStatus),
    index('members_name_trgm_idx').using(
      'gin',
      sql`(${t.firstName} || ' ' || ${t.lastName}) gin_trgm_ops`,
    ),
    index('members_email_trgm_idx').using('gin', sql`(${t.email}::text) gin_trgm_ops`),
    index('members_phone_trgm_idx').using('gin', t.phoneE164.op('gin_trgm_ops')),
    check('members_first_name_length', sql`char_length(${t.firstName}) between 1 and 80`),
    check('members_last_name_length', sql`char_length(${t.lastName}) between 1 and 80`),
    check(
      'members_email_length',
      sql`${t.email} is null or char_length(${t.email}) between 3 and 254`,
    ),
    check('members_phone_e164', sql`${t.phoneE164} ~ ${sql.raw(E164)}`),
    check(
      'members_emergency_phone_e164',
      sql`${t.emergencyContactPhone} is null or ${t.emergencyContactPhone} ~ ${sql.raw(E164)}`,
    ),
    check('members_notes_length', sql`${t.notes} is null or char_length(${t.notes}) <= 2000`),
    check(
      'members_access_block_consistent',
      sql`${t.accessBlocked} = (${t.accessBlockedAt} is not null)`,
    ),
    check('members_archive_consistent', sql`(${t.archivedAt} is null) = (${t.archivedBy} is null)`),
  ],
);
