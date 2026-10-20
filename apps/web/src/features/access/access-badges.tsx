import {
  ACCESS_REASON_LABELS,
  ACCESS_SOURCE_LABELS,
  type AccessReason,
  type AccessSource,
} from '@gms/shared';
import { CircleCheck, CircleX, FlaskConical, Fingerprint, UserCheck } from 'lucide-react';
import { Badge } from '../../components/ui/badge';

export function DecisionBadge({ reason }: { reason: AccessReason }) {
  if (reason === 'GRANTED') {
    return (
      <Badge tone="success">
        <CircleCheck className="size-3" aria-hidden /> Granted
      </Badge>
    );
  }
  return (
    <Badge tone={reason === 'MEMBER_NOT_RECOGNIZED' ? 'warning' : 'danger'}>
      <CircleX className="size-3" aria-hidden /> {ACCESS_REASON_LABELS[reason]}
    </Badge>
  );
}

const SOURCE_ICONS = { SIMULATED: FlaskConical, REAL: Fingerprint, MANUAL: UserCheck };

/** Simulated scans are always marked, so they are never mistaken for real verification. */
export function SourceBadge({ source }: { source: AccessSource }) {
  const Icon = SOURCE_ICONS[source];
  if (source === 'SIMULATED') {
    return (
      <Badge tone="warning">
        <Icon className="size-3" aria-hidden /> SIMULATED
      </Badge>
    );
  }
  return (
    <Badge tone={source === 'REAL' ? 'primary' : 'neutral'}>
      <Icon className="size-3" aria-hidden /> {ACCESS_SOURCE_LABELS[source]}
    </Badge>
  );
}
