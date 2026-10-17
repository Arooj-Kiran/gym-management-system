import type { MemberSummaryDto } from '@gms/shared';
import { Archive, Ban } from 'lucide-react';
import { Badge } from '../../components/ui/badge';

/** Archived wins over everything; otherwise the account status plus an entry-block flag. */
export function MemberStatusBadges({ member }: { member: MemberSummaryDto }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {member.archivedAt ? (
        <Badge>
          <Archive className="size-3" aria-hidden /> Archived
        </Badge>
      ) : member.accountStatus === 'ACTIVE' ? (
        <Badge tone="success" dot>
          Active
        </Badge>
      ) : (
        <Badge tone="warning" dot>
          Inactive
        </Badge>
      )}
      {member.accessBlocked && !member.archivedAt && (
        <Badge tone="danger">
          <Ban className="size-3" aria-hidden /> Entry blocked
        </Badge>
      )}
      {member.isDemo && <Badge tone="primary">Demo</Badge>}
    </span>
  );
}
