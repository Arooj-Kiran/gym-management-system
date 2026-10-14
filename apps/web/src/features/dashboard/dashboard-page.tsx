import { ROLE_LABELS } from '@gms/shared';
import {
  ArrowRight,
  CircleCheck,
  Circle,
  History,
  KeyRound,
  ScrollText,
  Settings,
  UserPlus,
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
import { useSettings } from '../settings/settings-api';
import { useStaffList } from '../staff/staff-api';

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

  const actions: QuickAction[] = [];
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
          can('staff:read')
            ? 'Here is the current state of your team and recent account activity.'
            : 'Your workspace. Member, check-in and class tools are added to this screen as they are switched on for the gym.'
        }
      />

      <div className="flex flex-col gap-6">
        {can('staff:read') && <StaffStats />}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            {can('settings:manage') && <SetupChecklist />}
            <QuickActions actions={actions} />
          </div>
          {can('audit:read') && <RecentActivity />}
        </div>
      </div>
    </>
  );
}
