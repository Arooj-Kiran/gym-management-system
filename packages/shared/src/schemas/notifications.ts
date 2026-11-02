import { z } from 'zod';
import { type DeliveryStatus, type NotificationChannel, type NotificationType } from '../enums';
import { queryBooleanSchema } from './common';

export const notificationListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: queryBooleanSchema.optional(),
});
export type NotificationListQuery = z.input<typeof notificationListQuerySchema>;

/** What a notification is about, so the app can link to it. */
export const NOTIFICATION_ENTITY_TYPES = [
  'MEMBERSHIP',
  'INVOICE',
  'CLASS_SESSION',
  'APPOINTMENT',
  'EQUIPMENT',
  'MEMBER',
] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface UnreadCountDto {
  count: number;
}

export interface ChannelStatusDto {
  channel: NotificationChannel;
  provider: string;
  /** True only when every required variable is set. Values are never returned. */
  configured: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  /** Delivery outcomes over the last 7 days. */
  recent: Record<DeliveryStatus, number>;
}
