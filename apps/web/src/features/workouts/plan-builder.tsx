import {
  MUSCLE_GROUP_LABELS,
  setWorkoutPlanItemsSchema,
  WORKOUT_LIMITS,
  type ExerciseDto,
  type WorkoutPlanDetailDto,
  type WorkoutPlanItemDto,
} from '@gms/shared';
import { ArrowDown, ArrowUp, CalendarPlus, Plus, Trash2, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button, IconButton } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input, Select } from '../../components/ui/form-field';
import { cn } from '../../lib/cn';
import { FormProblem } from '../scheduling/form-parts';
import { ExercisePickerDialog } from './exercise-picker-dialog';
import { ExerciseThumb } from './exercise-thumb';
import { dayLabel, plural } from './workout-format';
import {
  errorsFromPaths,
  newKey,
  orderDrafts,
  splitPath,
  toDraft,
  toPayload,
  type DraftErrors,
  type DraftItem,
} from './plan-draft';
import { useSetWorkoutPlanItems } from './workouts-api';

const MAX_DAYS = 7;
function NumberField({
  label,
  value,
  onChange,
  error,
  suffix,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  suffix?: string;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label}
        {suffix && <span className="font-normal text-fg-muted"> ({suffix})</span>}
      </label>
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ''))}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-9 tabular-nums"
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  maxLength,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  maxLength: number;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-fg-secondary">
        {label} <span className="font-normal text-fg-muted">(optional)</span>
      </label>
      <Input
        id={id}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-9"
      />
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}

function DraftRow({
  draft,
  position,
  dayCount,
  isFirst,
  isLast,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  draft: DraftItem;
  position: number;
  dayCount: number;
  isFirst: boolean;
  isLast: boolean;
  errors?: DraftErrors[string];
  onChange: (changes: Partial<DraftItem>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const name = draft.exercise.name;
  const dayId = useId();
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="mt-2 w-5 shrink-0 text-right text-13 font-medium text-fg-muted tabular-nums">
          {position}
        </span>
        <ExerciseThumb exercise={draft.exercise} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            <span className="truncate">{name}</span>
            {!draft.exercise.isActive && <Badge tone="warning">Archived exercise</Badge>}
          </p>
          <p className="text-13 text-fg-muted">{MUSCLE_GROUP_LABELS[draft.exercise.muscleGroup]}</p>
          {errors?.exercise && <p className="mt-0.5 text-xs text-danger-text">{errors.exercise}</p>}
        </div>
        <div className="flex shrink-0 items-center" role="group" aria-label={`Arrange ${name}`}>
          <IconButton
            label={`Move ${name} up`}
            disabled={isFirst}
            onClick={() => onMove(-1)}
            className="disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp aria-hidden />
          </IconButton>
          <IconButton
            label={`Move ${name} down`}
            disabled={isLast}
            onClick={() => onMove(1)}
            className="disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowDown aria-hidden />
          </IconButton>
          <IconButton
            label={`Remove ${name}`}
            onClick={onRemove}
            className="hover:bg-danger-subtle hover:text-danger-text"
          >
            <X aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:ml-8 sm:grid-cols-4 lg:grid-cols-[repeat(4,minmax(0,6rem))_minmax(0,1fr)]">
        <NumberField
          label="Sets"
          value={draft.sets}
          onChange={(sets) => onChange({ sets })}
          error={errors?.sets}
        />
        <NumberField
          label="Reps"
          value={draft.reps}
          onChange={(reps) => onChange({ reps })}
          error={errors?.reps}
          placeholder="—"
        />
        <NumberField
          label="Time"
          suffix="s"
          value={draft.durationSeconds}
          onChange={(durationSeconds) => onChange({ durationSeconds })}
          error={errors?.durationSeconds}
          placeholder="—"
        />
        <NumberField
          label="Rest"
          suffix="s"
          value={draft.restSeconds}
          onChange={(restSeconds) => onChange({ restSeconds })}
          error={errors?.restSeconds}
        />
        <TextField
          label="Load"
          value={draft.loadNote}
          onChange={(loadNote) => onChange({ loadNote })}
          error={errors?.loadNote}
          maxLength={WORKOUT_LIMITS.loadNoteMax}
          placeholder="e.g. 20 kg, bodyweight"
          className="col-span-2 sm:col-span-4 lg:col-span-1"
        />
        <TextField
          label="Coaching note"
          value={draft.notes}
          onChange={(notes) => onChange({ notes })}
          error={errors?.notes}
          maxLength={WORKOUT_LIMITS.notesMax}
          placeholder="e.g. Pause for one second at the bottom"
          className="col-span-2 sm:col-span-3 lg:col-span-4"
        />
        {dayCount > 1 && (
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <label htmlFor={dayId} className="text-xs font-medium text-fg-secondary">
              Day
            </label>
            <Select
              id={dayId}
              value={String(draft.dayNumber)}
              onChange={(event) => onChange({ dayNumber: Number(event.target.value) })}
              className="[&_select]:h-9"
            >
              {Array.from({ length: dayCount }, (_, index) => (
                <option key={index + 1} value={index + 1}>
                  {dayLabel(index + 1)}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
    </li>
  );
}

/** Edit a plan's exercises, day by day, and save them all at once. */
export function PlanBuilder({ plan, onDone }: { plan: WorkoutPlanDetailDto; onDone: () => void }) {
  const initial = useMemo(() => orderDraftsFromPlan(plan.items), [plan.items]);
  const [drafts, setDrafts] = useState<DraftItem[]>(initial);
  const [dayCount, setDayCount] = useState(() =>
    Math.max(1, ...plan.items.map((item) => item.dayNumber)),
  );
  const [errors, setErrors] = useState<DraftErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [pickingDay, setPickingDay] = useState<number | null>(null);
  const save = useSetWorkoutPlanItems();

  const payload = toPayload(drafts);
  const dirty =
    JSON.stringify(payload) !== JSON.stringify(toPayload(initial)) ||
    dayCount !== Math.max(1, ...plan.items.map((item) => item.dayNumber));
  const full = drafts.length >= WORKOUT_LIMITS.itemsMax;

  const change = (key: string, changes: Partial<DraftItem>) => {
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...changes } : d)));
    if (errors[key]) setErrors(({ [key]: _cleared, ...rest }) => rest);
  };

  const move = (key: string, direction: -1 | 1) =>
    setDrafts((current) => {
      const ordered = orderDrafts(current);
      const index = ordered.findIndex((d) => d.key === key);
      const target = ordered[index + direction];
      const draft = ordered[index];
      if (!draft || !target || target.dayNumber !== draft.dayNumber) return current;
      ordered[index] = target;
      ordered[index + direction] = draft;
      return ordered;
    });

  const remove = (key: string) => setDrafts((current) => current.filter((d) => d.key !== key));

  const add = (day: number, exercise: ExerciseDto) =>
    setDrafts((current) =>
      current.length >= WORKOUT_LIMITS.itemsMax
        ? current
        : [
            ...current,
            {
              key: newKey(),
              exercise,
              dayNumber: day,
              sets: '3',
              reps: '10',
              durationSeconds: '',
              restSeconds: '60',
              loadNote: '',
              notes: '',
            },
          ],
    );

  const removeDay = (day: number) => {
    setDrafts((current) =>
      current
        .filter((d) => d.dayNumber !== day)
        .map((d) => (d.dayNumber > day ? { ...d, dayNumber: d.dayNumber - 1 } : d)),
    );
    setDayCount((count) => Math.max(1, count - 1));
  };

  const submit = () => {
    setProblem(null);
    const ordered = orderDrafts(drafts);
    const parsed = setWorkoutPlanItemsSchema.safeParse({ items: payload });
    if (!parsed.success) {
      const mapped = errorsFromPaths(
        ordered,
        parsed.error.issues.map((issue) => ({
          path: issue.path as (string | number)[],
          message: issue.message,
        })),
      );
      setErrors(mapped.errors);
      setProblem(mapped.general ?? 'Some exercises need fixing. Check the highlighted fields.');
      return;
    }
    save.mutate(
      { id: plan.id, input: { items: payload } },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} saved`, {
            description:
              saved.itemCount === 0
                ? 'The plan has no exercises yet.'
                : `${plural(saved.itemCount, 'exercise')} over ${plural(saved.dayCount, 'day')}.`,
          });
          onDone();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.details.length > 0) {
            const mapped = errorsFromPaths(
              ordered,
              error.details.map((detail) => ({
                path: splitPath(detail.path),
                message: detail.message,
              })),
            );
            setErrors(mapped.errors);
            setProblem(mapped.general ?? error.message);
            return;
          }
          setProblem(errorMessage(error));
        },
      },
    );
  };

  const ordered = orderDrafts(drafts);
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);

  return (
    <section aria-label="Plan builder" className="flex flex-col gap-4">
      <FormProblem message={problem} />
      {days.map((day) => {
        const dayItems = ordered.filter((d) => d.dayNumber === day);
        return (
          <Card key={day}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-fg">
                {dayLabel(day)}
                <span className="ml-2 text-13 font-normal text-fg-muted">
                  {dayItems.length === 0
                    ? 'Rest day or empty'
                    : plural(dayItems.length, 'exercise')}
                </span>
              </h3>
              <div className="flex gap-2">
                {dayCount > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 aria-hidden />}
                    onClick={() => removeDay(day)}
                  >
                    Remove day<span className="sr-only"> {day}</span>
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus aria-hidden />}
                  disabled={full}
                  onClick={() => setPickingDay(day)}
                >
                  Add exercise<span className="sr-only"> to {dayLabel(day)}</span>
                </Button>
              </div>
            </div>
            {dayItems.length === 0 ? (
              <p className="px-4 py-6 text-center text-13 text-fg-muted sm:px-5">
                No exercises on this day. Days with no exercises are left out when you save.
              </p>
            ) : (
              <ol aria-label={`${dayLabel(day)} exercises`} className="divide-y divide-border">
                {dayItems.map((draft, index) => (
                  <DraftRow
                    key={draft.key}
                    draft={draft}
                    position={index + 1}
                    dayCount={dayCount}
                    isFirst={index === 0}
                    isLast={index === dayItems.length - 1}
                    errors={errors[draft.key]}
                    onChange={(changes) => change(draft.key, changes)}
                    onMove={(direction) => move(draft.key, direction)}
                    onRemove={() => remove(draft.key)}
                  />
                ))}
              </ol>
            )}
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          icon={<CalendarPlus aria-hidden />}
          disabled={dayCount >= MAX_DAYS}
          onClick={() => setDayCount((count) => Math.min(MAX_DAYS, count + 1))}
        >
          Add day
        </Button>
        <p className="text-13 text-fg-muted tabular-nums" aria-live="polite">
          {drafts.length} of {WORKOUT_LIMITS.itemsMax} exercises · {plural(dayCount, 'day')} of{' '}
          {MAX_DAYS}
        </p>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-lg sm:border sm:bg-surface/95 sm:px-5 sm:shadow-sm">
        <p className="mr-auto text-13 text-fg-secondary">
          {dirty ? 'You have unsaved changes.' : 'No changes yet.'}
        </p>
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          {dirty ? 'Discard' : 'Close'}
        </Button>
        <Button onClick={submit} loading={save.isPending} disabled={!dirty}>
          Save exercises
        </Button>
      </div>

      <ExercisePickerDialog
        open={pickingDay !== null}
        onOpenChange={(open) => !open && setPickingDay(null)}
        title={pickingDay ? `Add exercises to ${dayLabel(pickingDay)}` : 'Add exercises'}
        disabled={
          full ? `The plan holds the maximum of ${WORKOUT_LIMITS.itemsMax} exercises.` : undefined
        }
        onPick={(exercise) => pickingDay && add(pickingDay, exercise)}
      />
    </section>
  );
}

function orderDraftsFromPlan(items: WorkoutPlanItemDto[]) {
  return [...items]
    .sort((a, b) => a.dayNumber - b.dayNumber || a.position - b.position)
    .map(toDraft);
}
