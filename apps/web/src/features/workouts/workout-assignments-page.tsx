import {
  WORKOUT_ASSIGNMENT_STATUS_LABELS,
  WORKOUT_ASSIGNMENT_STATUSES,
  type WorkoutAssignmentDto,
  type WorkoutAssignmentListQuery,
} from '@gms/shared';
import { ChevronRight, ClipboardCheck, UserRoundPlus } from 'lucide-react';
import { useCallback, useState } from 'react';
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
import { formatDate, formatRelative } from '../../lib/format';
import { useUrlFilters } from '../billing/use-url-filters';
import { MemberAvatar } from '../members/member-avatar';
import { AssignWorkoutDialog } from './assign-workout-dialog';
import { ASSIGNMENT_TONES, plural } from './workout-format';
import { useWorkoutAssignments } from './workouts-api';

const PAGE_SIZE = 20;

export function AssignmentRow({ assignment }: { assignment: WorkoutAssignmentDto }) {
  return (
    <li>
      <Link
        to={`/workout-assignments/${assignment.id}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center"
      >
        <div className="flex min-w-0 items-center gap-3">
          <MemberAvatar member={assignment.member} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">{fullName(assignment.member)}</p>
            <p className="font-mono text-xs text-fg-muted">{assignment.member.memberCode}</p>
          </div>
        </div>
        <ChevronRight
          className="size-4 self-center text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5 lg:order-4"
          aria-hidden
        />
        <div className="col-span-2 min-w-0 lg:order-2 lg:col-span-1">
          <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
            <span className="truncate">{assignment.plan.name}</span>
            <Badge tone={ASSIGNMENT_TONES[assignment.status]} dot>
              {WORKOUT_ASSIGNMENT_STATUS_LABELS[assignment.status]}
            </Badge>
          </p>
          <p className="text-13 text-fg-muted">
            {assignment.trainer ? `With ${fullName(assignment.trainer)}` : 'No trainer'} · from{' '}
            {formatDate(assignment.startDate)}
            {assignment.endDate && ` to ${formatDate(assignment.endDate)}`}
          </p>
        </div>
        <p className="col-span-2 text-13 text-fg-secondary lg:order-3 lg:col-span-1">
          {assignment.daysLogged === 0 ? (
            <span className="text-fg-muted">Nothing logged yet</span>
          ) : (
            <>
              {plural(assignment.daysLogged, 'day')} logged
              <span className="block text-fg-muted">
                Last {formatRelative(assignment.lastLoggedOn).toLowerCase()}
              </span>
            </>
          )}
        </p>
      </Link>
    </li>
  );
}

export function WorkoutAssignmentsPage() {
  const can = useCan();
  const canAssign = can('workouts:assign');
  const { text, oneOf, page, update } = useUrlFilters();
  const [assigning, setAssigning] = useState(false);
  const status =
    text('status') === 'all'
      ? undefined
      : (oneOf('status', WORKOUT_ASSIGNMENT_STATUSES) ?? 'ACTIVE');
  const query: WorkoutAssignmentListQuery = { page, pageSize: PAGE_SIZE, q: text('q'), status };
  const list = useWorkoutAssignments(query);
  const filtered = Boolean(query.q || status !== 'ACTIVE');
  const setSearch = useCallback((q: string) => update({ q }), [update]);

  return (
    <>
      <PageHeader
        title="Assigned workouts"
        description="Who is following which plan, and how often they log their sessions. Open one to add notes, log a workout or record progress."
        actions={
          canAssign && (
            <Button icon={<UserRoundPlus aria-hidden />} onClick={() => setAssigning(true)}>
              Assign a plan
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:px-5">
          <div className="sm:max-w-xs sm:flex-1">
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search assigned workouts"
              placeholder="Search member, code or plan"
            />
          </div>
          <Select
            aria-label="Show"
            value={status ?? 'all'}
            onChange={(event) =>
              update({ status: event.target.value === 'ACTIVE' ? null : event.target.value })
            }
            className="sm:ml-auto sm:w-48"
          >
            {WORKOUT_ASSIGNMENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {WORKOUT_ASSIGNMENT_STATUS_LABELS[value]}
              </option>
            ))}
            <option value="all">All statuses</option>
          </Select>
        </div>

        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid"
        >
          <span>Member</span>
          <span>Plan</span>
          <span>Logged</span>
          <span className="w-4" />
        </div>

        {list.isPending ? (
          <ListSkeleton rows={5} label="Loading assigned workouts" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<ClipboardCheck aria-hidden />}
              title="Nothing matches these filters"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ q: null, status: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ClipboardCheck aria-hidden />}
              title="No active workouts"
              description="Assign a plan to a member and it shows up here and in their portal."
              action={
                canAssign && (
                  <Button
                    size="sm"
                    icon={<UserRoundPlus aria-hidden />}
                    onClick={() => setAssigning(true)}
                  >
                    Assign a plan
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ul
              aria-label="Assigned workouts"
              aria-busy={list.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              {list.data.data.map((assignment) => (
                <AssignmentRow key={assignment.id} assignment={assignment} />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="workouts"
              onPageChange={(next) => update({ page: next > 1 ? String(next) : null }, false)}
            />
          </>
        )}
      </Card>
      {canAssign && <AssignWorkoutDialog open={assigning} onOpenChange={setAssigning} />}
    </>
  );
}
