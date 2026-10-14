import { ROLES } from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { citext, primaryId, timestamps, timestamptz } from './columns';

export const userRoleEnum = pgEnum('user_role', ROLES);

export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: citext('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull(),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    phone: varchar('phone', { length: 16 }),
    isActive: boolean('is_active').notNull().default(true),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamptz('locked_until'),
    lastLoginAt: timestamptz('last_login_at'),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    index('users_role_active_idx').on(t.role, t.isActive),
    check('users_email_length', sql`char_length(${t.email}) between 3 and 254`),
    check('users_first_name_length', sql`char_length(${t.firstName}) between 1 and 80`),
    check('users_last_name_length', sql`char_length(${t.lastName}) between 1 and 80`),
    check('users_phone_e164', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('users_failed_login_count_non_negative', sql`${t.failedLoginCount} >= 0`),
  ],
);

/** Columns that are safe to load for general use. `password_hash` is deliberately excluded. */
export const userPublicColumns = {
  id: users.id,
  email: users.email,
  role: users.role,
  firstName: users.firstName,
  lastName: users.lastName,
  phone: users.phone,
  isActive: users.isActive,
  mustChangePassword: users.mustChangePassword,
  failedLoginCount: users.failedLoginCount,
  lockedUntil: users.lockedUntil,
  lastLoginAt: users.lastLoginAt,
  isDemo: users.isDemo,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};
