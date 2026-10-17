import { permissionScope, ROLE_LABELS, type DashboardMembershipCounts } from '@gms/shared';
import {
  ArrowRight,
  CircleCheck,
  Circle,
  Contact,
  History,
  KeyRound,
  ScrollText,
  Settings,
  Tags,
  Ticket,
  UserPlus,
  UserRoundPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Card, CardHeader } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { useAuditLogs } from '../audit/audit-api';
import { auditActorName, auditLabel, auditTone } from '../audit/audit-format';
import { useMemberList } from '../members/members-api';
import { useSettings } from '../settings/settings-api';
import { useStaffList } from '../staff/staff-api';
import { useDashboardActivity, useDashboardSummary } from './dashboard-api';

function greeting(date = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Karachi',
    }).format(date),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

interface QuickAction {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <Card>
      <CardHeader title="Quick actions" />
      <ul className="divide-y divide-border">
        {actions.map((action) => (
          <li key={action.to}>
            <Link
              to={action.to}
              className="group flex items-center gap-3.5 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-text">
                <action.icon className="size-[18px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{action.label}</span>
                <span className="block text-13 text-fg-muted">{action.description}</span>
              </span>
              <ArrowRight
                className="size-4 shrink-0 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Stat({
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

function MemberOverview() {
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

function MembershipOverview() {
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

function MemberActivity() {
  const activity = useDashboardActivity();
  return (
    <Card>
      <CardHeader
        title="Recent member activity"
        description="Registrations, memberships and access decisions"
        action={
          <Link to="/members" className="text-13 font-medium text-primary-text hover:underline">
            All members
          </Link>
        }
      />
      {activity.isPending ? (
        <ListSkeleton rows={4} label="Loading member activity" />
      ) : activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
      ) : activity.data.length === 0 ? (
        <EmptyState
          icon={<Contact aria-hidden />}
          title="No member activity yet"
          description="Registrations, membership changes and changes to member records show up here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {activity.data.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
            >
              <Badge tone={auditTone(item.action)}>{auditLabel(item.action)}</Badge>
              <span className="min-w-0 flex-1 truncate text-13 text-fg-secondary">
                {item.member ? (
                  <Link
                    to={`/members/${item.member.id}`}
                    className="font-medium text-fg hover:underline"
                  >
                    {item.member.firstName} {item.member.lastName}
                  </Link>
                ) : (
                  'Unknown member'
                )}
                <span className="text-fg-muted"> · by {item.actorName ?? 'System'}</span>
              </span>
              <time dateTime={item.createdAt} className="text-13 text-fg-muted tabular-nums">
                {formatRelative(item.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StaffStats() {
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

function SetupChecklist() {
  const settings = useSettings();
  const staff = useStaffList({ status: 'active', pageSize: 1 });
  const loading = settings.isPending || staff.isPending;
  const steps = [
    { done: true, label: 'Replace the seeded Admin password', to: '/account' },
    {
      done: settings.data ? settings.data.gymName !== 'My Gym' : false,
      label: 'Set the gym name and reminder rules',
      to: '/settings',
    },
    {
      done: (staff.data?.total ?? 0) > 1,
      label: 'Create accounts for your team',
      to: '/staff?new=1',
    },
  ];
  const remaining = steps.filter((step) => !step.done).length;
  if (!loading && remaining === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Finish setting up"
        description={loading ? 'Checking…' : `${steps.length - remaining} of ${steps.length} done`}
      />
      {loading ? (
        <ListSkeleton rows={3} label="Loading setup steps" />
      ) : (
        <ol className="divide-y divide-border">
          {steps.map((step) => (
            <li key={step.label}>
              <Link
                to={step.to}
                className="flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5"
              >
                {step.done ? (
                  <CircleCheck className="size-[18px] shrink-0 text-success" aria-label="Done" />
                ) : (
                  <Circle className="size-[18px] shrink-0 text-border-strong" aria-label="To do" />
                )}
                <span
                  className={cn(
                    'flex-1',
                    step.done ? 'text-fg-muted line-through decoration-border-strong' : 'text-fg',
                  )}
                >
                  {step.label}
                </span>
                {!step.done && <ArrowRight className="size-4 text-fg-muted" aria-hidden />}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function RecentActivity() {
  const audit = useAuditLogs({ pageSize: 6 });
  return (
    <Card>
      <CardHeader
        title="Recent activity"
        description="Latest entries from the audit log"
        action={
          <Link to="/audit-log" className="text-13 font-medium text-primary-text hover:underline">
            View all
          </Link>
        }
      />
      {audit.isPending ? (
        <ListSkeleton rows={4} label="Loading recent activity" />
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
      ) : audit.data.data.length === 0 ? (
        <EmptyState icon={<History aria-hidden />} title="No activity yet" />
      ) : (
        <ul className="divide-y divide-border">
          {audit.data.data.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
            >
              <Badge tone={auditTone(event.action)}>{auditLabel(event.action)}</Badge>
              <span className="min-w-0 flex-1 truncate text-13 text-fg-secondary">
                {auditActorName(event)}
              </span>
              <time dateTime={event.createdAt} className="text-13 text-fg-muted tabular-nums">
                {formatRelative(event.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Role home: shows only what the signed-in role can actually use today. */
export function DashboardPage() {
  const session = useSession();
  const can = useCan();
  const role = session.user.role;

  // Mirrors the server: whole-gym member figures need unscoped member access.
  const seesMembers = permissionScope(role, 'members:read') === 'ALL';

  const actions: QuickAction[] = [];
  if (seesMembers && can('members:create')) {
    actions.push({
      to: '/members?new=1',
      label: 'Register a member',
      description: 'Personal details, emergency contact and photo',
      icon: UserRoundPlus,
    });
  }
  if (seesMembers) {
    actions.push({
      to: '/members',
      label: 'Members',
      description: 'Search, filter and open member records',
      icon: Contact,
    });
  }
  if (seesMembers && can('memberships:read')) {
    actions.push({
      to: '/memberships',
      label: 'Memberships',
      description: can('memberships:assign')
        ? 'Expiring soon, status filters; assign from a member’s page'
        : 'Expiring soon and status filters',
      icon: Ticket,
    });
  }
  if (can('plans:read')) {
    actions.push({
      to: '/plans',
      label: can('plans:manage') ? 'Membership plans' : 'View membership plans',
      description: 'Prices, durations, benefits and access hours',
      icon: Tags,
    });
  }
  if (can('staff:manage')) {
    actions.push({
      to: '/staff?new=1',
      label: 'Add a staff member',
      description: 'Create a login with a temporary password',
      icon: UserPlus,
    });
  }
  if (can('staff:read')) {
    actions.push({
      to: '/staff',
      label: 'Staff directory',
      description: 'Roles, status and last sign-in',
      icon: UsersRound,
    });
  }
  if (can('settings:read')) {
    actions.push({
      to: '/settings',
      label: can('settings:manage') ? 'Gym settings' : 'View gym settings',
      description: 'Reminders, invoices and retention rules',
      icon: Settings,
    });
  }
  if (can('audit:read')) {
    actions.push({
      to: '/audit-log',
      label: 'Audit log',
      description: 'Every sensitive change, who and when',
      icon: ScrollText,
    });
  }
  actions.push({
    to: '/account',
    label: 'My account',
    description: 'Your details and password',
    icon: KeyRound,
  });

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {session.gym.name}
            <span aria-hidden>·</span>
            {ROLE_LABELS[role]}
          </span>
        }
        title={`${greeting()}, ${session.user.firstName}`}
        description={
          seesMembers
            ? 'Here is the current state of your members and recent front-desk activity.'
            : 'Your workspace. Your assigned members, check-ins and classes are added to this screen as they are switched on for the gym.'
        }
      />

      <div className="flex flex-col gap-6">
        {seesMembers && <MemberOverview />}
        {seesMembers && can('memberships:read') && <MembershipOverview />}
        {can('staff:read') && <StaffStats />}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            {can('settings:manage') && <SetupChecklist />}
            <QuickActions actions={actions} />
          </div>
          {(seesMembers || can('audit:read')) && (
            <div className="flex flex-col gap-6">
              {seesMembers && <MemberActivity />}
              {can('audit:read') && <RecentActivity />}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
