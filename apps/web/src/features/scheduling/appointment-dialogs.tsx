import { permissionScope, TRAINER_LIMITS, type AppointmentDto } from '@gms/shared';
import { CalendarX2, Clock } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button, ButtonLink } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { ListSkeleton } from '../../components/ui/states';
import { fullName, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatTime, gymTodayIso, toGymDateTimeInput } from '../../lib/format';
import { MemberPicker, type PickedMember } from '../members/member-picker';
import { FormProblem, TrainerSelect } from './form-parts';
import { splitServerError, type Errors } from './form-utils';
import { formatDayHeading, isoWeekday, weekdayName, whyNoTimes } from './schedule-format';
import {
  useAvailability,
  useAvailableSlots,
  useCreateAppointment,
  useTrainers,
  useUpdateAppointment,
} from './scheduling-api';

const LENGTHS = [30, 45, 60, 90, 120];

const listFormat = new Intl.ListFormat('en-GB', { type: 'conjunction' });

/**
 * Why no start time is offered: the trainer has no weekly hours, does not work that weekday, or
 * every time that day is taken. Each case says what to do next instead of a bare "no times".
 */
function NoTimes({
  trainerId,
  date,
  durationMinutes,
  onDateChange,
}: {
  trainerId: string;
  date: string;
  durationMinutes: number;
  onDateChange: (date: string) => void;
}) {
  const { user } = useSession();
  const availability = useAvailability(trainerId);
  const trainers = useTrainers();
  const isMe = user.id === trainerId;
  const trainer = trainers.data?.find((option) => option.id === trainerId);
  const name = isMe ? 'You' : trainer ? fullName(trainer) : 'This trainer';
  const hoursScope = permissionScope(user.role, 'trainers:manage-availability');
  const canSetHours = hoursScope === 'ALL' || (hoursScope === 'OWN' && isMe);
  const day = formatDayHeading(date);

  const box = (title: string, body: ReactNode, action?: ReactNode) => (
    <div className="flex gap-3 rounded-md border border-dashed border-border-strong px-3 py-3.5">
      <CalendarX2 className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-13 font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-13 text-fg-secondary">{body}</p>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );

  if (trainer && !trainer.isBookable) {
    return box(
      `${name} ${isMe ? 'are' : 'is'} not taking personal-training clients`,
      "An admin or a manager can change this on the trainer's profile.",
    );
  }
  if (!availability.isSuccess) {
    return box(
      `No free ${durationMinutes}-minute times on ${day}`,
      'Try another day or a shorter session.',
    );
  }

  const reason = whyNoTimes(availability.data, date);
  if (reason.kind === 'NO_HOURS') {
    return box(
      `${name} ${isMe ? 'have' : 'has'} no weekly hours yet`,
      canSetHours
        ? 'Appointments can only be booked inside weekly hours. Add them, then come back to book.'
        : "Appointments can only be booked inside weekly hours. An admin, a manager or the trainer can add them on the trainer's page.",
      canSetHours && (
        <ButtonLink
          to={`/trainers/${trainerId}?tab=hours`}
          variant="secondary"
          size="sm"
          icon={<Clock aria-hidden />}
        >
          Set weekly hours
        </ButtonLink>
      ),
    );
  }
  if (reason.kind === 'DAY_OFF') {
    const works = reason.weekdays.map(weekdayName);
    return box(
      `${name} ${isMe ? "don't" : "doesn't"} work on ${weekdayName(isoWeekday(date))}s`,
      works.length > 0
        ? `${isMe ? 'Your' : 'Their'} weekly hours cover ${listFormat.format(works)}.`
        : 'No weekly hours apply on this date.',
      reason.next && (
        <Button variant="secondary" size="sm" onClick={() => onDateChange(reason.next!)}>
          Show {formatDayHeading(reason.next)}
        </Button>
      ),
    );
  }
  const hours = reason.hours.map((slot) => `${slot.startTime}–${slot.endTime}`);
  return box(
    `No free ${durationMinutes}-minute time on ${day}`,
    `${name} ${isMe ? 'work' : 'works'} ${listFormat.format(hours)} that day, but every ${durationMinutes}-minute time is booked, on time off or already past. Try a shorter session or another day.`,
  );
}

/**
 * Free start times for the trainer on the chosen day, as a radio group. The server offers only
 * times inside the trainer's weekly hours that do not clash with a class, appointment or time
 * off; `extra` keeps an appointment's current time choosable while it is being moved.
 */
function SlotPicker({
  trainerId,
  date,
  durationMinutes,
  value,
  onChange,
  onDateChange,
  extra,
  error,
}: {
  trainerId: string;
  date: string;
  durationMinutes: number;
  value: string;
  onChange: (startsAt: string) => void;
  onDateChange: (date: string) => void;
  extra?: string;
  error?: string;
}) {
  const slots = useAvailableSlots(trainerId || null, { date, durationMinutes });
  const starts = [
    ...new Set([...(extra ? [extra] : []), ...(slots.data ?? []).map((slot) => slot.startsAt)]),
  ].sort();
  // With nothing to choose, the explanation replaces "Choose a start time".
  const none = Boolean(trainerId && date) && slots.isSuccess && starts.length === 0;
  const shownError = none ? undefined : error;

  return (
    <fieldset aria-describedby={shownError ? 'appointment-slot-error' : undefined}>
      <legend className="mb-1.5 text-13 font-medium text-fg">Start time</legend>
      {!trainerId || !date ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-13 text-fg-muted">
          Choose a trainer and a date to see free times.
        </p>
      ) : slots.isPending ? (
        <ListSkeleton rows={2} label="Loading free times" />
      ) : slots.isError ? (
        <p role="alert" className="text-13 text-danger-text">
          {errorMessage(slots.error)}
        </p>
      ) : none ? (
        <NoTimes
          trainerId={trainerId}
          date={date}
          durationMinutes={durationMinutes}
          onDateChange={onDateChange}
        />
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {starts.map((startsAt) => {
            const checked = value === startsAt;
            return (
              <label
                key={startsAt}
                className={cn(
                  'flex h-9 cursor-pointer items-center justify-center rounded-md border text-13 font-medium tabular-nums transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
                  checked
                    ? 'border-primary bg-primary-subtle text-primary-text'
                    : 'border-border text-fg-secondary hover:border-border-strong hover:text-fg',
                )}
              >
                <input
                  type="radio"
                  name="appointment-slot"
                  value={startsAt}
                  checked={checked}
                  onChange={() => onChange(startsAt)}
                  className="sr-only"
                />
                {formatTime(startsAt)}
                {startsAt === extra && <span className="sr-only"> (current time)</span>}
              </label>
            );
          })}
        </div>
      )}
      {shownError && (
        <p id="appointment-slot-error" className="mt-1.5 text-13 text-danger-text">
          {shownError}
        </p>
      )}
    </fieldset>
  );
}

/** Book a personal-training session, or move or re-note an existing one. */
export function AppointmentDialog({
  appointment,
  open,
  onOpenChange,
}: {
  appointment?: AppointmentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useSession();
  const isTrainer = user.role === 'TRAINER';
  const editing = Boolean(appointment);
  const today = gymTodayIso();
  const create = useCreateAppointment();
  const update = useUpdateAppointment();
  const pending = create.isPending || update.isPending;

  const [trainerId, setTrainerId] = useState(appointment?.trainer.id ?? (isTrainer ? user.id : ''));
  const [member, setMember] = useState<PickedMember | null>(null);
  const [date, setDate] = useState(
    appointment ? toGymDateTimeInput(appointment.startsAt).slice(0, 10) : today,
  );
  const [duration, setDuration] = useState(appointment?.durationMinutes ?? 60);
  const [startsAt, setStartsAt] = useState(appointment?.startsAt ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);

  const errors: Errors = {};
  if (!trainerId) errors.trainerId = 'Choose a trainer';
  if (!editing && !member) errors.memberId = 'Choose a member';
  if (!startsAt) errors.startsAt = 'Choose a start time';
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const lengths = LENGTHS.includes(duration)
    ? LENGTHS
    : [...LENGTHS, duration].sort((a, b) => a - b);
  const sameDay = appointment && toGymDateTimeInput(appointment.startsAt).startsWith(date);

  const reset = () => {
    setTrainerId(isTrainer ? user.id : '');
    setMember(null);
    setDate(today);
    setDuration(60);
    setStartsAt('');
    setNotes('');
    setTouched(false);
    setServerErrors({});
    setProblem(null);
  };

  const close = (next: boolean) => {
    if (!next && !editing) reset();
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
    if (Object.keys(errors).length > 0) return;
    const trimmed = notes.trim() || null;
    if (appointment) {
      update.mutate(
        {
          id: appointment.id,
          input: {
            ...(startsAt !== appointment.startsAt ? { startsAt } : {}),
            ...(duration !== appointment.durationMinutes ? { durationMinutes: duration } : {}),
            ...(trimmed !== appointment.notes ? { notes: trimmed } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.success('Appointment updated');
            close(false);
          },
          onError,
        },
      );
      return;
    }
    create.mutate(
      { trainerId, memberId: member!.id, startsAt, durationMinutes: duration, notes: trimmed },
      {
        onSuccess: (saved) => {
          toast.success(
            `${fullName(saved.member)} booked with ${fullName(saved.trainer)} at ${formatTime(saved.startsAt)}`,
          );
          close(false);
        },
        onError,
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={editing ? 'Change appointment' : 'Book an appointment'}
      description={
        editing
          ? `${fullName(appointment!.member)} with ${fullName(appointment!.trainer)}. A new time is checked like a new booking.`
          : 'Personal training with one member. Only times when the trainer is working and free are offered.'
      }
      size="lg"
      busy={pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {editing ? 'Save changes' : 'Book appointment'}
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
          <div>
            <MemberPicker selected={member} onSelect={setMember} name="appointment-member" />
            {shown.memberId && <p className="mt-1.5 text-13 text-danger-text">{shown.memberId}</p>}
            {isTrainer && (
              <p className="mt-1.5 text-13 text-fg-muted">
                You can book sessions for members assigned to you.
              </p>
            )}
          </div>
        )}
        <div className="grid gap-5 sm:grid-cols-3">
          {!editing && !isTrainer && (
            <FormField label="Trainer" error={shown.trainerId}>
              <TrainerSelect
                value={trainerId}
                onChange={(value) => {
                  setTrainerId(value);
                  setStartsAt('');
                }}
                emptyLabel="Choose a trainer"
                bookableOnly
              />
            </FormField>
          )}
          <FormField label="Date">
            <Input
              type="date"
              value={date}
              min={today}
              onChange={(event) => {
                setDate(event.target.value);
                setStartsAt('');
              }}
            />
          </FormField>
          <FormField label="Length" error={shown.durationMinutes}>
            <Select
              value={String(duration)}
              onChange={(event) => {
                setDuration(Number(event.target.value));
                setStartsAt(appointment && sameDay ? appointment.startsAt : '');
              }}
            >
              {lengths.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <SlotPicker
          trainerId={trainerId}
          date={date}
          durationMinutes={duration}
          value={startsAt}
          onChange={setStartsAt}
          onDateChange={(next) => {
            setDate(next);
            setStartsAt('');
          }}
          extra={appointment && sameDay ? appointment.startsAt : undefined}
          error={shown.startsAt}
        />
        <FormField label="Notes" optional error={shown.notes} hint="Seen by staff and the trainer.">
          <Textarea
            value={notes}
            rows={2}
            maxLength={TRAINER_LIMITS.notesMax}
            placeholder="e.g. Focus on squat form; knee rehab week 3"
            onChange={(event) => setNotes(event.target.value)}
          />
        </FormField>
      </form>
    </Dialog>
  );
}
