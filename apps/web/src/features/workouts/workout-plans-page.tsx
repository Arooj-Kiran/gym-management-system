import {
  DIFFICULTY_LEVEL_LABELS,
  DIFFICULTY_LEVELS,
  WORKOUT_PLAN_STATUSES,
  type WorkoutPlanDto,
  type WorkoutPlanListQuery,
} from '@gms/shared';
import { ChevronRight, ClipboardList, Plus } from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { useUrlFilters } from '../billing/use-url-filters';
import { WorkoutPlanFormDialog } from './workout-plan-form-dialog';
import { DIFFICULTY_TONES, plural } from './workout-format';
import { useWorkoutPlanList } from './workouts-api';

const PAGE_SIZE = 20;
const KINDS = ['templates', 'plans'] as const;

function PlanRow({ plan }: { plan: WorkoutPlanDto }) {
  const archived = plan.status === 'ARCHIVED';
  return (
    <li className={cn(archived && 'bg-surface-muted/40')}>
      <Link
        to={`/workout-plans/${plan.id}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-4 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center"
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            <span className="truncate">{plan.name}</span>
            <Badge tone={DIFFICULTY_TONES[plan.difficulty]}>
              {DIFFICULTY_LEVEL_LABELS[plan.difficulty]}
            </Badge>
            {plan.isTemplate && <Badge>Template</Badge>}
            {archived && <Badge tone="danger">Archived</Badge>}
          </p>
          {plan.goal && <p className="mt-0.5 truncate text-13 text-fg-muted">{plan.goal}</p>}
        </div>
        <ChevronRight
          className="size-4 self-center text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5 lg:order-4"
          aria-hidden
        />
        <p className="col-span-2 text-13 text-fg-secondary lg:order-2 lg:col-span-1">
          {plan.itemCount === 0 ? (
            <span className="text-warning-text">No exercises yet</span>
          ) : (
            <>
              {plural(plan.itemCount, 'exercise')}
              <span className="text-fg-muted"> · {plural(plan.dayCount, 'day')}</span>
            </>
          )}
        </p>
        <p className="col-span-2 text-13 text-fg-secondary lg:order-3 lg:col-span-1">
          {plan.owner ? fullName(plan.owner) : 'Gym plan'}
          <span className="block text-fg-muted">
            {plan.activeAssignments > 0
              ? `${plural(plan.activeAssignments, 'member')} following`
              : 'Not assigned'}
          </span>
        </p>
      </Link>
    </li>
  );
}

export function WorkoutPlansPage() {
  const can = useCan();
  const canManage = can('workouts:manage');
  const { text, oneOf, page, update } = useUrlFilters();
  const kind = oneOf('kind', KINDS);
  const status =
    text('status') === 'all' ? undefined : (oneOf('status', WORKOUT_PLAN_STATUSES) ?? 'ACTIVE');
  const query: WorkoutPlanListQuery = {
    page,
    pageSize: PAGE_SIZE,
    q: text('q'),
    difficulty: oneOf('difficulty', DIFFICULTY_LEVELS),
    status,
    isTemplate: kind ? (kind === 'templates' ? 'true' : 'false') : undefined,
  };
  const creating = text('new') === '1';
  const list = useWorkoutPlanList(query);
  const filtered = Boolean(query.q || query.difficulty || kind || status !== 'ACTIVE');

  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const openCreate = (open: boolean) => update({ new: open ? '1' : null }, false);

  return (
    <>
      <PageHeader
        title="Workout plans"
        description="Training plans built from the exercise library, laid out by day. Open a plan to edit its exercises or assign it to a member."
        actions={
          canManage && (
            <Button icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
              New plan
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
              label="Search workout plans"
              placeholder="Search plan name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:ml-auto lg:flex">
            <Select
              aria-label="Filter by level"
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
              aria-label="Filter by kind"
              value={kind ?? ''}
              onChange={(event) => update({ kind: event.target.value })}
              className="lg:w-40"
            >
              <option value="">Plans and templates</option>
              <option value="plans">Plans only</option>
              <option value="templates">Templates only</option>
            </Select>
            <Select
              aria-label="Show"
              value={status ?? 'all'}
              onChange={(event) =>
                update({ status: event.target.value === 'ACTIVE' ? null : event.target.value })
              }
              className="col-span-2 sm:col-span-1 lg:w-44"
            >
              <option value="ACTIVE">Active plans</option>
              <option value="ARCHIVED">Archived</option>
              <option value="all">Active and archived</option>
            </Select>
          </div>
        </div>

        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid"
        >
          <span>Plan</span>
          <span>Content</span>
          <span>Trainer</span>
          <span className="w-4" />
        </div>

        {list.isPending ? (
          <ListSkeleton rows={5} label="Loading workout plans" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<ClipboardList aria-hidden />}
              title="No plans match these filters"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ q: null, difficulty: null, kind: null, status: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ClipboardList aria-hidden />}
              title="No workout plans yet"
              description={
                canManage
                  ? 'Build a plan from the exercise library, then assign it to a member.'
                  : 'Trainers, Managers and Admins build workout plans here.'
              }
              action={
                canManage && (
                  <Button size="sm" icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
                    New plan
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ul
              aria-label="Workout plans"
              aria-busy={list.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              {list.data.data.map((plan) => (
                <PlanRow key={plan.id} plan={plan} />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="plans"
              onPageChange={(next) => update({ page: next > 1 ? String(next) : null }, false)}
            />
          </>
        )}
      </Card>

      {canManage && <WorkoutPlanFormDialog open={creating} onOpenChange={openCreate} />}
    </>
  );
}
