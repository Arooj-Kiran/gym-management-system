import type { DeliveryStatus } from '@gms/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { notificationDeliveries } from '../db/schema';
import {
  defaultChannels,
  type ChannelAdapter,
  type SendResult,
} from '../modules/notifications/channels';
import { loadSettingsRow } from '../modules/settings/settings.service';

/** Fixed key: only one instance may dispatch at a time, so no message is sent twice. */
const DISPATCH_LOCK = sql`hashtext('job:notification-dispatch')`;

/** Notifications older than this are never sent out late; they stay in-app only. */
const MAX_AGE_HOURS = 48;
const DEFAULT_BATCH_SIZE = 20;

let configuredChannels: ChannelAdapter[] | undefined;
/** Built once, so the SMTP connection is reused between runs. */
const sharedChannels = () => (configuredChannels ??= defaultChannels());

export interface DispatchOptions {
  /** Tests pass fake adapters; the default is the three channels configured by the environment. */
  channels?: readonly ChannelAdapter[];
  batchSize?: number;
}

export interface DispatchRunResult {
  ran: boolean;
  notifications: number;
  deliveries: Record<DeliveryStatus, number>;
}

/**
 * Sends each new in-app notification out over the email, SMS and WhatsApp channels and records
 * the outcome of that single attempt per channel (PLAN §3.11):
 * - channel without credentials → NOT_CONFIGURED (nothing leaves the server);
 * - no address for the recipient → FAILED with NO_EMAIL_ADDRESS / NO_PHONE_NUMBER;
 * - a demo account (seeded sample data) → FAILED with DEMO_RECIPIENT, never sent;
 * - otherwise the provider's answer → SENT with its message id, or FAILED with an error code.
 * A notification is picked up once: after this run it has a delivery row for every channel.
 */
export async function dispatchNotifications(
  options: DispatchOptions = {},
): Promise<DispatchRunResult> {
  const channels = options.channels ?? sharedChannels();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  return db.transaction(async (tx) => {
    const deliveries: Record<DeliveryStatus, number> = { NOT_CONFIGURED: 0, SENT: 0, FAILED: 0 };
    const [lock] = await tx
      .execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${DISPATCH_LOCK}) as locked`,
      )
      .then((result) => result.rows);
    if (!lock?.locked) return { ran: false, notifications: 0, deliveries };

    const pending = await tx
      .execute<{
        id: string;
        title: string;
        body: string;
        email: string;
        phone: string | null;
        is_demo: boolean;
      }>(
        sql`select n.id, n.title, n.body, u.email::text as email,
            coalesce(mb.phone_e164, u.phone) as phone, u.is_demo
          from notifications n
          join users u on u.id = n.recipient_user_id
          left join members mb on mb.user_id = u.id and mb.archived_at is null
          where n.created_at > now() - make_interval(hours => ${MAX_AGE_HOURS})
            and not exists (select 1 from notification_deliveries d where d.notification_id = n.id)
          order by n.created_at, n.id
          limit ${batchSize}`,
      )
      .then((result) => result.rows);
    if (pending.length === 0) return { ran: true, notifications: 0, deliveries };

    const { gymName } = await loadSettingsRow(tx);
    for (const notification of pending) {
      for (const adapter of channels) {
        let result: SendResult | null = null; // null: the channel is not configured
        if (adapter.missingEnv().length > 0) {
          // Nothing leaves the server.
        } else if (notification.is_demo) {
          // Demo people have made-up but real-looking numbers: never message them.
          result = { ok: false, errorCode: 'DEMO_RECIPIENT' };
        } else {
          result = await adapter.send({
            gymName,
            title: notification.title,
            body: notification.body,
            to: { email: notification.email, phoneE164: notification.phone },
          });
        }
        const status: DeliveryStatus = !result ? 'NOT_CONFIGURED' : result.ok ? 'SENT' : 'FAILED';
        await tx
          .insert(notificationDeliveries)
          .values({
            notificationId: notification.id,
            channel: adapter.channel,
            status,
            providerMessageId: result?.ok ? result.providerMessageId : null,
            errorCode: result && !result.ok ? result.errorCode.slice(0, 60) : null,
          })
          .onConflictDoNothing();
        deliveries[status] += 1;
      }
    }
    return { ran: true, notifications: pending.length, deliveries };
  });
}
