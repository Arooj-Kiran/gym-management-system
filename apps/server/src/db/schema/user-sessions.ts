import { sql } from 'drizzle-orm';
import { char, index, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns';
import { users } from './users';

export const userSessions = pgTable(
  'user_sessions',
  {
    id: primaryId(),
    /** SHA-256 (hex) of the random session token. The raw token only lives in the httpOnly cookie. */
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    csrfToken: varchar('csrf_token', { length: 64 }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    revokedAt: timestamptz('revoked_at'),
  },
  (t) => [
    uniqueIndex('user_sessions_token_hash_key').on(t.tokenHash),
    index('user_sessions_active_user_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
    index('user_sessions_expires_at_idx').on(t.expiresAt),
  ],
);
