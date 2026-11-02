import {
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  type ExerciseDto,
  type MuscleGroup,
} from '@gms/shared';
import { Check, Plus, SearchX } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Select } from '../../components/ui/form-field';
import { SearchInput } from '../../components/ui/search-input';
import { ListSkeleton } from '../../components/ui/states';
import { ExerciseThumb } from './exercise-thumb';
import { useExerciseList } from './workouts-api';

/** Search the library and add exercises to one day; stays open so several can be added. */
export function ExercisePickerDialog({
  open,
  onOpenChange,
  title,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onPick: (exercise: ExerciseDto) => void;
  /** E.g. the plan is full. */
  disabled?: string;
}) {
  const [q, setQ] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | ''>('');
  const [added, setAdded] = useState<Record<string, number>>({});
  const list = useExerciseList(
    { q: q || undefined, muscleGroup: muscle || undefined, pageSize: 50 },
    open,
  );

  const close = (next: boolean) => {
    if (!next) setAdded({});
    onOpenChange(next);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      description="Add as many as you need. Set the sets, reps and rest for each one afterwards."
      size="lg"
      footer={<Button onClick={() => close(false)}>Done</Button>}
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <SearchInput
            value={q}
            onChange={setQ}
            label="Search the exercise library"
            placeholder="Search exercise name"
          />
          <Select
            aria-label="Muscle group"
            value={muscle}
            onChange={(event) => setMuscle(event.target.value as MuscleGroup | '')}
          >
            <option value="">All muscle groups</option>
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {MUSCLE_GROUP_LABELS[group]}
              </option>
            ))}
          </Select>
        </div>
        {disabled && (
          <p role="status" className="text-13 text-warning-text">
            {disabled}
          </p>
        )}
        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
          {list.isPending ? (
            <ListSkeleton rows={4} label="Loading exercises" />
          ) : list.isError ? (
            <p role="alert" className="px-3 py-4 text-13 text-danger-text">
              {errorMessage(list.error)}
            </p>
          ) : list.data.data.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-4 text-13 text-fg-muted">
              <SearchX className="size-4" aria-hidden />
              {q || muscle
                ? 'No exercises match. Try another name or muscle group.'
                : 'The exercise library is empty. Add exercises to the library first.'}
            </p>
          ) : (
            <ul aria-label="Exercise library" className="divide-y divide-border">
              {list.data.data.map((exercise) => {
                const count = added[exercise.id] ?? 0;
                return (
                  <li key={exercise.id} className="flex items-center gap-3 px-3 py-2.5">
                    <ExerciseThumb exercise={exercise} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {exercise.name}
                      </span>
                      <span className="block truncate text-13 text-fg-muted">
                        {MUSCLE_GROUP_LABELS[exercise.muscleGroup]}
                        {exercise.equipmentNeeded && ` · ${exercise.equipmentNeeded}`}
                      </span>
                    </span>
                    <Button
                      variant={count > 0 ? 'ghost' : 'secondary'}
                      size="sm"
                      disabled={Boolean(disabled)}
                      icon={count > 0 ? <Check aria-hidden /> : <Plus aria-hidden />}
                      onClick={() => {
                        onPick(exercise);
                        setAdded((current) => ({ ...current, [exercise.id]: count + 1 }));
                      }}
                    >
                      {count > 0 ? `Added${count > 1 ? ` ×${count}` : ''}` : 'Add'}
                      <span className="sr-only"> {exercise.name}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
