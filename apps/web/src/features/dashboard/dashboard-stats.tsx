import type {
  DashboardAttendance,
  DashboardBilling,
  DashboardMembershipCounts,
  DashboardTrainer,
} from '@gms/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader } from '../../components/ui/card';
import { ErrorState, Skeleton } from '../../components/ui/states';
import { useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/format';
import { useMemberList } from '../members/members-api';
import { useStaffList } from '../staff/staff-api';
import { useDashboardSummary } from './dashboard-api';

/** Figure cards on the dashboard: today's state of the gym, per role. */

export function Stat({
  label,
  value,
  loading,
  hint,
}: {
  label: string;
  value: ReactNode;
  loading: boolean;
  hint?: ReactNode;
}) {
  return (
    <Card className="px-4 py-4 sm:px-5">
      <p className="text-13 font-medium text-fg-secondary">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <p className="mt-1 text-[1.75rem] leading-9 font-semibold tracking-tight text-fg tabular-nums">
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-13 text-fg-muted">{hint}</p>}
    </Card>
  );
}

export function MoneyStat({
  label,
  amount,
  hint,
  danger,
}: {
  label: string;
  amount: string;
  hint: ReactNode;
  danger?: boolean;
}) {
  return (
    <Card className={cn('px-4 py-4 sm:px-5', danger && 'border-danger/40')}>
      <p className="text-13 font-medium text-fg-secondary">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-[1.75rem] leading-9 font-semibold tracking-tight tabular-nums',
          danger ? 'text-danger-text' : 'text-fg',
        )}
      >
        {amount}
      </p>
      <p className="mt-1 text-13 text-fg-muted">{hint}</p>
    </Card>
  );
}

function MemberStats({ total, registeredToday }: { total: number; registeredToday: number }) {
  const blocked = useMemberList({ accessBlocked: 'true', pageSize: 1 });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Stat
        label="Current members"
        value={total}
        loading={false}
        hint="Archived records are not counted."
      />
      <Stat
        label="Registered today"
        value={registeredToday}
        loading={false}
        hint={registeredToday === 0 ? 'No new members yet today.' : 'By registration date.'}
      />
      <Stat
        label="Entry blocked"
        value={blocked.isError ? '—' : (blocked.data?.total ?? 0)}
        loading={blocked.isPending}
        hint={
          blocked.data && blocked.data.total > 0 ? (
            <Link to="/members?access=blocked" className="text-primary-text hover:underline">
              Review blocked members
            </Link>
          ) : (
            'Members stopped at the front desk.'
          )
        }
      />
    </div>
  );
}

export function MemberOverview() {
  const summary = useDashboardSummary();
  if (summary.isError)
    return (
      <Card>
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      </Card>
    );
  if (summary.isPending)
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Current members" value={0} loading />
        <Stat label="Registered today" value={0} loading />
        <Stat label="Entry blocked" value={0} loading />
      </div>
    );
  if (!summary.data.members) return null;
  return <MemberStats {...summary.data.members} />;
}

const TODAY_DENIED = '/access-log?result=DENIED&from={today}&to={today}';

export function AttendanceStats({
  attendance,
  canReadLog,
  today,
}: {
  attendance: DashboardAttendance;
  canReadLog: boolean;
  today: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Stat
        label="Check-ins today"
        value={attendance.checkInsToday}
        loading={false}
        hint={
          <Link to="/attendance" className="text-primary-text hover:underline">
            Today&apos;s attendance
          </Link>
        }
      />
      <Stat
        label="Denied at the entrance today"
        value={attendance.deniedToday}
        loading={false}
        hint={
          canReadLog && attendance.deniedToday > 0 ? (
            <Link
              to={TODAY_DENIED.replaceAll('{today}', today)}
              className="text-primary-text hover:underline"
            >
              See why they were denied
            </Link>
          ) : (
            'Includes fingerprints that were not recognised.'
          )
        }
      />
    </div>
  );
}

interface MembershipCell {
  label: string;
  value: number;
  to: string;
  dot: string;
  hint?: string;
  highlight?: boolean;
}

/** Members counted once each, by the membership they are on today. */
function MembershipStats({ counts }: { counts: DashboardMembershipCounts }) {
  const days = counts.expiringWithinDays;
  const cells: MembershipCell[] = [
    { label: 'Active', value: counts.active, to: '/memberships?status=ACTIVE', dot: 'bg-success' },
    {
      label: 'Expiring soon',
      value: counts.expiringSoon,
      to: `/memberships?expiring=${days}`,
      dot: 'bg-warning-text',
      hint: `Next ${days} days, not renewed`,
      highlight: counts.expiringSoon > 0,
    },
    {
      label: 'Pending',
      value: counts.pending,
      to: '/memberships?status=PENDING',
      dot: 'bg-primary',
    },
    {
      label: 'Suspended',
      value: counts.suspended,
      to: '/memberships?status=SUSPENDED',
      dot: 'bg-warning-text',
    },
    {
      label: 'Expired',
      value: counts.expired,
      to: '/memberships?status=EXPIRED',
      dot: 'bg-danger',
    },
    {
      label: 'Cancelled',
      value: counts.cancelled,
      to: '/memberships?status=CANCELLED',
      dot: 'bg-border-strong',
    },
  ];
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Memberships"
        description="Each member counted once, by the membership they are on today"
        action={
          <Link to="/memberships" className="text-13 font-medium text-primary-text hover:underline">
            All memberships
          </Link>
        }
      />
      <ul className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-6">
        {cells.map((cell) => (
          <li key={cell.label} className="bg-surface">
            <Link
              to={cell.to}
              className={cn(
                'flex h-full flex-col px-4 py-4 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5',
                cell.highlight && 'bg-warning-subtle/60 hover:bg-warning-subtle',
              )}
            >
              <span className="flex items-center gap-2 text-13 font-medium text-fg-secondary">
                <span className={cn('size-2 rounded-full', cell.dot)} aria-hidden />
                {cell.label}
              </span>
              <span className="mt-1 text-[1.75rem] leading-9 font-semibold tracking-tight text-fg tabular-nums">
                {cell.value}
              </span>
              {cell.hint && <span className="text-xs text-fg-muted">{cell.hint}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function MembershipOverview() {
  const summary = useDashboardSummary();
  // The member overview above already shows the error and retry for this shared query.
  if (summary.isError) return null;
  if (summary.isPending)
    return (
      <Card>
        <CardHeader title="Memberships" />
        <div
          role="status"
          aria-label="Loading membership figures"
          className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-3 sm:px-5 xl:grid-cols-6"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      </Card>
    );
  if (!summary.data.memberships) return null;
  return <MembershipStats counts={summary.data.memberships} />;
}

const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Open and overdue invoices for everyone with whole-gym payment access; revenue for finance roles. */
export function BillingOverview({ billing, today }: { billing: DashboardBilling; today: string }) {
  const { gym } = useSession();
  const money = (minor: number) => formatMoney(minor, gym.currencyCode);
  const { outstanding, overdue, revenue } = billing;

  return (
    <div className={cn('grid grid-cols-1 gap-4', revenue ? 'md:grid-cols-3' : 'sm:grid-cols-2')}>
      {revenue && (
        <MoneyStat
          label={`Revenue in ${monthName(revenue.month)}`}
          amount={money(revenue.netMinor)}
          hint={
            <Link
              to={`/payments?from=${revenue.month}-01&to=${today}`}
              className="text-primary-text hover:underline"
            >
              {plural(revenue.paymentCount, 'payment')}
              {revenue.refundedMinor > 0 && `, ${money(revenue.refundedMinor)} refunded`}
            </Link>
          }
        />
      )}
      <MoneyStat
        label="Pending payments"
        amount={money(outstanding.amountMinor)}
        hint={
          outstanding.count > 0 ? (
            <Link
              to="/members?paymentStatus=OUTSTANDING"
              className="text-primary-text hover:underline"
            >
              {plural(outstanding.count, 'open invoice')}
            </Link>
          ) : (
            'Every invoice is settled.'
          )
        }
      />
      <MoneyStat
        label="Overdue"
        amount={money(overdue.amountMinor)}
        danger={overdue.count > 0}
        hint={
          overdue.count > 0 ? (
            <Link to="/invoices?status=OVERDUE" className="text-primary-text hover:underline">
              {plural(overdue.count, 'invoice')} past due
            </Link>
          ) : (
            'Nothing is past its due date.'
          )
        }
      />
    </div>
  );
}

export function StaffStats() {
  const active = useStaffList({ status: 'active', pageSize: 1 });
  const inactive = useStaffList({ status: 'inactive', pageSize: 1 });
  const trainers = useStaffList({ status: 'active', role: 'TRAINER', pageSize: 1 });
  if (active.isError)
    return (
      <Card>
        <ErrorState error={active.error} onRetry={() => active.refetch()} />
      </Card>
    );
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Stat
        label="Active staff accounts"
        value={active.data?.total ?? 0}
        loading={active.isPending}
      />
      <Stat
        label="Active trainers"
        value={trainers.data?.total ?? 0}
        loading={trainers.isPending}
      />
      <Stat
        label="Deactivated accounts"
        value={inactive.data?.total ?? 0}
        loading={inactive.isPending}
        hint="History is kept; they cannot sign in."
      />
    </div>
  );
}

/** A trainer's own day: counts on top, today's and the next week's sessions beside the actions. */
export function TrainerStats({ trainer }: { trainer: DashboardTrainer }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Stat
        label="On your schedule today"
        value={trainer.today.length}
        loading={false}
        hint={
          trainer.today.length === 0
            ? 'Nothing booked for today.'
            : 'Classes, appointments and shifts.'
        }
      />
      <Stat
        label="Next 7 days"
        value={trainer.upcoming.length}
        loading={false}
        hint="After today, cancelled items left out."
      />
      <Stat
        label="Assigned members"
        value={trainer.assignedMembers}
        loading={false}
        hint={
          <Link to="/my-members" className="text-primary-text hover:underline">
            View my members
          </Link>
        }
      />
    </div>
  );
}
