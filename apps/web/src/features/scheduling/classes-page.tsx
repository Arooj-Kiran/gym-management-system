import type { ClassSessionDto, FitnessClassDto } from '@gms/shared';
import { Archive, CalendarPlus, Dumbbell, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { PageHeader } from '../../components/ui/page-header';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { ClassFormDialog, ScheduleSessionDialog } from './class-dialogs';
import { TrainerSelect } from './form-parts';
import { formatDayHeading, formatTimeRange, groupByGymDate } from './schedule-format';
import { useArchiveClass, useClasses, useClassSessions } from './scheduling-api';
import { SessionAvailability } from './session-badges';
import { useWeek } from './use-week';
import { WeekNav } from './week-nav';

type Tab = 'timetable' | 'classes';

function SessionRow({ session }: { session: ClassSessionDto }) {
  return (
    <li
      className={cn(
        'grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:items-center sm:px-5',
        session.effectiveStatus === 'CANCELLED' && 'opacity-60',
      )}
    >
      <p className="text-13 font-medium text-fg tabular-nums">
        {formatTimeRange(session.startsAt, session.endsAt)}
      </p>
      <div className="min-w-0">
        <Link
          to={`/classes/sessions/${session.id}`}
          className="text-sm font-medium text-fg hover:text-primary-text hover:underline"
        >
          {session.className}
        </Link>
        <p className="truncate text-13 text-fg-muted">
          {fullName(session.trainer)}
          {session.room && ` · ${session.room}`}
          <span className="tabular-nums">
            {' '}
            · {session.bookedCount}/{session.capacity}
          </span>
        </p>
      </div>
      <div className="col-start-2 sm:col-start-auto sm:justify-self-end">
        <SessionAvailability session={session} />
      </div>
    </li>
  );
}

function Timetable({ canManage }: { canManage: boolean }) {
  const week = useWeek();
  const trainerId = week.filters.text('trainer');
  const showCancelled = week.filters.text('cancelled') === '1';
  const [scheduling, setScheduling] = useState(false);
  const sessions = useClassSessions({
    from: week.from,
    to: week.to,
    trainerId,
    includeCancelled: showCancelled ? 'true' : undefined,
  });

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5 lg:flex-row lg:items-center">
          <WeekNav week={week} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:ml-auto">
            <TrainerSelect
              aria-label="Filter by trainer"
              value={trainerId ?? ''}
              onChange={(value) => week.filters.update({ trainer: value || null }, false)}
              emptyLabel="All trainers"
              className="sm:w-48"
            />
            <label className="flex cursor-pointer items-center gap-2 text-13 text-fg-secondary">
              <input
                type="checkbox"
                className="size-4 cursor-pointer accent-primary"
                checked={showCancelled}
                onChange={(event) =>
                  week.filters.update({ cancelled: event.target.checked ? '1' : null }, false)
                }
              />
              Show cancelled
            </label>
            {canManage && (
              <Button icon={<CalendarPlus aria-hidden />} onClick={() => setScheduling(true)}>
                Schedule a class
              </Button>
            )}
          </div>
        </div>
        {sessions.isPending ? (
          <ListSkeleton rows={6} label="Loading the timetable" />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : (
          <ol
            aria-label="Class timetable"
            aria-busy={sessions.isPlaceholderData}
            className={cn('divide-y divide-border', sessions.isPlaceholderData && 'opacity-60')}
          >
            {groupByGymDate(sessions.data, (s) => s.startsAt, week.from, week.to).map((day) => (
              <li key={day.date}>
                <h3
                  className={cn(
                    'bg-surface-muted/60 px-4 py-2 text-xs font-semibold tracking-wide uppercase sm:px-5',
                    day.date === week.today ? 'text-primary-text' : 'text-fg-muted',
                  )}
                >
                  {formatDayHeading(day.date)}
                  {day.date === week.today && <span className="normal-case"> · Today</span>}
                </h3>
                {day.items.length === 0 ? (
                  <p className="px-4 py-2.5 text-13 text-fg-muted sm:px-5">No classes</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {day.items.map((session) => (
                      <SessionRow key={session.id} session={session} />
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {canManage && (
        <ScheduleSessionDialog
          open={scheduling}
          onOpenChange={setScheduling}
          initialDate={week.from < week.today ? week.today : week.from}
        />
      )}
    </>
  );
}

function ClassTemplates({ canManage }: { canManage: boolean }) {
  const classes = useClasses();
  const archive = useArchiveClass();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FitnessClassDto | null>(null);
  const [archiving, setArchiving] = useState<FitnessClassDto | null>(null);

  return (
    <>
      <Card>
        {canManage && (
          <div className="flex justify-end border-b border-border p-4 sm:px-5">
            <Button icon={<Plus aria-hidden />} onClick={() => setCreating(true)}>
              New class
            </Button>
          </div>
        )}
        {classes.isPending ? (
          <ListSkeleton rows={4} label="Loading classes" />
        ) : classes.isError ? (
          <ErrorState error={classes.error} onRetry={() => classes.refetch()} />
        ) : classes.data.length === 0 ? (
          <EmptyState
            icon={<Dumbbell aria-hidden />}
            title="No classes yet"
            description={
              canManage
                ? 'Create a class such as “Morning Strength Circuit”, then schedule its sessions.'
                : 'An Admin or Manager has not set up any classes yet.'
            }
          />
        ) : (
          <ul aria-label="Classes" className="divide-y divide-border">
            {classes.data.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{item.name}</p>
                  {item.description && (
                    <p className="mt-0.5 line-clamp-2 text-13 text-fg-muted">{item.description}</p>
                  )}
                  <p className="mt-1 text-13 text-fg-secondary">
                    {item.defaultDurationMinutes} min · {item.defaultCapacity} places
                    {item.defaultTrainer && ` · usually ${fullName(item.defaultTrainer)}`}
                  </p>
                </div>
                <Badge tone={item.upcomingSessions > 0 ? 'primary' : 'neutral'}>
                  {item.upcomingSessions} upcoming
                </Badge>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Pencil aria-hidden />}
                      onClick={() => setEditing(item)}
                    >
                      Edit<span className="sr-only"> {item.name}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Archive aria-hidden />}
                      onClick={() => setArchiving(item)}
                    >
                      Archive<span className="sr-only"> {item.name}</span>
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canManage && (
        <>
          <ClassFormDialog open={creating} onOpenChange={setCreating} />
          {editing && (
            <ClassFormDialog
              key={editing.id}
              fitnessClass={editing}
              open
              onOpenChange={(open) => !open && setEditing(null)}
            />
          )}
          <ConfirmDialog
            open={archiving !== null}
            onOpenChange={(open) => !open && setArchiving(null)}
            title={`Archive ${archiving?.name ?? 'class'}?`}
            description={
              archiving && archiving.upcomingSessions > 0
                ? `It has ${archiving.upcomingSessions} upcoming ${archiving.upcomingSessions === 1 ? 'session' : 'sessions'}. Those stay on the timetable; cancel them separately if they should not run. No new sessions can be scheduled.`
                : 'No new sessions can be scheduled. Past sessions and bookings stay on record.'
            }
            confirmLabel="Archive class"
            tone="danger"
            loading={archive.isPending}
            onConfirm={() => {
              if (!archiving) return;
              archive.mutate(archiving.id, {
                onSuccess: (saved) => {
                  toast.success(`${saved.name} archived`);
                  setArchiving(null);
                },
                onError: (error) => toast.error(errorMessage(error)),
              });
            }}
          />
        </>
      )}
    </>
  );
}

export function ClassesPage() {
  const can = useCan();
  const { user } = useSession();
  const canManage = can('classes:manage');
  const [tab, setTab] = useState<Tab>('timetable');

  return (
    <>
      <PageHeader
        title="Classes"
        description={
          user.role === 'TRAINER'
            ? 'The gym’s class timetable. Open one of your classes to see who is booked and mark attendance.'
            : 'The weekly timetable, bookings and waitlists. Times are in gym time.'
        }
      />
      <Tabs
        label="Classes"
        idPrefix="classes"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'timetable', label: 'Timetable' },
          { value: 'classes', label: 'Class list' },
        ]}
        className="mb-4"
      />
      <TabPanel idPrefix="classes" value={tab}>
        {tab === 'timetable' ? (
          <Timetable canManage={canManage} />
        ) : (
          <ClassTemplates canManage={canManage} />
        )}
      </TabPanel>
    </>
  );
}
