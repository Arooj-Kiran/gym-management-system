import type { BookingStatus, ClassSessionDto } from '@gms/shared';
import { BOOKING_STATUS_LABELS } from '@gms/shared';
import { Badge, type BadgeTone } from '../../components/ui/badge';

const BOOKING_TONES: Record<BookingStatus, BadgeTone> = {
  BOOKED: 'primary',
  WAITLISTED: 'warning',
  CANCELLED: 'neutral',
  ATTENDED: 'success',
  NO_SHOW: 'danger',
};

export function BookingStatusBadge({
  status,
  waitlistPosition,
}: {
  status: BookingStatus;
  waitlistPosition?: number | null;
}) {
  return (
    <Badge tone={BOOKING_TONES[status]} dot>
      {status === 'WAITLISTED' && waitlistPosition
        ? `Waitlist #${waitlistPosition}`
        : BOOKING_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Full, places left, cancelled or finished, in that order of importance. */
export function SessionAvailability({
  session,
}: {
  session: Pick<
    ClassSessionDto,
    'effectiveStatus' | 'spotsLeft' | 'waitlistCount' | 'bookedCount' | 'capacity'
  >;
}) {
  if (session.effectiveStatus === 'CANCELLED') return <Badge tone="danger">Cancelled</Badge>;
  if (session.effectiveStatus === 'COMPLETED') return <Badge tone="neutral">Finished</Badge>;
  if (session.spotsLeft === 0)
    return (
      <Badge tone="warning">
        Full{session.waitlistCount > 0 ? ` · ${session.waitlistCount} waiting` : ''}
      </Badge>
    );
  return (
    <Badge tone="success">
      {session.spotsLeft} {session.spotsLeft === 1 ? 'place' : 'places'} left
    </Badge>
  );
}
