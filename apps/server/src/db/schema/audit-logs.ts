import { index, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns';
import { userRoleEnum, users } from './users';

/** Append-only: a database trigger rejects UPDATE and DELETE (see migrations). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: userRoleEnum('actor_role'),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 40 }).notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    reason: text('reason'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_actor_created_idx').on(t.actorUserId, t.createdAt),
    index('audit_logs_action_created_idx').on(t.action, t.createdAt),
  ],
);
