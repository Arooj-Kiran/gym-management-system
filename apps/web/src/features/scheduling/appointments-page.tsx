import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUSES,
  permissionScope,
  type AppointmentDto,
  type AppointmentListQuery,
  type AppointmentStatus,
} from '@gms/shared';
import { CalendarCheck2, CalendarClock, Check, Pencil, UserX, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { gymTodayIso } from '../../lib/format';
import { useUrlFilters } from '../billing/use-url-filters';
import { MemberAvatar } from '../members/member-avatar';
import { AppointmentDialog } from './appointment-dialogs';
import { TrainerSelect } from './form-parts';
import { formatDayHeading, formatTimeRange, gymDateOf } from './schedule-format';
import { useAppointmentAction, useAppointments, type AppointmentAction } from './scheduling-api';
import { useNow } from './use-now';

const PAGE_SIZE = 25;
const VIEWS = ['upcoming', 'past'] as const;
type View = (typeof VIEWS)[number];

const STATUS_TONES: Record<AppointmentStatus, BadgeTone> = {
  BOOKED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

const ACTIONS: Record<
  AppointmentAction,
  { title: string; confirm: string; done: string; tone: 'primary' | 'danger' }
> = {
  cancel: {
    title: 'Cancel this appointment?',
    confirm: 'Cancel appointment',
    done: 'Appointment cancelled',
    tone: 'danger',
  },
  complete: {
    title: 'Mark as completed?',
    confirm: 'Mark completed',
    done: 'Marked as completed',
    tone: 'primary',
  },
  'no-show': {
    title: 'Mark as a no-show?',
    confirm: 'Mark no-show',
    done: 'Marked as a no-show',
    tone: 'danger',
  },
};

const GRID = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]';
/**
 * Every row is its own grid, so the actions column gets one fixed width (its widest buttons,
 * "Completed" and "No-show") in each row and in the header; otherwise the columns shift per row.
 */
const ACTIONS_WIDTH = 'lg:w-58';

function AppointmentRow({
  appointment,
  now,
  canManage,
  linkMembers,
  onEdit,
  onAction,
}: {
  appointment: AppointmentDto;
  now: number;
  canManage: boolean;
  linkMembers: boolean;
  onEdit: () => void;
  onAction: (action: AppointmentAction) => void;
}) {
  const booked = appointment.status === 'BOOKED';
  const started = Date.parse(appointment.startsAt) <= now;
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5',
        GRID,
        (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') && 'opacity-70',
      )}
    >
      <span className="min-w-0">
        <span className="block text-13 font-medium text-fg tabular-nums">
          {formatTimeRange(appointment.startsAt, appointment.endsAt)}
        </span>
        <span className="block text-xs text-fg-muted">
          {formatDayHeading(gymDateOf(appointment.startsAt))} · {appointment.durationMinutes} min
        </span>
      </span>
      <span className="justify-self-end lg:order-last lg:hidden">
        <Badge tone={STATUS_TONES[appointment.status]} dot>
          {APPOINTMENT_STATUS_LABELS[appointment.status]}
        </Badge>
      </span>
      <span className="flex min-w-0 items-center gap-3">
        <MemberAvatar member={appointment.member} size="sm" />
        <span className="min-w-0">
          {linkMembers ? (
            <Link
              to={`/members/${appointment.member.id}`}
              className="block truncate text-13 text-fg hover:underline"
            >
              {fullName(appointment.member)}
            </Link>
          ) : (
            <span className="block truncate text-13 text-fg">{fullName(appointment.member)}</span>
          )}
          <span className="block truncate text-xs text-fg-muted">
            <span className="font-mono">{appointment.member.memberCode}</span>
            {appointment.notes && ` · ${appointment.notes}`}
          </span>
        </span>
      </span>
      <span className="truncate text-13 text-fg-secondary">
        <span className="lg:sr-only">With </span>
        {fullName(appointment.trainer)}
      </span>
      <span className="hidden lg:block">
        <Badge tone={STATUS_TONES[appointment.status]} dot>
          {APPOINTMENT_STATUS_LABELS[appointment.status]}
        </Badge>
      </span>
      <span
        className={cn(
          'col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-end',
          canManage && ACTIONS_WIDTH,
        )}
      >
        {canManage && booked && !started && (
          <>
            <Button size="sm" variant="ghost" icon={<Pencil aria-hidden />} onClick={onEdit}>
              Change
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<X aria-hidden />}
              onClick={() => onAction('cancel')}
            >
              Cancel
            </Button>
          </>
        )}
        {canManage && booked && started && (
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={<Check aria-hidden />}
              onClick={() => onAction('complete')}
            >
              Completed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<UserX aria-hidden />}
              onClick={() => onAction('no-show')}
            >
              No-show
            </Button>
          </>
        )}
      </span>
    </li>
  );
}

export function AppointmentsPage() {
  const can = useCan();
  const { user } = useSession();
  const isTrainer = user.role === 'TRAINER';
  const canManage = can('appointments:manage');
  const linkMembers = permissionScope(user.role, 'members:read') === 'ALL';
  const today = gymTodayIso();
  const now = useNow();
  const filters = useUrlFilters();
  const { update } = filters;
  const view: View = filters.oneOf('view', VIEWS) ?? 'upcoming';
  const query: AppointmentListQuery = {
    page: filters.page,
    pageSize: PAGE_SIZE,
    q: filters.text('q'),
    trainerId: isTrainer ? undefined : filters.text('trainer'),
    status: filters.oneOf('status', APPOINTMENT_STATUSES),
    ...(view === 'upcoming' ? { from: today, order: 'asc' } : { to: today, order: 'desc' }),
  };
  const list = useAppointments(query);
  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const filtered = Boolean(query.q || query.trainerId || query.status);
  const [booking, setBooking] = useState(false);
  const [editing, setEditing] = useState<AppointmentDto | null>(null);
  const [acting, setActing] = useState<{ item: AppointmentDto; action: AppointmentAction } | null>(
    null,
  );
  const act = useAppointmentAction();

  return (
    <>
      <PageHeader
        title="Appointments"
        description={
          isTrainer
            ? 'Your personal-training sessions. Book for members assigned to you.'
            : 'Personal-training sessions between a trainer and one member. Times are in gym time.'
        }
        actions={
          canManage && (
            <Button icon={<CalendarClock aria-hidden />} onClick={() => setBooking(true)}>
              Book appointment
            </Button>
          )
        }
      />

      <Tabs
        label="Appointments"
        idPrefix="appointments"
        tabs={[
          { value: 'upcoming', label: 'Today and upcoming' },
          { value: 'past', label: 'Past' },
        ]}
        value={view}
        onChange={(next) => update({ view: next === 'upcoming' ? null : next })}
        className="mb-4"
      />

      <TabPanel idPrefix="appointments" value={view}>
        <Card>
          <div
            className={cn(
              'grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-2 sm:px-5',
              !isTrainer && 'xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]',
            )}
          >
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search appointments"
              placeholder="Member name or code"
            />
            {!isTrainer && (
              <TrainerSelect
                aria-label="Filter by trainer"
                value={query.trainerId ?? ''}
                onChange={(value) => update({ trainer: value || null })}
                emptyLabel="All trainers"
              />
            )}
            <Select
              aria-label="Filter by status"
              value={query.status ?? ''}
              onChange={(event) => update({ status: event.target.value || null })}
            >
              <option value="">Any status</option>
              {APPOINTMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {APPOINTMENT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </div>

          <div
            aria-hidden
            className={cn(
              'hidden gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid',
              GRID,
            )}
          >
            <span>When</span>
            <span>Member</span>
            <span>Trainer</span>
            <span>Status</span>
            <span className={canManage ? ACTIONS_WIDTH : undefined} />
          </div>

          {list.isPending ? (
            <ListSkeleton rows={6} label="Loading appointments" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.data.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck2 aria-hidden />}
              title={
                filtered
                  ? 'No appointments match these filters'
                  : view === 'upcoming'
                    ? 'No appointments coming up'
                    : 'No past appointments'
              }
              description={
                filtered
                  ? 'Try another search, trainer or status.'
                  : canManage
                    ? 'Book a personal-training session and it appears here.'
                    : 'Booked personal-training sessions appear here.'
              }
              action={
                filtered ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => update({ q: null, trainer: null, status: null })}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul
                aria-label="Appointments"
                aria-busy={list.isPlaceholderData}
                className={cn(
                  'divide-y divide-border transition-opacity',
                  list.isPlaceholderData && 'opacity-60',
                )}
              >
                {list.data.data.map((appointment) => (
                  <AppointmentRow
                    key={appointment.id}
                    appointment={appointment}
                    now={now}
                    canManage={canManage}
                    linkMembers={linkMembers}
                    onEdit={() => setEditing(appointment)}
                    onAction={(action) => setActing({ item: appointment, action })}
                  />
                ))}
              </ul>
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                noun="appointments"
                onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
              />
            </>
          )}
        </Card>
      </TabPanel>

      {canManage && (
        <>
          <AppointmentDialog open={booking} onOpenChange={setBooking} />
          {editing && (
            <AppointmentDialog
              key={editing.id}
              appointment={editing}
              open
              onOpenChange={(open) => !open && setEditing(null)}
            />
          )}
          <ConfirmDialog
            open={acting !== null}
            onOpenChange={(open) => !open && setActing(null)}
            title={acting ? ACTIONS[acting.action].title : ''}
            description={
              acting
                ? `${fullName(acting.item.member)} with ${fullName(acting.item.trainer)}, ${formatDayHeading(gymDateOf(acting.item.startsAt))} ${formatTimeRange(acting.item.startsAt, acting.item.endsAt)}.`
                : undefined
            }
            confirmLabel={acting ? ACTIONS[acting.action].confirm : 'Confirm'}
            tone={acting ? ACTIONS[acting.action].tone : 'primary'}
            reason={acting?.action === 'cancel' ? 'optional' : 'none'}
            loading={act.isPending}
            onConfirm={(reason) => {
              if (!acting) return;
              act.mutate(
                { id: acting.item.id, action: acting.action, reason: reason || undefined },
                {
                  onSuccess: () => {
                    toast.success(ACTIONS[acting.action].done);
                    setActing(null);
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                },
              );
            }}
          />
        </>
      )}
    </>
  );
}
