import {
  DELIVERY_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_TYPES,
} from '@gms/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { primaryId, timestamptz } from './columns';
import { users } from './users';

export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const deliveryStatusEnum = pgEnum('delivery_status', DELIVERY_STATUSES);

/**
 * In-app notifications (PLAN §3.11). dedupe_key is unique, so a job or event that runs twice never
 * creates a second copy of the same reminder.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    body: varchar('body', { length: 500 }).notNull(),
    entityType: varchar('entity_type', { length: 40, enum: NOTIFICATION_ENTITY_TYPES }),
    entityId: uuid('entity_id'),
    readAt: timestamptz('read_at'),
    dedupeKey: varchar('dedupe_key', { length: 200 }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_key').on(t.dedupeKey),
    index('notifications_recipient_idx').on(t.recipientUserId, t.readAt, t.createdAt.desc()),
    check('notifications_entity', sql`(${t.entityType} is null) = (${t.entityId} is null)`),
  ],
);

/**
 * One row per notification and external channel: the outcome of the single send attempt.
 * Append-only (trigger in the migrations).
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: primaryId(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'restrict' }),
    channel: notificationChannelEnum('channel').notNull(),
    status: deliveryStatusEnum('status').notNull(),
    providerMessageId: varchar('provider_message_id', { length: 200 }),
    errorCode: varchar('error_code', { length: 60 }),
    attemptedAt: timestamptz('attempted_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('notification_deliveries_channel_key').on(t.notificationId, t.channel),
    index('notification_deliveries_attempted_idx').on(t.attemptedAt),
    check(
      'notification_deliveries_outcome',
      sql`(${t.status} = 'SENT') = (${t.providerMessageId} is not null)
        and (${t.status} = 'FAILED') = (${t.errorCode} is not null)`,
    ),
  ],
);
