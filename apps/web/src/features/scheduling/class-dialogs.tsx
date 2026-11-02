import {
  addDays,
  CLASS_LIMITS,
  TRAINER_LIMITS,
  type ClassSessionDto,
  type FitnessClassDto,
} from '@gms/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { fullName } from '../../lib/auth';
import { gymDateTimeInputToIso, gymTodayIso, toGymDateTimeInput } from '../../lib/format';
import { FormProblem, TrainerSelect } from './form-parts';
import { parseWhole, splitServerError, type Errors } from './form-utils';
import { formatDayHeading, isoWeekday } from './schedule-format';
import {
  useClasses,
  useCreateClass,
  useCreateSessions,
  useUpdateClass,
  useUpdateSession,
} from './scheduling-api';
import { useNow } from './use-now';

const { minDurationMinutes: MIN_LENGTH, maxDurationMinutes: MAX_LENGTH } = TRAINER_LIMITS;

function lengthError(value: string) {
  const minutes = parseWhole(value);
  if (minutes === null) return 'Enter a length in whole minutes';
  if (minutes < MIN_LENGTH || minutes > MAX_LENGTH)
    return `Between ${MIN_LENGTH} and ${MAX_LENGTH} minutes`;
  return undefined;
}

function capacityError(value: string) {
  const places = parseWhole(value);
  if (places === null) return 'Enter a whole number';
  if (places < CLASS_LIMITS.minCapacity || places > CLASS_LIMITS.maxCapacity)
    return `Between ${CLASS_LIMITS.minCapacity} and ${CLASS_LIMITS.maxCapacity}`;
  return undefined;
}

/** A class template: what it is, how long it runs, how many it holds and who usually teaches. */
export function ClassFormDialog({
  fitnessClass,
  open,
  onOpenChange,
}: {
  fitnessClass?: FitnessClassDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(fitnessClass?.name ?? '');
  const [description, setDescription] = useState(fitnessClass?.description ?? '');
  const [duration, setDuration] = useState(String(fitnessClass?.defaultDurationMinutes ?? 60));
  const [capacity, setCapacity] = useState(String(fitnessClass?.defaultCapacity ?? 12));
  const [trainerId, setTrainerId] = useState(fitnessClass?.defaultTrainer?.id ?? '');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateClass();
  const update = useUpdateClass();
  const saving = create.isPending || update.isPending;

  const errors: Errors = {};
  if (name.trim().length < 2) errors.name = 'Enter a name of at least 2 characters';
  const durationProblem = lengthError(duration);
  if (durationProblem) errors.defaultDurationMinutes = durationProblem;
  const capacityProblem = capacityError(capacity);
  if (capacityProblem) errors.defaultCapacity = capacityProblem;
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const close = (next: boolean) => {
    if (!next && !fitnessClass) {
      setName('');
      setDescription('');
      setDuration('60');
      setCapacity('12');
      setTrainerId('');
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
    const input = {
      name: name.trim(),
      description: description.trim() || null,
      defaultDurationMinutes: Number(duration),
      defaultCapacity: Number(capacity),
      defaultTrainerId: trainerId || null,
    };
    const handlers = {
      onSuccess: (saved: FitnessClassDto) => {
        toast.success(fitnessClass ? `${saved.name} updated` : `${saved.name} created`);
        close(false);
      },
      onError: (error: unknown) => {
        const { fields, problem: message } = splitServerError(error);
        setServerErrors(fields);
        setProblem(message);
      },
    };
    if (fitnessClass) update.mutate({ id: fitnessClass.id, input }, handlers);
    else create.mutate(input, handlers);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={fitnessClass ? `Edit ${fitnessClass.name}` : 'New class'}
      description="These are the defaults each new session starts from; a session can change them."
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            {fitnessClass ? 'Save changes' : 'Create class'}
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
        <FormField label="Name" error={shown.name}>
          <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </FormField>
        <FormField label="Description" optional error={shown.description}>
          <Textarea
            rows={2}
            value={description}
            maxLength={CLASS_LIMITS.descriptionMax}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Length (minutes)" error={shown.defaultDurationMinutes}>
            <Input
              inputMode="numeric"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </FormField>
          <FormField label="Places" error={shown.defaultCapacity}>
            <Input
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </FormField>
        </div>
        <FormField
          label="Usual trainer"
          optional
          error={shown.defaultTrainerId}
          hint="New sessions are given this trainer unless you choose another."
        >
          <TrainerSelect value={trainerId} onChange={setTrainerId} emptyLabel="No default" />
        </FormField>
      </form>
    </Dialog>
  );
}

/** One session, or the same slot every week up to a date. */
export function ScheduleSessionDialog({
  open,
  onOpenChange,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: string;
}) {
  const today = gymTodayIso();
  const classes = useClasses();
  const create = useCreateSessions();
  const [classId, setClassId] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [date, setDate] = useState(initialDate < today ? today : initialDate);
  const [time, setTime] = useState('07:00');
  const [duration, setDuration] = useState('');
  const [capacity, setCapacity] = useState('');
  const [room, setRoom] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState(addDays(date, 28));
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const now = useNow();

  const active = (classes.data ?? []).filter((item) => item.isActive);
  const chosen = active.find((item) => item.id === classId);

  const pickClass = (id: string) => {
    setClassId(id);
    const next = active.find((item) => item.id === id);
    if (next) {
      setDuration(String(next.defaultDurationMinutes));
      setCapacity(String(next.defaultCapacity));
      setTrainerId(next.defaultTrainer?.id ?? '');
    }
  };

  const errors: Errors = {};
  if (!chosen) errors.classId = 'Choose a class';
  if (!trainerId) errors.trainerId = 'Choose a trainer';
  if (!date) errors.startsAt = 'Choose a date';
  else if (!time) errors.startsAt = 'Choose a start time';
  else if (Date.parse(gymDateTimeInputToIso(`${date}T${time}`)) <= now)
    errors.startsAt = 'Choose a time in the future';
  const durationProblem = lengthError(duration);
  if (durationProblem) errors.durationMinutes = durationProblem;
  const capacityProblem = capacityError(capacity);
  if (capacityProblem) errors.capacity = capacityProblem;
  if (repeat && (!until || until < date)) errors.repeatWeeklyUntil = 'Must be on or after the date';
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const weeks =
    repeat && until >= date
      ? Math.floor((Date.parse(until) - Date.parse(date)) / 604_800_000) + 1
      : 1;

  const close = (next: boolean) => {
    if (!next) {
      setClassId('');
      setTrainerId('');
      setRoom('');
      setRepeat(false);
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
    if (Object.keys(errors).length > 0 || !chosen) return;
    create.mutate(
      {
        classId: chosen.id,
        trainerId,
        startsAt: gymDateTimeInputToIso(`${date}T${time}`),
        durationMinutes: Number(duration),
        capacity: Number(capacity),
        room: room.trim() || null,
        repeatWeeklyUntil: repeat ? until : undefined,
      },
      {
        onSuccess: (result) => {
          const count = result.data.length;
          toast.success(
            count === 1
              ? `${chosen.name} scheduled for ${formatDayHeading(date)}`
              : `${count} ${chosen.name} sessions scheduled`,
          );
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
      title="Schedule a class"
      description="The trainer must not be teaching, training or on time off then, and the room must be free."
      size="lg"
      busy={create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            {weeks > 1 ? `Schedule ${weeks} sessions` : 'Schedule session'}
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
          <FormField label="Class" error={shown.classId}>
            <Select value={classId} onChange={(event) => pickClass(event.target.value)}>
              <option value="">{classes.isPending ? 'Loading classes…' : 'Choose a class'}</option>
              {active.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Trainer" error={shown.trainerId}>
            <TrainerSelect
              value={trainerId}
              onChange={setTrainerId}
              emptyLabel="Choose a trainer"
            />
          </FormField>
          <FormField label="Date" error={shown.startsAt}>
            <Input
              type="date"
              value={date}
              min={today}
              onChange={(event) => setDate(event.target.value)}
            />
          </FormField>
          <FormField label="Start time" hint="Gym time">
            <Input
              type="time"
              step={300}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </FormField>
          <FormField label="Length (minutes)" error={shown.durationMinutes}>
            <Input
              inputMode="numeric"
              value={duration}
              placeholder={chosen ? undefined : 'From the class'}
              onChange={(event) => setDuration(event.target.value)}
            />
          </FormField>
          <FormField label="Places" error={shown.capacity}>
            <Input
              inputMode="numeric"
              value={capacity}
              placeholder={chosen ? undefined : 'From the class'}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </FormField>
          <FormField label="Room" optional error={shown.room} className="sm:col-span-2">
            <Input
              value={room}
              maxLength={CLASS_LIMITS.roomMax}
              placeholder="e.g. Studio A"
              onChange={(event) => setRoom(event.target.value)}
            />
          </FormField>
        </div>
        <fieldset className="flex flex-col gap-3 rounded-md border border-border px-4 py-3">
          <legend className="sr-only">Repeat</legend>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-fg">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(event) => setRepeat(event.target.checked)}
              className="size-4 cursor-pointer accent-primary"
            />
            Repeat every {date ? formatWeekdayName(date) : 'week'}
          </label>
          {repeat && (
            <FormField
              label="Last date"
              error={shown.repeatWeeklyUntil}
              hint={`Up to ${CLASS_LIMITS.maxOccurrences} sessions. A clash in any week stops the whole series.`}
            >
              <Input
                type="date"
                value={until}
                min={date}
                onChange={(event) => setUntil(event.target.value)}
              />
            </FormField>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

const WEEKDAY_NAMES = [
  '',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const formatWeekdayName = (date: string) => WEEKDAY_NAMES[isoWeekday(date)] ?? 'week';

/** Move a session, change its trainer, room or size. Booked members keep their places. */
export function EditSessionDialog({
  session,
  onOpenChange,
}: {
  session: ClassSessionDto;
  onOpenChange: (open: boolean) => void;
}) {
  const start = toGymDateTimeInput(session.startsAt);
  const [trainerId, setTrainerId] = useState(session.trainer.id);
  const [date, setDate] = useState(start.slice(0, 10));
  const [time, setTime] = useState(start.slice(11, 16));
  const [duration, setDuration] = useState(String(session.durationMinutes));
  const [capacity, setCapacity] = useState(String(session.capacity));
  const [room, setRoom] = useState(session.room ?? '');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateSession();
  const today = gymTodayIso();
  const now = useNow();

  const startsAt = date && time ? gymDateTimeInputToIso(`${date}T${time}`) : '';
  const errors: Errors = {};
  if (!startsAt) errors.startsAt = 'Choose a date and time';
  else if (startsAt !== session.startsAt && Date.parse(startsAt) <= now)
    errors.startsAt = 'Choose a time in the future';
  const durationProblem = lengthError(duration);
  if (durationProblem) errors.durationMinutes = durationProblem;
  const capacityProblem = capacityError(capacity);
  if (capacityProblem) errors.capacity = capacityProblem;
  else if (Number(capacity) < session.bookedCount)
    errors.capacity = `${session.bookedCount} places are already booked`;
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    setProblem(null);
    if (Object.keys(errors).length > 0) return;
    update.mutate(
      {
        id: session.id,
        input: {
          trainerId: trainerId !== session.trainer.id ? trainerId : undefined,
          startsAt: startsAt !== session.startsAt ? startsAt : undefined,
          durationMinutes:
            Number(duration) !== session.durationMinutes ? Number(duration) : undefined,
          capacity: Number(capacity) !== session.capacity ? Number(capacity) : undefined,
          room: room.trim() || null,
        },
      },
      {
        onSuccess: () => {
          toast.success('Session updated');
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
      title={`Edit ${session.className}`}
      description={`Taught by ${fullName(session.trainer)}. Booked members keep their places.`}
      busy={update.isPending}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} loading={update.isPending}>
            Save changes
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
        <FormField label="Trainer" error={shown.trainerId}>
          <TrainerSelect value={trainerId} onChange={setTrainerId} />
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Date" error={shown.startsAt}>
            <Input
              type="date"
              value={date}
              min={today}
              onChange={(event) => setDate(event.target.value)}
            />
          </FormField>
          <FormField label="Start time" hint="Gym time">
            <Input
              type="time"
              step={300}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </FormField>
          <FormField label="Length (minutes)" error={shown.durationMinutes}>
            <Input
              inputMode="numeric"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </FormField>
          <FormField label="Places" error={shown.capacity}>
            <Input
              inputMode="numeric"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          </FormField>
        </div>
        <FormField label="Room" optional error={shown.room}>
          <Input
            value={room}
            maxLength={CLASS_LIMITS.roomMax}
            onChange={(event) => setRoom(event.target.value)}
          />
        </FormField>
      </form>
    </Dialog>
  );
}
