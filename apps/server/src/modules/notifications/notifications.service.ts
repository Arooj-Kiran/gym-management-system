import {
  DELIVERY_STATUSES,
  NOTIFICATION_CHANNELS,
  type ChannelStatusDto,
  type DeliveryStatus,
  type NotificationChannel,
  type NotificationDto,
  type NotificationEntityType,
  type NotificationType,
  type Paginated,
  type UnreadCountDto,
  type notificationListQuerySchema,
} from '@gms/shared';
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { notificationDeliveries, notifications } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { pageOffset, paginated } from '../../lib/pagination';
import { defaultChannels, type ChannelAdapter } from './channels';

type NotificationListQuery = z.output<typeof notificationListQuerySchema>;
type NotificationRow = typeof notifications.$inferSelect;

export interface NewNotification {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  entity?: { type: NotificationEntityType; id: string } | null;
  /**
   * What makes this reminder unique, without the recipient (it is appended here). The same key
   * for the same person never creates a second notification, however often a job runs.
   */
  dedupeKey: string;
}

/**
 * Creates one in-app notification inside the caller's transaction. Returns false when it already
 * existed (same dedupe key) or the recipient's account is deactivated.
 */
export async function createNotification(
  tx: DbExecutor,
  notification: NewNotification,
): Promise<boolean> {
  const dedupeKey = `${notification.dedupeKey}:${notification.recipientUserId}`;
  const result = await tx.execute<{ id: string }>(sql`
    insert into notifications
      (recipient_user_id, type, title, body, entity_type, entity_id, dedupe_key)
    select u.id, ${notification.type}::notification_type, ${notification.title.slice(0, 120)},
      ${notification.body.slice(0, 500)}, ${notification.entity?.type ?? null},
      ${notification.entity?.id ?? null}::uuid, ${dedupeKey}
    from users u
    where u.id = ${notification.recipientUserId} and u.is_active
    on conflict (dedupe_key) do nothing
    returning id`);
  return result.rows.length > 0;
}

/** Every active Admin and Manager — the people who look after the building and its equipment. */
export async function managementUserIds(tx: DbExecutor): Promise<string[]> {
  const result = await tx.execute<{ id: string }>(
    sql`select id from users where role in ('ADMIN', 'MANAGER') and is_active order by id`,
  );
  return result.rows.map((row) => row.id);
}

function toDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- The signed-in user's own notifications ---------------------------------------------------

export async function listNotifications(
  userId: string,
  query: NotificationListQuery,
): Promise<Paginated<NotificationDto>> {
  const where = and(
    eq(notifications.recipientUserId, userId),
    query.unreadOnly ? isNull(notifications.readAt) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ count: count() }).from(notifications).where(where),
  ]);
  return paginated(rows.map(toDto), query.page, query.pageSize, total?.count ?? 0);
}

export async function unreadCount(userId: string): Promise<UnreadCountDto> {
  const [row] = await db
    .select({ count: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)));
  return { count: row?.count ?? 0 };
}

/** Another user's notification reads as 404, never 403, so ids cannot be probed. */
export async function markRead(userId: string, id: string): Promise<NotificationDto> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
    .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, userId)))
    .returning();
  if (!row) throw notFound('Notification');
  return toDto(row);
}

export async function markAllRead(userId: string): Promise<{ updated: number }> {
  const rows = await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.recipientUserId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { updated: rows.length };
}

// --- Channels status (settings:read) ---------------------------------------------------------

const emptyCounts = () =>
  Object.fromEntries(DELIVERY_STATUSES.map((status) => [status, 0])) as Record<
    DeliveryStatus,
    number
  >;

/** Which external channels are configured (variable names only, never values) and how they did. */
export async function channelStatuses(
  channels: readonly ChannelAdapter[] = defaultChannels(),
): Promise<ChannelStatusDto[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      channel: notificationDeliveries.channel,
      status: notificationDeliveries.status,
      count: count(),
    })
    .from(notificationDeliveries)
    .where(gte(notificationDeliveries.attemptedAt, since))
    .groupBy(notificationDeliveries.channel, notificationDeliveries.status);
  const recent = new Map<NotificationChannel, Record<DeliveryStatus, number>>(
    NOTIFICATION_CHANNELS.map((channel) => [channel, emptyCounts()]),
  );
  for (const row of rows) recent.get(row.channel)![row.status] = row.count;
  return channels.map((adapter) => {
    const missingEnv = adapter.missingEnv();
    return {
      channel: adapter.channel,
      provider: adapter.provider,
      configured: missingEnv.length === 0,
      requiredEnv: [...adapter.requiredEnv],
      missingEnv,
      recent: recent.get(adapter.channel) ?? emptyCounts(),
    };
  });
}
