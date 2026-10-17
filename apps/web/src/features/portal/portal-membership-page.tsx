import { daysBetween, type MyMembershipDto, type MyMembershipOverview } from '@gms/shared';
import { CalendarClock, CalendarDays, Clock, History, Ticket } from 'lucide-react';
import type { ReactNode } from 'react';
import { ButtonLink } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDate, formatMoney, gymTodayIso } from '../../lib/format';
import { membershipPeriod, membershipTiming } from '../memberships/membership-format';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { planDays, planHours } from '../plans/plan-format';
import { useMyMembership, useMyMemberships } from './portal-api';

const STATUS_MESSAGES: Partial<Record<MyMembershipDto['effectiveStatus'], string>> = {
  PENDING: 'Your membership is booked but not active yet. The front desk activates it.',
  SUSPENDED: 'Your membership is paused, so entry is not allowed. Ask the front desk to resume it.',
  EXPIRED: 'Your membership has ended. Visit the front desk to renew.',
  CANCELLED: 'Your membership was cancelled. Ask the front desk if you think this is a mistake.',
};

function AccessFacts({ membership }: { membership: MyMembershipDto }) {
  return (
    <dl className="flex flex-col gap-2 text-13 text-fg-secondary">
      <div className="flex items-center gap-2">
        <dt>
          <CalendarDays className="size-4 text-fg-muted" aria-hidden />
          <span className="sr-only">Days</span>
        </dt>
        <dd>{planDays(membership.accessDays)}</dd>
      </div>
      <div className="flex items-center gap-2">
        <dt>
          <Clock className="size-4 text-fg-muted" aria-hidden />
          <span className="sr-only">Hours</span>
        </dt>
        <dd>{planHours(membership)}</dd>
      </div>
    </dl>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: 'warning' | 'neutral' | 'primary';
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        'rounded-md px-3 py-2 text-13',
        tone === 'warning' && 'bg-warning-subtle text-warning-text',
        tone === 'neutral' && 'bg-surface-muted text-fg-secondary',
        tone === 'primary' && 'bg-primary-subtle text-primary-text',
      )}
    >
      {children}
    </p>
  );
}

function CurrentMembership({ overview }: { overview: MyMembershipOverview }) {
  const { gym } = useSession();
  const today = gymTodayIso();
  const current = overview.current!;
  const status = current.effectiveStatus;
  const total = daysBetween(current.startDate, current.endDate) + 1;
  const message = STATUS_MESSAGES[status];

  return (
    <Card>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
              Current membership
            </p>
            <MembershipStatusBadge status={status} />
          </div>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-fg">{current.planName}</h2>
          <p className="mt-1 text-sm text-fg-secondary tabular-nums">
            {membershipPeriod(current)} · {formatMoney(current.priceMinor, gym.currencyCode)}
          </p>
          <div className="mt-5">
            <AccessFacts membership={current} />
          </div>
          {(message || overview.expiringSoon) && (
            <div className="mt-5">
              {overview.expiringSoon ? (
                <Callout tone="warning">
                  Your membership ends on {formatDate(current.endDate)}. Visit the front desk to
                  renew so you can keep training without a break.
                </Callout>
              ) : (
                <Callout tone={status === 'PENDING' ? 'primary' : 'neutral'}>{message}</Callout>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col justify-center border-t border-border bg-surface-muted/50 px-5 py-5 sm:px-6 md:rounded-r-lg md:border-t-0 md:border-l">
          {overview.daysLeft !== null ? (
            <>
              <p className="text-[2.5rem] leading-none font-semibold tracking-tight text-fg tabular-nums">
                {overview.daysLeft}
              </p>
              <p className="mt-1.5 text-13 text-fg-secondary">
                {overview.daysLeft === 1
                  ? 'day left, including today'
                  : 'days left, including today'}
              </p>
              <div
                role="progressbar"
                aria-label="Days used"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={total - overview.daysLeft}
                className="mt-4 h-1.5 overflow-hidden rounded-full bg-border"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(((total - overview.daysLeft) / total) * 100)}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-fg-secondary">
              {membershipTiming(current, today) ?? 'Ended'}
            </p>
          )}
        </div>
      </div>
      {overview.next && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-5 py-3.5 text-13 sm:px-6">
          <CalendarClock className="size-4 text-fg-muted" aria-hidden />
          <span className="font-medium text-fg">Up next: {overview.next.planName}</span>
          <span className="text-fg-secondary tabular-nums">{membershipPeriod(overview.next)}</span>
          <MembershipStatusBadge status={overview.next.effectiveStatus} />
        </div>
      )}
    </Card>
  );
}

function MembershipHistory() {
  const { gym } = useSession();
  const history = useMyMemberships();
  return (
    <Card>
      <CardHeader title="Membership history" description="Every period, newest first" />
      {history.isPending ? (
        <ListSkeleton rows={3} label="Loading membership history" />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => history.refetch()} />
      ) : history.data.length === 0 ? (
        <EmptyState icon={<History aria-hidden />} title="No membership periods yet" />
      ) : (
        <ul aria-label="Membership history" className="divide-y divide-border">
          {history.data.map((row) => (
            <li
              key={row.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-3 sm:px-6"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">{row.planName}</span>
                <span className="block text-13 text-fg-muted tabular-nums">
                  {membershipPeriod(row)} · {formatMoney(row.priceMinor, gym.currencyCode)}
                </span>
              </span>
              <MembershipStatusBadge status={row.effectiveStatus} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The member's own membership: read-only; every change happens at the front desk. */
export function PortalMembershipPage() {
  const { gym } = useSession();
  const overview = useMyMembership();

  return (
    <>
      <PageHeader
        title="My membership"
        eyebrow={gym.name}
        description="Your plan, dates and access hours. To renew or change it, visit the front desk."
      />
      {overview.isPending ? (
        <div role="status" aria-label="Loading your membership" className="flex flex-col gap-6">
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
      ) : overview.isError ? (
        <Card>
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        </Card>
      ) : !overview.data.current ? (
        <Card>
          <EmptyState
            icon={<Ticket aria-hidden />}
            title="You don't have a membership yet"
            description="See the plans on offer, then ask the front desk to set one up for you."
            action={
              <ButtonLink to="/portal/plans" variant="secondary" size="sm">
                View plans
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <CurrentMembership overview={overview.data} />
          <MembershipHistory />
        </div>
      )}
    </>
  );
}
