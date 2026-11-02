import {
  TRAINER_LIMITS,
  WEEKDAY_LABELS,
  WEEKDAYS,
  timeToMinutes,
  type AvailabilitySlotDto,
  type TimeOffDto,
} from '@gms/shared';
import { CalendarOff, CalendarPlus, Clock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button, IconButton } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { ErrorState, ListSkeleton } from '../../components/ui/states';
import { formatDate, formatDateTime, gymDateTimeInputToIso, gymTodayIso } from '../../lib/format';
import { FormProblem } from './form-parts';
import { splitServerError, type Errors } from './form-utils';
import {
  useAddTimeOff,
  useAvailability,
  useCancelTimeOff,
  useSetAvailability,
} from './scheduling-api';
import { useNow } from './use-now';

interface SlotDraft {
  key: number;
  weekday: number;
  startTime: string;
  endTime: string;
}

let nextKey = 1;
const draft = (slot: Omit<SlotDraft, 'key'>): SlotDraft => ({ ...slot, key: nextKey++ });

/** Monday's 06:00–10:00 and 17:00–21:00 read as one line per weekday. */
function WeeklyHours({ slots }: { slots: AvailabilitySlotDto[] }) {
  return (
    <dl className="divide-y divide-border">
      {WEEKDAYS.map((day) => {
        const daySlots = slots
          .filter((slot) => slot.weekday === day)
          .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
        return (
          <div key={day} className="flex items-baseline gap-4 px-4 py-2.5 sm:px-5">
            <dt className="w-10 shrink-0 text-13 font-medium text-fg-secondary">
              {WEEKDAY_LABELS[day]}
            </dt>
            <dd className="text-13 text-fg tabular-nums">
              {daySlots.length === 0 ? (
                <span className="text-fg-muted">Not working</span>
              ) : (
                daySlots.map((slot) => `${slot.startTime}–${slot.endTime}`).join(', ')
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function AvailabilityDialog({
  trainerId,
  trainerName,
  initial,
  onOpenChange,
}: {
  trainerId: string;
  trainerName: string;
  initial: AvailabilitySlotDto[];
  onOpenChange: (open: boolean) => void;
}) {
  const today = gymTodayIso();
  const save = useSetAvailability();
  const [slots, setSlots] = useState<SlotDraft[]>(() =>
    [...initial]
      .sort(
        (a, b) => a.weekday - b.weekday || timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
      )
      .map((slot) => draft(slot)),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);

  const errors: Errors = {};
  slots.forEach((slot, index) => {
    if (!slot.startTime || !slot.endTime) errors[`slots.${index}.startTime`] = 'Enter both times';
    else if (timeToMinutes(slot.endTime) <= timeToMinutes(slot.startTime))
      errors[`slots.${index}.endTime`] = 'Must end after it starts';
  });
  if (!effectiveFrom || effectiveFrom < today) errors.effectiveFrom = 'Today or later';
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const change = (key: number, patch: Partial<SlotDraft>) =>
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));

  const addSlot = () => {
    const last = slots.at(-1);
    setSlots((current) => [
      ...current,
      draft({
        weekday: last ? Math.min(7, last.weekday + 1) : 1,
        startTime: last?.startTime ?? '09:00',
        endTime: last?.endTime ?? '17:00',
      }),
    ]);
  };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    setProblem(null);
    if (Object.keys(errors).length > 0) return;
    save.mutate(
      {
        id: trainerId,
        input: {
          slots: slots.map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
          effectiveFrom,
        },
      },
      {
        onSuccess: () => {
          toast.success(
            effectiveFrom === today
              ? `${trainerName}’s weekly hours updated`
              : `New hours saved from ${formatDate(effectiveFrom)}`,
          );
          onOpenChange(false);
        },
        onError: (error) => {
          const { fields, problem: message } = splitServerError(error);
          setServerErrors(fields);
          setProblem(message);
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Weekly hours"
      description="When this trainer can teach classes and take personal-training bookings. Existing bookings are kept."
      size="lg"
      busy={save.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save hours
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
        {slots.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-13 text-fg-muted">
            No hours. Saving now means the trainer cannot be booked from that date.
          </p>
        ) : (
          <ul aria-label="Time slots" className="flex flex-col gap-3">
            {slots.map((slot, index) => {
              const error =
                shown[`slots.${index}.startTime`] ??
                shown[`slots.${index}.endTime`] ??
                shown[`slots.${index}.weekday`];
              const label = `${WEEKDAY_LABELS[slot.weekday as 1]} slot ${index + 1}`;
              return (
                <li key={slot.key}>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                    <Select
                      aria-label={`Day for ${label}`}
                      value={String(slot.weekday)}
                      onChange={(event) =>
                        change(slot.key, { weekday: Number(event.target.value) })
                      }
                    >
                      {WEEKDAYS.map((day) => (
                        <option key={day} value={day}>
                          {WEEKDAY_LABELS[day]}
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="time"
                      step={900}
                      aria-label={`Start of ${label}`}
                      aria-invalid={Boolean(error)}
                      value={slot.startTime}
                      onChange={(event) => change(slot.key, { startTime: event.target.value })}
                    />
                    <Input
                      type="time"
                      step={900}
                      aria-label={`End of ${label}`}
                      aria-invalid={Boolean(error)}
                      value={slot.endTime}
                      onChange={(event) => change(slot.key, { endTime: event.target.value })}
                    />
                    <IconButton
                      label={`Remove ${label}`}
                      onClick={() =>
                        setSlots((current) => current.filter((item) => item.key !== slot.key))
                      }
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </div>
                  {error && <p className="mt-1 text-13 text-danger-text">{error}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus aria-hidden />}
            onClick={addSlot}
            disabled={slots.length >= TRAINER_LIMITS.slotsMax}
          >
            Add hours
          </Button>
        </div>
        <FormField
          label="Starting"
          error={shown.effectiveFrom}
          hint="Hours before this date stay as they were."
          className="sm:max-w-56"
        >
          <Input
            type="date"
            value={effectiveFrom}
            min={today}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </FormField>
      </form>
    </Dialog>
  );
}

function TimeOffDialog({
  trainerId,
  open,
  onOpenChange,
}: {
  trainerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const today = gymTodayIso();
  const add = useAddTimeOff();
  const [from, setFrom] = useState(`${today}T00:00`);
  const [until, setUntil] = useState(`${today}T23:59`);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);

  const errors: Errors = {};
  if (!from) errors.startsAt = 'Choose a start';
  if (!until) errors.endsAt = 'Choose an end';
  else if (from && until <= from) errors.endsAt = 'Must be after the start';
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const close = (next: boolean) => {
    if (!next) {
      setFrom(`${today}T00:00`);
      setUntil(`${today}T23:59`);
      setReason('');
      setTouched(false);
      setServerErrors({});
      setProblem(null);
    }
    onOpenChange(next);
  };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    setProblem(null);
    if (Object.keys(errors).length > 0) return;
    add.mutate(
      {
        id: trainerId,
        input: {
          startsAt: gymDateTimeInputToIso(from),
          endsAt: gymDateTimeInputToIso(until),
          reason: reason.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Time off added');
          close(false);
        },
        onError: (error) => {
          const { fields, problem: message } = splitServerError(error);
          setServerErrors(fields);
          setProblem(message);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Add time off"
      description={`Leave, training or sick days, up to ${TRAINER_LIMITS.timeOffMaxDays} days. Classes and appointments already booked in this time must be moved first.`}
      busy={add.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.isPending}>
            Add time off
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
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="From" error={shown.startsAt} hint="Gym time">
            <Input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </FormField>
          <FormField label="Until" error={shown.endsAt}>
            <Input
              type="datetime-local"
              value={until}
              min={from}
              onChange={(event) => setUntil(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Reason" optional error={shown.reason}>
          <Textarea
            rows={2}
            value={reason}
            maxLength={TRAINER_LIMITS.notesMax}
            placeholder="e.g. Annual leave"
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </form>
    </Dialog>
  );
}

/** Weekly hours and time off, side by side on wide screens. */
export function TrainerHours({
  trainerId,
  trainerName,
  canManage,
}: {
  trainerId: string;
  trainerName: string;
  canManage: boolean;
}) {
  const availability = useAvailability(trainerId);
  const cancel = useCancelTimeOff();
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [addingTimeOff, setAddingTimeOff] = useState(false);
  const [cancelling, setCancelling] = useState<TimeOffDto | null>(null);

  if (availability.isPending) return <ListSkeleton rows={7} label="Loading hours" />;
  if (availability.isError)
    return (
      <Card>
        <ErrorState error={availability.error} onRetry={() => availability.refetch()} />
      </Card>
    );

  const { current, upcoming, timeOff } = availability.data;
  const visibleTimeOff = timeOff.filter(
    (item) => item.status === 'ACTIVE' && Date.parse(item.endsAt) > now,
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Weekly hours"
          description="Personal-training appointments can only be booked inside these hours."
          action={
            canManage && (
              <Button
                variant="secondary"
                size="sm"
                icon={<Pencil aria-hidden />}
                onClick={() => setEditing(true)}
              >
                Edit hours
              </Button>
            )
          }
        />
        {current.length === 0 && !upcoming ? (
          <p className="flex items-center gap-2 px-4 py-4 text-13 text-fg-muted sm:px-5">
            <Clock className="size-4" aria-hidden />
            No weekly hours yet, so no appointments can be booked with this trainer.
          </p>
        ) : (
          <WeeklyHours slots={current} />
        )}
        {upcoming && (
          <div className="border-t border-border bg-info-subtle px-4 py-3 sm:px-5">
            <p className="text-13 font-medium text-info-text">
              Changing on {formatDate(upcoming.effectiveFrom)}
            </p>
            <p className="mt-0.5 text-13 text-info-text">
              {upcoming.slots.length === 0
                ? 'No hours from then on.'
                : WEEKDAYS.filter((day) => upcoming.slots.some((slot) => slot.weekday === day))
                    .map((day) => WEEKDAY_LABELS[day])
                    .join(', ')}
            </p>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader
          title="Time off"
          description="Upcoming and current. Nothing can be booked during time off."
          action={
            canManage && (
              <Button
                variant="secondary"
                size="sm"
                icon={<CalendarPlus aria-hidden />}
                onClick={() => setAddingTimeOff(true)}
              >
                Add time off
              </Button>
            )
          }
        />
        {visibleTimeOff.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-4 text-13 text-fg-muted sm:px-5">
            <CalendarOff className="size-4" aria-hidden />
            No time off planned.
          </p>
        ) : (
          <ul aria-label="Time off" className="divide-y divide-border">
            {visibleTimeOff.map((item) => {
              const ongoing = Date.parse(item.startsAt) <= now;
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-13 font-medium text-fg tabular-nums">
                      {formatDateTime(item.startsAt)} – {formatDateTime(item.endsAt)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-13 text-fg-muted">
                      {ongoing && <Badge tone="warning">Now</Badge>}
                      {item.reason ?? 'No reason given'}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X aria-hidden />}
                      onClick={() => setCancelling(item)}
                    >
                      Cancel<span className="sr-only"> this time off</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {canManage && editing && (
        <AvailabilityDialog
          trainerId={trainerId}
          trainerName={trainerName}
          initial={upcoming ? upcoming.slots : current}
          onOpenChange={setEditing}
        />
      )}
      {canManage && (
        <>
          <TimeOffDialog
            trainerId={trainerId}
            open={addingTimeOff}
            onOpenChange={setAddingTimeOff}
          />
          <ConfirmDialog
            open={cancelling !== null}
            onOpenChange={(open) => !open && setCancelling(null)}
            title="Cancel this time off?"
            description="The trainer becomes bookable again in these hours."
            confirmLabel="Cancel time off"
            tone="danger"
            reason="optional"
            loading={cancel.isPending}
            onConfirm={(reason) => {
              if (!cancelling) return;
              cancel.mutate(
                { id: cancelling.id, reason },
                {
                  onSuccess: () => {
                    toast.success('Time off cancelled');
                    setCancelling(null);
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                },
              );
            }}
          />
        </>
      )}
    </div>
  );
}
