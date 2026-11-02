import { WORKOUT_ASSIGNMENT_STATUS_LABELS, type MemberDto } from '@gms/shared';
import { ChevronRight, ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan } from '../../lib/auth';
import { formatDate } from '../../lib/format';
import { AssignWorkoutDialog } from './assign-workout-dialog';
import { MemberProgress } from './progress';
import { ASSIGNMENT_TONES, plural } from './workout-format';
import { useWorkoutAssignments } from './workouts-api';

/** Workout plans and progress on the member page. */
export function MemberWorkoutsTab({ member }: { member: MemberDto }) {
  const can = useCan();
  const [assigning, setAssigning] = useState(false);
  const assignments = useWorkoutAssignments({ memberId: member.id, pageSize: 20 });
  const canAssign = can('workouts:assign') && !member.archivedAt;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          id="member-workouts-heading"
          title="Workout plans"
          description="Plans assigned to this member, open ones first"
          action={
            canAssign && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus aria-hidden />}
                onClick={() => setAssigning(true)}
              >
                Assign a plan
              </Button>
            )
          }
        />
        {assignments.isPending ? (
          <ListSkeleton rows={2} label="Loading workout plans" />
        ) : assignments.isError ? (
          <ErrorState error={assignments.error} onRetry={() => assignments.refetch()} />
        ) : assignments.data.data.length === 0 ? (
          <EmptyState
            icon={<ClipboardList aria-hidden />}
            title="No workout plan yet"
            description="Assign a plan and the member sees it, day by day, in their portal."
          />
        ) : (
          <ul aria-labelledby="member-workouts-heading" className="divide-y divide-border">
            {[...assignments.data.data]
              .sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'))
              .map((assignment) => (
                <li key={assignment.id}>
                  <Link
                    to={`/workout-assignments/${assignment.id}`}
                    className="group flex items-center gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-fg">
                          {assignment.plan.name}
                        </span>
                        <Badge tone={ASSIGNMENT_TONES[assignment.status]} dot>
                          {WORKOUT_ASSIGNMENT_STATUS_LABELS[assignment.status]}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-13 text-fg-muted">
                        {assignment.trainer ? fullName(assignment.trainer) : 'No trainer'} · from{' '}
                        {formatDate(assignment.startDate)} · {plural(assignment.daysLogged, 'day')}{' '}
                        logged
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {can('progress:read') && (
        <MemberProgress
          memberId={member.id}
          canRecord={can('progress:record') && !member.archivedAt}
        />
      )}

      {canAssign && (
        <AssignWorkoutDialog member={member} open={assigning} onOpenChange={setAssigning} />
      )}
    </div>
  );
}
