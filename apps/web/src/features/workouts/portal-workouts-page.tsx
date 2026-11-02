import {
  DIFFICULTY_LEVEL_LABELS,
  WORKOUT_ASSIGNMENT_STATUS_LABELS,
  type MyWorkoutDto,
} from '@gms/shared';
import { ClipboardList, LineChart, NotebookPen } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button, ButtonLink } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { formatDate, gymTodayIso } from '../../lib/format';
import { LogHistory } from './log-history';
import { LogWorkoutDialog } from './log-workout-dialog';
import { PlanDays } from './plan-days';
import { MyProgress } from './progress';
import { ASSIGNMENT_TONES, DIFFICULTY_TONES, plural } from './workout-format';
import { useMyWorkoutLogs, useMyWorkouts } from './workouts-api';

function ActiveWorkout({ workout, onLog }: { workout: MyWorkoutDto; onLog: () => void }) {
  const today = gymTodayIso();
  const notStarted = workout.startDate > today;
  const headingId = `workout-${workout.assignmentId}`;
  const { plan } = workout;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={headingId} className="text-lg font-semibold tracking-tight text-fg">
                {plan.name}
              </h2>
              <Badge tone={DIFFICULTY_TONES[plan.difficulty]}>
                {DIFFICULTY_LEVEL_LABELS[plan.difficulty]}
              </Badge>
            </div>
            <p className="mt-1 text-13 text-fg-secondary">
              {workout.trainer ? `From ${fullName(workout.trainer)}` : 'Assigned by the gym'}
              {' · '}
              {notStarted ? 'starts' : 'since'} {formatDate(workout.startDate)}
              {workout.endDate && ` · until ${formatDate(workout.endDate)}`}
            </p>
            <p className="mt-1 text-13 text-fg-muted tabular-nums">
              {workout.daysLogged > 0
                ? `${plural(workout.daysLogged, 'day')} logged · last on ${formatDate(workout.lastLoggedOn)}`
                : 'No sessions logged yet'}
            </p>
          </div>
          {plan.items.length > 0 && (
            <Button
              icon={<NotebookPen aria-hidden />}
              onClick={onLog}
              disabled={notStarted}
              className="shrink-0 self-start"
              // Names the plan for screen readers; starts with the visible text (WCAG 2.5.3).
              aria-label={`Log a workout: ${plan.name}`}
            >
              Log a workout
            </Button>
          )}
        </div>
        {workout.trainerNotes && (
          <div className="mt-4 rounded-md border-l-2 border-primary bg-primary-subtle/50 px-4 py-3">
            <p className="text-xs font-medium text-primary-text">Notes from your trainer</p>
            <p className="mt-1 text-sm whitespace-pre-line text-fg">{workout.trainerNotes}</p>
          </div>
        )}
        {plan.description && (
          <p className="mt-4 max-w-prose text-sm text-fg-secondary">{plan.description}</p>
        )}
      </Card>
      {plan.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList aria-hidden />}
            title="Exercises are on the way"
            description="Your trainer has not added exercises to this plan yet."
          />
        </Card>
      ) : (
        <PlanDays items={plan.items} labelPrefix={plan.name} />
      )}
    </section>
  );
}

function History({ planNames }: { planNames: Record<string, string> }) {
  const logs = useMyWorkoutLogs({ pageSize: 60 });
  return (
    <Card>
      <CardHeader
        id="history-heading"
        title="Workout history"
        description="What you logged, newest first."
      />
      {logs.isPending ? (
        <ListSkeleton rows={3} label="Loading your workout history" />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
      ) : logs.data.data.length === 0 ? (
        <EmptyState
          icon={<NotebookPen aria-hidden />}
          title="Nothing logged yet"
          description="After a session, use “Log a workout” to tick off what you did. Your trainer sees it too."
        />
      ) : (
        <LogHistory logs={logs.data.data} planNames={planNames} />
      )}
    </Card>
  );
}

export function PortalWorkoutsPage() {
  const workouts = useMyWorkouts();
  const [logging, setLogging] = useState<MyWorkoutDto | null>(null);

  const header = (
    <PageHeader
      title="My workouts"
      description="The plans your trainer set for you, day by day, and the sessions you have logged."
      actions={
        <ButtonLink to="/portal/progress" variant="secondary" icon={<LineChart aria-hidden />}>
          My progress
        </ButtonLink>
      }
    />
  );

  if (workouts.isPending)
    return (
      <>
        {header}
        <Card className="p-5">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="mt-3 h-4 w-80 max-w-full" />
          <Skeleton className="mt-6 h-24" />
        </Card>
      </>
    );
  if (workouts.isError)
    return (
      <>
        {header}
        <Card>
          <ErrorState error={workouts.error} onRetry={() => workouts.refetch()} />
        </Card>
      </>
    );

  const active = workouts.data.filter((workout) => workout.status === 'ACTIVE');
  const closed = workouts.data.filter((workout) => workout.status !== 'ACTIVE');
  const planNames = Object.fromEntries(
    workouts.data.map((workout) => [workout.assignmentId, workout.plan.name]),
  );

  return (
    <>
      {header}
      <div className="flex flex-col gap-8">
        {active.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ClipboardList aria-hidden />}
              title="No workout plan yet"
              description="When your trainer assigns you a plan, it appears here with every exercise, set and rest time."
            />
          </Card>
        ) : (
          active.map((workout) => (
            <ActiveWorkout
              key={workout.assignmentId}
              workout={workout}
              onLog={() => setLogging(workout)}
            />
          ))
        )}

        <History planNames={planNames} />

        {closed.length > 0 && (
          <Card>
            <CardHeader id="earlier-heading" title="Earlier plans" />
            <ul aria-labelledby="earlier-heading" className="divide-y divide-border">
              {closed.map((workout) => (
                <li
                  key={workout.assignmentId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3.5 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">{workout.plan.name}</span>
                    <span className="block text-13 text-fg-muted">
                      {formatDate(workout.startDate)}
                      {workout.endDate && ` – ${formatDate(workout.endDate)}`} ·{' '}
                      {plural(workout.daysLogged, 'day')} logged
                    </span>
                  </span>
                  <Badge tone={ASSIGNMENT_TONES[workout.status]}>
                    {WORKOUT_ASSIGNMENT_STATUS_LABELS[workout.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {logging && (
        <LogWorkoutDialog
          key={logging.assignmentId}
          assignmentId={logging.assignmentId}
          planName={logging.plan.name}
          items={logging.plan.items}
          mode="member"
          open
          onOpenChange={(open) => !open && setLogging(null)}
        />
      )}
    </>
  );
}

export function PortalProgressPage() {
  return (
    <>
      <PageHeader
        title="My progress"
        description="Record your weight and measurements over time. Your trainer can add entries too."
        actions={
          <ButtonLink
            to="/portal/workouts"
            variant="secondary"
            icon={<ClipboardList aria-hidden />}
          >
            My workouts
          </ButtonLink>
        }
      />
      <MyProgress />
    </>
  );
}
