import { MEMBERSHIP_STATUS_LABELS, type MembershipStatus } from '@gms/shared';
import { Badge } from '../../components/ui/badge';
import { MEMBERSHIP_TONES } from './membership-format';

/** Always the effective status: an ACTIVE membership past its last day reads as expired. */
export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  return (
    <Badge tone={MEMBERSHIP_TONES[status]} dot>
      {MEMBERSHIP_STATUS_LABELS[status]}
    </Badge>
  );
}
