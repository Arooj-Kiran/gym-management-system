import type { DashboardAttendance, DashboardTrainer } from '@gms/shared';
import {
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  Circle,
  CircleCheck,
  Contact,
  History,
} from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Card, CardHeader } from '../../components/ui/card';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { cn } from '../../lib/cn';
import { formatRelative, formatTime } from '../../lib/format';
import { SourceBadge } from '../access/access-badges';
import { useAuditLogs } from '../audit/audit-api';
import { auditActorName, auditLabel, auditTone } from '../audit/audit-format';
import { CompactScheduleList } from '../scheduling/schedule-list';
import { useSettings } from '../settings/settings-api';
import { useStaffList } from '../staff/staff-api';
import type { QuickAction } from './dashboard-actions';
import { useDashboardActivity } from './dashboard-api';

/** Lists and feeds on the dashboard: shortcuts, recent arrivals, activity and schedules. */

const QUICK_ACTION_ROW =
  'group flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5';

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    <Card>
      <CardHeader title="Quick actions" />
      <ul className="divide-y divide-border">
        {actions.map((action) => {
          const body = (
            <>
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
            </>
          );
          return (
            <li key={action.label}>
              {action.to ? (
                <Link to={action.to} className={QUICK_ACTION_ROW}>
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={action.onClick} className={QUICK_ACTION_ROW}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function RecentCheckIns({ attendance }: { attendance: DashboardAttendance }) {
  return (
    <Card>
      <CardHeader
        title="Recent check-ins"
        description="Latest granted entries today"
        action={
          <Link to="/attendance" className="text-13 font-medium text-primary-text hover:underline">
            All of today
          </Link>
        }
      />
      {attendance.recentCheckIns.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck aria-hidden />}
          title="No check-ins yet today"
          description="Scans and manual check-ins appear here as members arrive."
        />
      ) : (
        <ul className="divide-y divide-border">
          {attendance.recentCheckIns.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
            >
              <time
                dateTime={item.checkInAt}
                className="w-12 shrink-0 text-13 font-medium text-fg tabular-nums"
              >
                {formatTime(item.checkInAt)}
              </time>
              <span className="min-w-0 flex-1 truncate text-13">
                <Link
                  to={`/members/${item.member.id}?tab=attendance`}
                  className="font-medium text-fg hover:underline"
                >
                  {item.member.firstName} {item.member.lastName}
                </Link>
                <span className="font-mono text-xs text-fg-muted"> {item.member.memberCode}</span>
              </span>
              <SourceBadge source={item.source} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function MemberActivity() {
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

export function SetupChecklist() {
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

const UPCOMING_LIMIT = 8;

export function TrainerSchedule({
  trainer,
  trainerId,
}: {
  trainer: DashboardTrainer;
  trainerId: string;
}) {
  const upcoming = trainer.upcoming.slice(0, UPCOMING_LIMIT);
  return (
    <>
      <Card>
        <CardHeader
          title="Today"
          action={
            <Link
              to={`/trainers/${trainerId}`}
              className="text-13 font-medium text-primary-text hover:underline"
            >
              Full schedule
            </Link>
          }
        />
        {trainer.today.length === 0 ? (
          <EmptyState
            icon={<CalendarDays aria-hidden />}
            title="A clear day"
            description="No classes, appointments or shifts today."
          />
        ) : (
          <CompactScheduleList items={trainer.today} label="Today" />
        )}
      </Card>
      <Card>
        <CardHeader
          title="Coming up"
          description={
            trainer.upcoming.length > UPCOMING_LIMIT
              ? `The next ${UPCOMING_LIMIT} of ${trainer.upcoming.length} this week`
              : 'The next 7 days'
          }
        />
        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarDays aria-hidden />}
            title="Nothing scheduled this week"
            description="Classes and appointments appear here once they are booked."
          />
        ) : (
          <CompactScheduleList items={upcoming} label="Coming up" showDate />
        )}
      </Card>
    </>
  );
}

export function RecentActivity() {
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
