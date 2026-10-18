import {
  daysBetween,
  isCurrentStatus,
  MEMBERSHIP_EVENT_LABELS,
  membershipActions,
  type MemberDto,
  type MembershipAction,
  type MembershipDto,
  type MembershipEventDto,
} from '@gms/shared';
import {
  CalendarPlus,
  CirclePause,
  CirclePlay,
  CircleX,
  History,
  Play,
  RefreshCw,
  Ticket,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
  gymTodayIso,
} from '../../lib/format';
import { planDays, planHours } from '../plans/plan-format';
import {
  AssignMembershipDialog,
  ExtendMembershipDialog,
  ReactivateMembershipDialog,
  RenewMembershipDialog,
} from './membership-dialogs';
import {
  gymDateOf,
  MEMBERSHIP_EVENT_TONES,
  membershipPeriod,
  membershipTiming,
  pickCurrentMembership,
  pickNextMembership,
  plural,
} from './membership-format';
import { MembershipStatusBadge } from './membership-status-badge';
import {
  useActivateMembership,
  useCancelMembership,
  useMemberMembershipEvents,
  useMemberMemberships,
  useSuspendMembership,
} from './memberships-api';

const ACTION_META: Record<
  MembershipAction,
  { label: string; icon: ReactNode; variant: 'primary' | 'secondary' }
> = {
  activate: { label: 'Activate', icon: <Play aria-hidden />, variant: 'primary' },
  reactivate: { label: 'Reactivate', icon: <CirclePlay aria-hidden />, variant: 'primary' },
  renew: { label: 'Renew', icon: <RefreshCw aria-hidden />, variant: 'secondary' },
  extend: { label: 'Extend', icon: <CalendarPlus aria-hidden />, variant: 'secondary' },
  suspend: { label: 'Suspend', icon: <CirclePause aria-hidden />, variant: 'secondary' },
  cancel: { label: 'Cancel membership', icon: <CircleX aria-hidden />, variant: 'secondary' },
};

/** Which actions this user may take on this period today; the server re-checks every one. */
function useAllowedActions(rows: MembershipDto[], today: string) {
  const can = useCan();
  return (membership: MembershipDto): MembershipAction[] => {
    const isLatest = !rows.some(
      (row) =>
        row.id !== membership.id &&
        row.status !== 'CANCELLED' &&
        row.startDate > membership.startDate,
    );
    return membershipActions(membership.effectiveStatus).filter((action) => {
      if (action === 'activate') return can('memberships:activate') && membership.endDate >= today;
      if (action === 'renew') return can('memberships:renew') && isLatest;
      return can('memberships:change-status');
    });
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-13 text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-fg">{children}</dd>
    </div>
  );
}

/** How far through the period today is; only for a period that is running. */
function PeriodProgress({ membership, today }: { membership: MembershipDto; today: string }) {
  const total = daysBetween(membership.startDate, membership.endDate) + 1;
  const used = Math.min(total, Math.max(0, daysBetween(membership.startDate, today) + 1));
  const percent = Math.round((used / total) * 100);
  return (
    <div className="mt-4">
      <div
        role="progressbar"
        aria-label="Days used"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        aria-valuetext={`Day ${used} of ${total}`}
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-200',
            membership.effectiveStatus === 'SUSPENDED' ? 'bg-warning-text' : 'bg-primary',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-fg-muted tabular-nums">
        Day {used} of {total}
      </p>
    </div>
  );
}

function MembershipPanel({
  membership,
  today,
  actions,
  onAction,
  eyebrow,
}: {
  membership: MembershipDto;
  today: string;
  actions: MembershipAction[];
  onAction: (action: MembershipAction, membership: MembershipDto) => void;
  eyebrow?: string;
}) {
  const { gym } = useSession();
  const status = membership.effectiveStatus;
  const running = (status === 'ACTIVE' || status === 'SUSPENDED') && membership.startDate <= today;
  const timing = membershipTiming(membership, today);

  return (
    <section aria-label={eyebrow ?? 'Current membership'}>
      <div className="px-4 py-4 sm:px-5">
        {eyebrow && (
          <p className="mb-1 text-xs font-medium tracking-wide text-fg-muted uppercase">
            {eyebrow}
          </p>
        )}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-base font-semibold text-fg">{membership.planName}</p>
            <p className="mt-0.5 text-13 text-fg-secondary tabular-nums">
              {membershipPeriod(membership)}
              {timing && <span className="text-fg-muted"> · {timing}</span>}
            </p>
          </div>
          <MembershipStatusBadge status={status} />
        </div>
        {running && <PeriodProgress membership={membership} today={today} />}
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
          <Fact label="Price">{formatMoney(membership.priceMinor, gym.currencyCode)}</Fact>
          <Fact label="Access days">{planDays(membership.accessDays)}</Fact>
          <Fact label="Access hours">{planHours(membership)}</Fact>
        </dl>
        {status === 'SUSPENDED' && membership.suspendedAt && (
          <p className="mt-4 rounded-md bg-warning-subtle px-3 py-2 text-13 text-warning-text">
            Suspended since {formatDate(gymDateOf(membership.suspendedAt))}
            {membership.suspensionReason ? `: ${membership.suspensionReason}` : '.'} Not valid for
            entry until reactivated.
          </p>
        )}
        {status === 'CANCELLED' && (
          <p className="mt-4 rounded-md bg-surface-muted px-3 py-2 text-13 text-fg-secondary">
            Cancelled {formatDateTime(membership.cancelledAt)}
            {membership.cancellationReason ? `: ${membership.cancellationReason}` : '.'}
          </p>
        )}
        {status === 'PENDING' && membership.endDate >= today && (
          <p className="mt-4 rounded-md bg-primary-subtle px-3 py-2 text-13 text-primary-text">
            Assigned but not active yet. It does not allow entry until it is activated.
          </p>
        )}
        {status === 'PENDING' && membership.endDate < today && (
          <p className="mt-4 rounded-md bg-surface-muted px-3 py-2 text-13 text-fg-secondary">
            This period ended before it was activated. Cancel it and assign a new one.
          </p>
        )}
        {membership.totalSuspendedDays > 0 && (
          <p className="mt-3 text-13 text-fg-muted">
            {plural(membership.totalSuspendedDays, 'day')} spent suspended in total.
          </p>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3 sm:px-5">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={ACTION_META[action].variant}
              icon={ACTION_META[action].icon}
              className={action === 'cancel' ? 'text-danger-text! sm:ml-auto' : undefined}
              onClick={() => onAction(action, membership)}
            >
              {ACTION_META[action].label}
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function PeriodsList({ rows, currentId }: { rows: MembershipDto[]; currentId: string | null }) {
  const { gym } = useSession();
  return (
    <Card>
      <CardHeader
        title="All periods"
        description={`${plural(rows.length, 'membership')}, newest first`}
      />
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li
            key={row.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                <span className="truncate">{row.planName}</span>
                {row.id === currentId && <Badge tone="primary">Current</Badge>}
                {row.renewedFromId && (
                  <span className="text-xs font-normal text-fg-muted">Renewal</span>
                )}
              </span>
              <span className="block text-13 text-fg-muted tabular-nums">
                {membershipPeriod(row)} · {formatMoney(row.priceMinor, gym.currencyCode)}
              </span>
            </span>
            <MembershipStatusBadge status={row.effectiveStatus} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One line on what changed, from the event's recorded values. */
function eventSummary(event: MembershipEventDto): string | null {
  const after = event.newValues ?? {};
  const before = event.oldValues ?? {};
  const date = (value: unknown) => (typeof value === 'string' ? formatDate(value) : '—');
  switch (event.eventType) {
    case 'CREATED':
    case 'ACTIVATED':
    case 'CANCELLED':
      return `${date(after.startDate)} – ${date(after.endDate)}`;
    case 'RENEWED':
      return `${date(after.startDate)} – ${date(after.endDate)}${
        typeof before.previousPlanName === 'string' ? `, after ${before.previousPlanName}` : ''
      }`;
    case 'EXTENDED':
      return `+${plural(Number(after.days), 'day')}: end date ${date(before.endDate)} → ${date(after.endDate)}`;
    case 'SUSPENDED':
      return `Period ends ${date(after.endDate)}`;
    case 'REACTIVATED':
      return after.extendedBySuspendedDays
        ? `After ${plural(Number(after.suspendedDays), 'day')} suspended: end date ${date(before.endDate)} → ${date(after.endDate)}`
        : `After ${plural(Number(after.suspendedDays), 'day')} suspended; end date kept at ${date(after.endDate)}`;
    case 'EXPIRED':
      return `Last day was ${date(after.endDate)}`;
    default:
      return null;
  }
}

function HistoryTimeline({ memberId }: { memberId: string }) {
  const events = useMemberMembershipEvents(memberId);
  return (
    <Card>
      <CardHeader title="History" description="Every change to this member's memberships" />
      {events.isPending ? (
        <ListSkeleton rows={4} label="Loading membership history" />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : events.data.length === 0 ? (
        <EmptyState
          icon={<History aria-hidden />}
          title="No history yet"
          description="Assignments, renewals, suspensions and cancellations are recorded here."
        />
      ) : (
        <ol aria-label="Membership history" className="px-4 py-2 sm:px-5">
          {events.data.map((event, index) => {
            const summary = eventSummary(event);
            return (
              <li key={event.id} className="relative flex gap-3 pb-4 last:pb-2">
                {index < events.data.length - 1 && (
                  <span className="absolute top-5 bottom-0 left-[5px] w-px bg-border" aria-hidden />
                )}
                <span
                  className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-surface bg-border-strong ring-1 ring-border"
                  aria-hidden
                />
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone={MEMBERSHIP_EVENT_TONES[event.eventType]}>
                      {MEMBERSHIP_EVENT_LABELS[event.eventType]}
                    </Badge>
                    <span className="text-13 font-medium text-fg">{event.planName}</span>
                  </div>
                  {summary && (
                    <p className="mt-1 text-13 text-fg-secondary tabular-nums">{summary}</p>
                  )}
                  {event.reason && (
                    <p className="mt-1 text-13 break-words text-fg-secondary">
                      <span className="text-fg-muted">Reason: </span>
                      {event.reason}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-fg-muted">
                    {event.actorName ?? 'System (nightly expiry check)'} ·{' '}
                    <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
                      {formatRelative(event.createdAt)}
                    </time>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

type OpenDialog = { action: MembershipAction | 'assign'; membership: MembershipDto | null };

/** The member page's Membership tab: what they are on, what is next, every period and change. */
export function MemberMembershipTab({ member }: { member: MemberDto }) {
  const can = useCan();
  const today = gymTodayIso();
  const memberships = useMemberMemberships(member.id);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const activate = useActivateMembership();
  const suspend = useSuspendMembership();
  const cancel = useCancelMembership();
  const archived = Boolean(member.archivedAt);
  const name = fullName(member);
  const rows = memberships.data ?? [];
  const allowedActions = useAllowedActions(rows, today);
  const canAssign = can('memberships:assign') && !archived;
  const latestCurrentEndDate =
    rows
      .filter((row) => isCurrentStatus(row.status))
      .map((row) => row.endDate)
      .sort()
      .at(-1) ?? null;

  const open = (action: MembershipAction | 'assign', membership: MembershipDto | null = null) =>
    setDialog({ action, membership });
  const close = () => setDialog(null);
  const target = dialog?.membership ?? null;
  const dialogProps = (action: MembershipAction) => ({
    open: dialog?.action === action,
    onOpenChange: (next: boolean) => !next && close(),
  });

  const done = (message: string) => ({
    onSuccess: () => {
      toast.success(message);
      close();
    },
    onError: (error: unknown) => toast.error(errorMessage(error)),
  });

  const assignButton = canAssign && (
    <Button size="sm" icon={<Ticket aria-hidden />} onClick={() => open('assign')}>
      Assign membership
    </Button>
  );

  let body: ReactNode;
  if (memberships.isPending) {
    body = (
      <Card>
        <div role="status" aria-label="Loading memberships" className="space-y-3 px-5 py-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-16" />
        </div>
      </Card>
    );
  } else if (memberships.isError) {
    body = (
      <Card>
        <ErrorState error={memberships.error} onRetry={() => memberships.refetch()} />
      </Card>
    );
  } else if (rows.length === 0) {
    body = (
      <Card>
        <EmptyState
          icon={<Ticket aria-hidden />}
          title="No membership yet"
          description={
            archived
              ? 'This member never had a membership.'
              : canAssign
                ? `Assign a plan to give ${member.firstName} a membership period.`
                : `${member.firstName} has not been given a membership period yet.`
          }
          action={assignButton}
        />
      </Card>
    );
  } else {
    const current = pickCurrentMembership(rows, today)!;
    const next = pickNextMembership(rows, current);
    const actionsFor = (membership: MembershipDto) => (archived ? [] : allowedActions(membership));
    body = (
      <>
        <Card>
          <CardHeader title="Current membership" action={assignButton} />
          <MembershipPanel
            membership={current}
            today={today}
            actions={actionsFor(current)}
            onAction={open}
          />
          {next && (
            <div className="border-t border-border">
              <MembershipPanel
                eyebrow="Up next"
                membership={next}
                today={today}
                actions={actionsFor(next)}
                onAction={open}
              />
            </div>
          )}
        </Card>
        {rows.length > 1 && <PeriodsList rows={rows} currentId={current.id} />}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {body}
      <HistoryTimeline memberId={member.id} />

      {canAssign && (
        <AssignMembershipDialog
          member={member}
          latestCurrentEndDate={latestCurrentEndDate}
          open={dialog?.action === 'assign'}
          onOpenChange={(next) => !next && close()}
        />
      )}
      {target && (
        <>
          <RenewMembershipDialog
            {...dialogProps('renew')}
            membership={target}
            memberName={name}
            latestCurrentEndDate={latestCurrentEndDate}
          />
          <ExtendMembershipDialog
            {...dialogProps('extend')}
            membership={target}
            memberName={name}
          />
          <ReactivateMembershipDialog
            {...dialogProps('reactivate')}
            membership={target}
            memberName={name}
          />
          <ConfirmDialog
            {...dialogProps('activate')}
            title={`Activate ${name}'s membership?`}
            description={`${target.planName} becomes active for ${membershipPeriod(target)}. The dates do not change.`}
            confirmLabel="Activate"
            reason="optional"
            loading={activate.isPending}
            onConfirm={(reason) =>
              activate.mutate(
                { id: target.id, reason, version: target.version },
                done(`Membership activated for ${name}`),
              )
            }
          />
          <ConfirmDialog
            {...dialogProps('suspend')}
            title={`Suspend ${name}'s membership?`}
            description="They cannot enter while it is suspended. When you reactivate it you can add the suspended days to the end date."
            confirmLabel="Suspend membership"
            tone="danger"
            reason="required"
            loading={suspend.isPending}
            onConfirm={(reason) =>
              suspend.mutate(
                { id: target.id, reason: reason ?? '', version: target.version },
                done(`Membership suspended for ${name}`),
              )
            }
          />
          <ConfirmDialog
            {...dialogProps('cancel')}
            title={`Cancel ${name}'s membership?`}
            description={`${target.planName} (${membershipPeriod(target)}) stops at once and cannot be restarted. Entry is refused from now on; its history is kept.`}
            confirmLabel="Cancel membership"
            tone="danger"
            reason="required"
            loading={cancel.isPending}
            onConfirm={(reason) =>
              cancel.mutate(
                { id: target.id, reason: reason ?? '', version: target.version },
                done(`Membership cancelled for ${name}`),
              )
            }
          />
        </>
      )}
    </div>
  );
}
