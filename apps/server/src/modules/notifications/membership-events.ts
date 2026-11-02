import type { MembershipEventType, NotificationType } from '@gms/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { members, memberships } from '../../db/schema';
import { createNotification } from './notifications.service';
import { templates } from './templates';

/** Membership history events that the member is told about straight away (requirements §12). */
const NOTIFIED_EVENTS: Partial<Record<MembershipEventType, NotificationType>> = {
  EXPIRED: 'MEMBERSHIP_EXPIRED',
  CANCELLED: 'MEMBERSHIP_CANCELLED',
  SUSPENDED: 'MEMBERSHIP_SUSPENDED',
  RENEWED: 'RENEWAL_SUCCESS',
};

/**
 * Called by recordChange in the same transaction as the event, so the notification exists exactly
 * when the change does. Members without a portal account, or archived, get nothing.
 */
export async function notifyMembershipEvent(
  tx: DbExecutor,
  event: { id: string; membershipId: string; eventType: MembershipEventType },
) {
  const type = NOTIFIED_EVENTS[event.eventType];
  if (!type) return;
  const [row] = await tx
    .select({
      userId: members.userId,
      planName: memberships.planNameSnapshot,
      startDate: memberships.startDate,
      endDate: memberships.endDate,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(members, eq(members.id, memberships.memberId))
    .where(and(eq(memberships.id, event.membershipId), isNull(members.archivedAt)))
    .limit(1);
  if (!row?.userId) return;

  const content =
    type === 'MEMBERSHIP_EXPIRED'
      ? templates.membershipExpired(row.planName, row.endDate)
      : type === 'MEMBERSHIP_CANCELLED'
        ? templates.membershipCancelled(row.planName)
        : type === 'MEMBERSHIP_SUSPENDED'
          ? templates.membershipSuspended(row.planName)
          : templates.renewalSuccess(
              row.planName,
              row.startDate,
              row.endDate,
              row.status === 'ACTIVE',
            );
  await createNotification(tx, {
    recipientUserId: row.userId,
    type,
    ...content,
    entity: { type: 'MEMBERSHIP', id: event.membershipId },
    dedupeKey: `${type}:${event.id}`,
  });
}
