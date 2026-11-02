import type { NotificationDto, NotificationType } from '@gms/shared';
import {
  CalendarClock,
  CreditCard,
  Dumbbell,
  Fingerprint,
  RefreshCw,
  Ticket,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export const NOTIFICATION_ICONS: Record<NotificationType, LucideIcon> = {
  MEMBERSHIP_EXPIRING: Ticket,
  MEMBERSHIP_EXPIRED: Ticket,
  MEMBERSHIP_CANCELLED: Ticket,
  MEMBERSHIP_SUSPENDED: Ticket,
  PAYMENT_DUE: CreditCard,
  PAYMENT_OVERDUE: CreditCard,
  RENEWAL_SUCCESS: RefreshCw,
  CLASS_REMINDER: Dumbbell,
  APPOINTMENT_REMINDER: CalendarClock,
  EQUIPMENT_MAINTENANCE_DUE: Wrench,
  BIOMETRIC_RETENTION_DUE: Fingerprint,
};

/** Types that need someone to act, shown with a warning accent. */
export const URGENT_TYPES: readonly NotificationType[] = [
  'MEMBERSHIP_EXPIRED',
  'MEMBERSHIP_CANCELLED',
  'MEMBERSHIP_SUSPENDED',
  'PAYMENT_OVERDUE',
  'EQUIPMENT_MAINTENANCE_DUE',
  'BIOMETRIC_RETENTION_DUE',
];

/**
 * Where a notification leads. Members go to their portal pages; staff go to the screen that
 * manages the thing. Returns null when there is nothing to open.
 */
export function notificationLink(
  notification: Pick<NotificationDto, 'entityType' | 'entityId'>,
  isMember: boolean,
): string | null {
  const { entityType, entityId } = notification;
  if (!entityType) return null;
  if (isMember) {
    switch (entityType) {
      case 'MEMBERSHIP':
        return '/portal/membership';
      case 'INVOICE':
        return '/portal/payments';
      case 'CLASS_SESSION':
      case 'APPOINTMENT':
        return '/portal/schedule';
      default:
        return null;
    }
  }
  switch (entityType) {
    case 'MEMBERSHIP':
      return '/memberships';
    case 'INVOICE':
      return '/invoices';
    case 'CLASS_SESSION':
      return entityId ? `/classes/sessions/${entityId}` : '/classes';
    case 'APPOINTMENT':
      return '/appointments';
    case 'EQUIPMENT':
      return entityId ? `/equipment/${entityId}` : '/equipment';
    case 'MEMBER':
      return entityId ? `/members/${entityId}` : '/members';
    default:
      return null;
  }
}

/** "3", "99+" */
export const countLabel = (count: number) => (count > 99 ? '99+' : String(count));
