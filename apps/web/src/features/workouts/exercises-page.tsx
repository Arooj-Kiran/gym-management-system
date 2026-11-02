import {
  DIFFICULTY_LEVEL_LABELS,
  DIFFICULTY_LEVELS,
  MUSCLE_GROUP_LABELS,
  MUSCLE_GROUPS,
  type ExerciseDto,
  type ExerciseListQuery,
} from '@gms/shared';
import { Archive, Dumbbell, Pencil, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { useCan } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { useUrlFilters } from '../billing/use-url-filters';
import { ExerciseFormDialog } from './exercise-form-dialog';
import { ExerciseThumb } from './exercise-thumb';
import { DIFFICULTY_TONES } from './workout-format';
import { useArchiveExercise, useExerciseList } from './workouts-api';

const PAGE_SIZE = 24;

function ExerciseRow({
  exercise,
  canManage,
  onEdit,
  onArchive,
}: {
  exercise: ExerciseDto;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <li
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-4 sm:px-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center',
        !exercise.isActive && 'bg-surface-muted/40',
      )}
    >
      <ExerciseThumb exercise={exercise} size="md" />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
          <span className="truncate">{exercise.name}</span>
          <Badge tone={DIFFICULTY_TONES[exercise.difficulty]}>
            {DIFFICULTY_LEVEL_LABELS[exercise.difficulty]}
          </Badge>
          {!exercise.isActive && <Badge tone="danger">Archived</Badge>}
        </p>
        <p className="mt-0.5 text-13 text-fg-secondary">
          {MUSCLE_GROUP_LABELS[exercise.muscleGroup]}
          {exercise.equipmentNeeded && (
            <span className="text-fg-muted"> · {exercise.equipmentNeeded}</span>
          )}
        </p>
        {exercise.description && (
          <p className="mt-0.5 line-clamp-2 text-13 text-fg-muted">{exercise.description}</p>
        )}
      </div>
      {canManage && exercise.isActive && (
        <div className="col-span-2 flex gap-2 md:col-span-1 md:justify-end">
          <Button variant="secondary" size="sm" icon={<Pencil aria-hidden />} onClick={onEdit}>
            Edit<span className="sr-only"> {exercise.name}</span>
          </Button>
          <Button variant="ghost" size="sm" icon={<Archive aria-hidden />} onClick={onArchive}>
            Archive<span className="sr-only"> {exercise.name}</span>
          </Button>
        </div>
      )}
    </li>
  );
}

export function ExercisesPage() {
  const can = useCan();
  const canManage = can('exercises:manage');
  const { text, oneOf, page, update } = useUrlFilters();
  const query: ExerciseListQuery = {
    page,
    pageSize: PAGE_SIZE,
    q: text('q'),
    muscleGroup: oneOf('muscle', MUSCLE_GROUPS),
    difficulty: oneOf('difficulty', DIFFICULTY_LEVELS),
    includeArchived: text('archived') === '1' ? 'true' : undefined,
  };
  const creating = text('new') === '1';
  const list = useExerciseList(query);
  const archive = useArchiveExercise();
  const [editing, setEditing] = useState<ExerciseDto | null>(null);
  const [archiving, setArchiving] = useState<ExerciseDto | null>(null);
  const filtered = Boolean(query.q || query.muscleGroup || query.difficulty);

  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const openCreate = (open: boolean) => update({ new: open ? '1' : null }, false);

  const confirmArchive = () => {
    if (!archiving) return;
    archive.mutate(archiving.id, {
      onSuccess: (exercise) => {
        toast.success(`${exercise.name} archived`);
        setArchiving(null);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return (
    <>
      <PageHeader
        title="Exercise library"
        description="The exercises trainers build plans from, with pictures and instructions members can follow."
        actions={
          canManage && (
            <Button icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
              New exercise
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5 lg:flex-row lg:items-center">
          <div className="lg:max-w-xs lg:flex-1">
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search exercises"
              placeholder="Search exercise name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:ml-auto lg:flex">
            <Select
              aria-label="Filter by muscle group"
              value={query.muscleGroup ?? ''}
              onChange={(event) => update({ muscle: event.target.value })}
              className="lg:w-44"
            >
              <option value="">All muscle groups</option>
              {MUSCLE_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {MUSCLE_GROUP_LABELS[group]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by difficulty"
              value={query.difficulty ?? ''}
              onChange={(event) => update({ difficulty: event.target.value })}
              className="lg:w-40"
            >
              <option value="">All levels</option>
              {DIFFICULTY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {DIFFICULTY_LEVEL_LABELS[level]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Show"
              value={query.includeArchived ? 'all' : 'active'}
              onChange={(event) => update({ archived: event.target.value === 'all' ? '1' : null })}
              className="col-span-2 sm:col-span-1 lg:w-48"
            >
              <option value="active">In use</option>
              <option value="all">Include archived</option>
            </Select>
          </div>
        </div>

        {list.isPending ? (
          <ListSkeleton rows={6} label="Loading exercises" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Dumbbell aria-hidden />}
              title="No exercises match these filters"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ q: null, muscle: null, difficulty: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Dumbbell aria-hidden />}
              title="The library is empty"
              description={
                canManage
                  ? 'Add the exercises your trainers use, with a picture and clear instructions.'
                  : 'A trainer, Manager or Admin adds exercises here.'
              }
              action={
                canManage && (
                  <Button size="sm" icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
                    New exercise
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ul
              aria-label="Exercises"
              aria-busy={list.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              {list.data.data.map((exercise) => (
                <ExerciseRow
                  key={exercise.id}
                  exercise={exercise}
                  canManage={canManage}
                  onEdit={() => setEditing(exercise)}
                  onArchive={() => setArchiving(exercise)}
                />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="exercises"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>

      {canManage && (
        <>
          <ExerciseFormDialog open={creating} onOpenChange={openCreate} />
          {editing && (
            <ExerciseFormDialog
              key={editing.id}
              exercise={editing}
              open
              onOpenChange={(open) => !open && setEditing(null)}
            />
          )}
          <ConfirmDialog
            open={archiving !== null}
            onOpenChange={(open) => !open && setArchiving(null)}
            title={`Archive ${archiving?.name ?? 'exercise'}?`}
            description="It can no longer be added to plans. Plans that already use it keep it, and its history stays."
            confirmLabel="Archive exercise"
            tone="danger"
            loading={archive.isPending}
            onConfirm={confirmArchive}
          />
        </>
      )}
    </>
  );
}
