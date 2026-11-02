import { logWorkoutSchema, WORKOUT_LIMITS, type WorkoutPlanItemDto } from '@gms/shared';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { cn } from '../../lib/cn';
import { gymTodayIso } from '../../lib/format';
import { FormProblem } from '../scheduling/form-parts';
import { ExerciseThumb } from './exercise-thumb';
import { dayLabel, formatPrescription, groupByDay, plural } from './workout-format';
import { useLogMyWorkout, useLogWorkout } from './workouts-api';

interface Row {
  completed: boolean;
  sets: string;
  reps: string;
  load: string;
  duration: string;
}

const rowFor = (item: WorkoutPlanItemDto): Row => ({
  completed: true,
  sets: String(item.sets),
  reps: item.reps === null ? '' : String(item.reps),
  load: item.loadNote ?? '',
  duration: item.durationSeconds === null ? '' : String(item.durationSeconds),
});

const digits = (value: string) => value.replace(/[^\d]/g, '');

function SmallInput({
  label,
  value,
  onChange,
  disabled,
  numeric = true,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  numeric?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        inputMode={numeric ? 'numeric' : undefined}
        maxLength={numeric ? 5 : WORKOUT_LIMITS.loadNoteMax}
        onChange={(event) => onChange(numeric ? digits(event.target.value) : event.target.value)}
        className="h-9 tabular-nums"
      />
    </div>
  );
}

/**
 * Record one session of an assigned plan: pick the day, tick what was done and adjust the
 * numbers. Staff log on the member's behalf; members log for themselves in the portal.
 */
export function LogWorkoutDialog({
  assignmentId,
  planName,
  items,
  mode,
  open,
  onOpenChange,
}: {
  assignmentId: string;
  planName: string;
  items: WorkoutPlanItemDto[];
  mode: 'staff' | 'member';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const today = gymTodayIso();
  const days = groupByDay(items);
  const [day, setDay] = useState(days[0]?.day ?? 1);
  const [performedOn, setPerformedOn] = useState(today);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [extra, setExtra] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const staffLog = useLogWorkout();
  const memberLog = useLogMyWorkout();
  const log = mode === 'staff' ? staffLog : memberLog;
  const dayItems = days.find((d) => d.day === day)?.items ?? [];
  const rowOf = (item: WorkoutPlanItemDto) => rows[item.id] ?? rowFor(item);

  const close = (next: boolean) => {
    if (!next) {
      setRows({});
      setExtra('');
      setProblem(null);
      setPerformedOn(gymTodayIso());
    }
    onOpenChange(next);
  };

  const update = (item: WorkoutPlanItemDto, changes: Partial<Row>) =>
    setRows((current) => ({ ...current, [item.id]: { ...rowOf(item), ...changes } }));

  const submit = () => {
    setProblem(null);
    const entries = [
      ...dayItems.map((item) => {
        const row = rowOf(item);
        return {
          planItemId: item.id,
          completed: row.completed,
          actualSets: row.completed ? row.sets || null : null,
          actualReps: row.completed ? row.reps || null : null,
          actualLoad: row.completed ? row.load : '',
          actualDurationSeconds: row.completed ? row.duration || null : null,
        };
      }),
      ...(extra.trim() ? [{ planItemId: null, completed: true, notes: extra }] : []),
    ];
    const input = { assignmentId, performedOn, entries };
    const parsed = logWorkoutSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const [, , index] = issue.path;
      const item = typeof index === 'number' ? dayItems[index] : undefined;
      setProblem(item ? `${item.exercise.name}: ${issue.message}` : issue.message);
      return;
    }
    if (!entries.some((entry) => entry.completed)) {
      setProblem('Tick at least one exercise you did, or describe other work below.');
      return;
    }
    log.mutate(input, {
      onSuccess: () => {
        const done = entries.filter((entry) => entry.completed).length;
        toast.success(performedOn === today ? 'Workout logged for today' : 'Workout logged', {
          description: `${plural(done, 'exercise')} completed.`,
        });
        close(false);
      },
      onError: (error) => setProblem(errorMessage(error)),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Log a workout"
      description={
        mode === 'staff'
          ? `Record a session of ${planName} for the member.`
          : `Record what you did from ${planName}. Untick anything you skipped.`
      }
      size="lg"
      busy={log.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={log.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={log.isPending}>
            Save workout
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormProblem message={problem} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {days.length > 1 && (
            <FormField label="Which day did you train?">
              <Select value={String(day)} onChange={(event) => setDay(Number(event.target.value))}>
                {days.map((d) => (
                  <option key={d.day} value={d.day}>
                    {dayLabel(d.day)} · {plural(d.items.length, 'exercise')}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label="Date">
            <Input
              type="date"
              max={today}
              value={performedOn}
              onChange={(event) => setPerformedOn(event.target.value)}
            />
          </FormField>
        </div>

        <ul aria-label={`${dayLabel(day)} exercises`} className="flex flex-col gap-3">
          {dayItems.map((item) => {
            const row = rowOf(item);
            return (
              <li
                key={item.id}
                className={cn(
                  'rounded-md border border-border p-3 transition-colors duration-150',
                  !row.completed && 'bg-surface-muted/60',
                )}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={row.completed}
                    onChange={(event) => update(item, { completed: event.target.checked })}
                    className="size-4 shrink-0 cursor-pointer accent-primary"
                  />
                  <ExerciseThumb exercise={item.exercise} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm font-medium text-fg',
                        !row.completed && 'text-fg-muted line-through',
                      )}
                    >
                      {item.exercise.name}
                    </span>
                    <span className="block text-13 text-fg-muted">
                      Planned {formatPrescription(item)}
                      {item.loadNote && ` @ ${item.loadNote}`}
                    </span>
                  </span>
                </label>
                {row.completed && (
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:ml-7 sm:grid-cols-4">
                    <SmallInput
                      label={`Sets`}
                      value={row.sets}
                      onChange={(sets) => update(item, { sets })}
                      disabled={log.isPending}
                    />
                    <SmallInput
                      label="Reps"
                      value={row.reps}
                      onChange={(reps) => update(item, { reps })}
                      disabled={log.isPending}
                    />
                    <SmallInput
                      label="Time (s)"
                      value={row.duration}
                      onChange={(duration) => update(item, { duration })}
                      disabled={log.isPending}
                    />
                    <SmallInput
                      label="Load"
                      value={row.load}
                      numeric={false}
                      onChange={(load) => update(item, { load })}
                      disabled={log.isPending}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <FormField
          label="Anything else?"
          optional
          hint="Extra work that is not in the plan, or how the session felt."
        >
          <Textarea
            rows={2}
            maxLength={WORKOUT_LIMITS.notesMax}
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
            placeholder="e.g. 10 minutes on the rower to cool down"
          />
        </FormField>
      </div>
    </Dialog>
  );
}
