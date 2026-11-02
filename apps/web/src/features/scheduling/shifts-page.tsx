import {
  addDays,
  ROLE_LABELS,
  SHIFT_LIMITS,
  SHIFT_STATUS_LABELS,
  type ShiftDto,
} from '@gms/shared';
import { CalendarClock, CalendarPlus, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { gymDateTimeInputToIso, toGymDateTimeInput } from '../../lib/format';
import { useStaffList } from '../staff/staff-api';
import { FormProblem } from './form-parts';
import { splitServerError, type Errors } from './form-utils';
import { formatDayHeading, formatTimeRange, groupByGymDate } from './schedule-format';
import { useCancelShift, useCreateShift, useShifts, useUpdateShift } from './scheduling-api';
import { useNow } from './use-now';
import { useWeek } from './use-week';
import { WeekNav } from './week-nav';

const HOUR_MS = 3_600_000;

/** Start and end in gym time; an end at or before the start runs past midnight. */
function shiftWindow(date: string, start: string, end: string) {
  if (!date || !start || !end) return null;
  const startsAt = gymDateTimeInputToIso(`${date}T${start}`);
  const endDate = end <= start ? addDays(date, 1) : date;
  return { startsAt, endsAt: gymDateTimeInputToIso(`${endDate}T${end}`) };
}

function ShiftDialog({
  shift,
  initialDate,
  open,
  onOpenChange,
}: {
  shift?: ShiftDto;
  initialDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editing = Boolean(shift);
  const staff = useStaffList({ status: 'active', pageSize: 100 }, open && !editing);
  const create = useCreateShift();
  const update = useUpdateShift();
  const pending = create.isPending || update.isPending;
  const startInput = shift ? toGymDateTimeInput(shift.startsAt) : '';
  const endInput = shift ? toGymDateTimeInput(shift.endsAt) : '';
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(startInput.slice(0, 10) || initialDate);
  const [start, setStart] = useState(startInput.slice(11, 16) || '09:00');
  const [end, setEnd] = useState(endInput.slice(11, 16) || '17:00');
  const [roleNote, setRoleNote] = useState(shift?.roleNote ?? '');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);

  const times = shiftWindow(date, start, end);
  const hours = times ? (Date.parse(times.endsAt) - Date.parse(times.startsAt)) / HOUR_MS : 0;
  const errors: Errors = {};
  if (!editing && !userId) errors.userId = 'Choose a staff member';
  if (!times) errors.startsAt = 'Choose a date, start and end';
  else if (hours > SHIFT_LIMITS.maxHours)
    errors.endsAt = `A shift can last at most ${SHIFT_LIMITS.maxHours} hours`;
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const close = (next: boolean) => {
    if (!next && !editing) {
      setUserId('');
      setRoleNote('');
      setTouched(false);
      setServerErrors({});
      setProblem(null);
    }
    onOpenChange(next);
  };

  const onError = (error: unknown) => {
    const { fields, problem: message } = splitServerError(error);
    setServerErrors(fields);
    setProblem(message);
  };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    setProblem(null);
    if (Object.keys(errors).length > 0 || !times) return;
    const note = roleNote.trim() || null;
    if (shift) {
      update.mutate(
        {
          id: shift.id,
          input: {
            ...(times.startsAt !== shift.startsAt ? { startsAt: times.startsAt } : {}),
            ...(times.endsAt !== shift.endsAt ? { endsAt: times.endsAt } : {}),
            ...(note !== shift.roleNote ? { roleNote: note } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.success('Shift updated');
            close(false);
          },
          onError,
        },
      );
      return;
    }
    create.mutate(
      { userId, ...times, roleNote: note },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.staffName} rostered for ${formatDayHeading(date)}`);
          close(false);
        },
        onError,
      },
    );
  };

  const people = staff.data?.data ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={editing ? `Change ${shift!.staffName}’s shift` : 'Add a shift'}
      description="Times are in gym time. A shift may not overlap another shift for the same person."
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {editing ? 'Save changes' : 'Add shift'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FormProblem message={problem} />
        {!editing && (
          <FormField label="Staff member" error={shown.userId}>
            <Select
              value={userId}
              disabled={staff.isPending}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">{staff.isPending ? 'Loading staff…' : 'Choose a person'}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.firstName} {person.lastName} · {ROLE_LABELS[person.role]}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <div className="grid gap-5 sm:grid-cols-3">
          <FormField label="Date" error={shown.startsAt}>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </FormField>
          <FormField label="Starts">
            <Input
              type="time"
              step={900}
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </FormField>
          <FormField
            label="Ends"
            error={shown.endsAt}
            hint={times && end <= start ? 'Next day' : undefined}
          >
            <Input
              type="time"
              step={900}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Duty" optional error={shown.roleNote} hint="e.g. Front desk, gym floor">
          <Input
            value={roleNote}
            maxLength={SHIFT_LIMITS.roleNoteMax}
            onChange={(event) => setRoleNote(event.target.value)}
          />
        </FormField>
      </form>
    </Dialog>
  );
}

export function ShiftsPage() {
  const can = useCan();
  const { user } = useSession();
  const canManage = can('schedules:manage');
  const now = useNow();
  const week = useWeek();
  const showCancelled = week.filters.text('cancelled') === '1';
  const shifts = useShifts({
    from: week.from,
    to: week.to,
    includeCancelled: showCancelled ? 'true' : undefined,
  });
  const cancel = useCancelShift();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ShiftDto | null>(null);
  const [cancelling, setCancelling] = useState<ShiftDto | null>(null);

  return (
    <>
      <PageHeader
        title={canManage ? 'Staff shifts' : 'My shifts'}
        description={
          canManage
            ? 'Who is working when. Trainers’ shifts are separate from the hours they take bookings.'
            : `Your rostered shifts, ${user.firstName}. Ask an Admin or Manager to change one.`
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5 lg:flex-row lg:items-center">
          <WeekNav week={week} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:ml-auto">
            {canManage && (
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
            )}
            {canManage && (
              <Button icon={<CalendarPlus aria-hidden />} onClick={() => setAdding(true)}>
                Add shift
              </Button>
            )}
          </div>
        </div>
        {shifts.isPending ? (
          <ListSkeleton rows={6} label="Loading shifts" />
        ) : shifts.isError ? (
          <ErrorState error={shifts.error} onRetry={() => shifts.refetch()} />
        ) : shifts.data.length === 0 && !canManage ? (
          <EmptyState
            icon={<CalendarClock aria-hidden />}
            title="No shifts this week"
            description="When an Admin or Manager rosters you, your shifts appear here."
          />
        ) : (
          <ol
            aria-label="Shifts by day"
            aria-busy={shifts.isPlaceholderData}
            className={cn('divide-y divide-border', shifts.isPlaceholderData && 'opacity-60')}
          >
            {groupByGymDate(shifts.data, (s) => s.startsAt, week.from, week.to).map((day) => (
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
                  <p className="px-4 py-2.5 text-13 text-fg-muted sm:px-5">No shifts</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {day.items.map((shift) => {
                      const cancelled = shift.status === 'CANCELLED';
                      const changeable = canManage && !cancelled && Date.parse(shift.endsAt) > now;
                      return (
                        <li
                          key={shift.id}
                          className={cn(
                            'grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:px-5',
                            cancelled && 'opacity-60',
                          )}
                        >
                          <p className="text-13 font-medium text-fg tabular-nums">
                            {formatTimeRange(shift.startsAt, shift.endsAt)}
                          </p>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-fg">
                              {shift.staffName}
                            </p>
                            <p className="truncate text-13 text-fg-muted">
                              {ROLE_LABELS[shift.role]}
                              {shift.roleNote && ` · ${shift.roleNote}`}
                            </p>
                          </div>
                          <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-auto sm:justify-self-end">
                            {cancelled && (
                              <Badge tone="neutral">{SHIFT_STATUS_LABELS.CANCELLED}</Badge>
                            )}
                            {changeable && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={<Pencil aria-hidden />}
                                  onClick={() => setEditing(shift)}
                                >
                                  Change<span className="sr-only"> {shift.staffName}’s shift</span>
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon={<X aria-hidden />}
                                  onClick={() => setCancelling(shift)}
                                >
                                  Cancel<span className="sr-only"> {shift.staffName}’s shift</span>
                                </Button>
                              </>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {canManage && (
        <>
          <ShiftDialog
            open={adding}
            onOpenChange={setAdding}
            initialDate={week.from < week.today ? week.today : week.from}
          />
          {editing && (
            <ShiftDialog
              key={editing.id}
              shift={editing}
              initialDate={week.today}
              open
              onOpenChange={(open) => !open && setEditing(null)}
            />
          )}
          <ConfirmDialog
            open={cancelling !== null}
            onOpenChange={(open) => !open && setCancelling(null)}
            title={`Cancel ${cancelling?.staffName ?? 'this'}’s shift?`}
            description={
              cancelling
                ? `${formatDayHeading(toGymDateTimeInput(cancelling.startsAt).slice(0, 10))}, ${formatTimeRange(cancelling.startsAt, cancelling.endsAt)}. It stays on record as cancelled.`
                : undefined
            }
            confirmLabel="Cancel shift"
            tone="danger"
            reason="optional"
            loading={cancel.isPending}
            onConfirm={(reason) => {
              if (!cancelling) return;
              cancel.mutate(
                { id: cancelling.id, reason },
                {
                  onSuccess: () => {
                    toast.success('Shift cancelled');
                    setCancelling(null);
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
