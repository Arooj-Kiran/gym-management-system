import { UsersRound } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useSession } from '../../lib/auth';
import { formatDate, formatRelative } from '../../lib/format';
import { MemberAvatar } from '../members/member-avatar';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { useTrainerMembers } from './scheduling-api';

/**
 * A trainer's assigned members with only trainer-safe fields (§5): no contact details, notes or
 * billing. Personal training for these members is booked from Appointments.
 */
export function MyMembersPage() {
  const { user } = useSession();
  const members = useTrainerMembers(user.id);

  return (
    <>
      <PageHeader
        title="My members"
        description="Members assigned to you. Book personal training for them from Appointments."
      />
      <Card>
        {members.isPending ? (
          <ListSkeleton rows={4} label="Loading your members" />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : members.data.length === 0 ? (
          <EmptyState
            icon={<UsersRound aria-hidden />}
            title="No members assigned to you yet"
            description="An Admin or Manager assigns members to trainers. They appear here as soon as they are assigned."
          />
        ) : (
          <ul aria-label="My members" className="divide-y divide-border">
            {members.data.map((row) => {
              const membership = row.member.currentMembership;
              return (
                <li
                  key={row.assignmentId}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:gap-x-5 sm:px-5"
                >
                  <MemberAvatar member={row.member} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{fullName(row.member)}</p>
                    <p className="truncate text-13 text-fg-muted">
                      <span className="font-mono">{row.member.memberCode}</span> · yours since{' '}
                      {formatDate(row.startDate)}
                      {row.notes && ` · ${row.notes}`}
                    </p>
                  </div>
                  <p className="col-start-2 text-13 text-fg-secondary sm:col-start-auto">
                    {row.lastCheckInAt
                      ? `Last visit ${formatRelative(row.lastCheckInAt)}`
                      : 'No visits yet'}
                  </p>
                  <div className="col-start-2 sm:col-start-auto">
                    {membership ? (
                      <span
                        title={`${membership.planName}, until ${formatDate(membership.endDate)}`}
                      >
                        <MembershipStatusBadge status={membership.effectiveStatus} />
                      </span>
                    ) : (
                      <span className="text-13 text-fg-muted">No membership</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
