import { zodResolver } from '@hookform/resolvers/zod';
import {
  DIFFICULTY_LEVEL_LABELS,
  permissionScope,
  updateWorkoutAssignmentSchema,
  WORKOUT_ASSIGNMENT_STATUS_LABELS,
  WORKOUT_LIMITS,
  type WorkoutAssignmentDto,
} from '@gms/shared';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  ClipboardList,
  Ellipsis,
  NotebookPen,
  Pencil,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import type { z } from 'zod';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Textarea } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { formatDate, gymTodayIso } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { MemberAvatar } from '../members/member-avatar';
import { LogHistory } from './log-history';
import { LogWorkoutDialog } from './log-workout-dialog';
import { PlanDays } from './plan-days';
import { MemberProgress } from './progress';
import { ASSIGNMENT_TONES, DIFFICULTY_TONES, plural } from './workout-format';
import {
  useUpdateWorkoutAssignment,
  useWorkoutAssignment,
  useWorkoutLogs,
  useWorkoutPlan,
} from './workouts-api';

type FormInput = z.input<typeof updateWorkoutAssignmentSchema>;
type FormOutput = z.output<typeof updateWorkoutAssignmentSchema>;

const FORM_ID = 'edit-assignment-form';
const MENU_ITEM =
  'flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-fg outline-none select-none data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:text-fg-muted';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-13 text-fg-muted">{label}</dt>
      <dd className="text-right text-sm text-fg">{children}</dd>
    </div>
  );
}

function EditAssignmentDialog({
  assignment,
  open,
  onOpenChange,
}: {
  assignment: WorkoutAssignmentDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateWorkoutAssignment();
  const defaults: FormInput = {
    trainerNotes: assignment.trainerNotes ?? '',
    endDate: assignment.endDate ?? '',
  };
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(updateWorkoutAssignmentSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;
  const today = gymTodayIso();

  const close = (next: boolean) => {
    if (!next) form.reset(defaults);
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    update.mutate(
      { id: assignment.id, input: values },
      {
        onSuccess: () => {
          toast.success('Workout updated');
          onOpenChange(false);
        },
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, ['trainerNotes', 'endDate']))
            toast.error(errorMessage(error));
        },
      },
    ),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Edit notes and end date"
      description="The member sees your notes with the plan in their portal."
      busy={update.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={update.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField label="Notes for the member" optional error={errors.trainerNotes?.message}>
          <Textarea
            rows={4}
            maxLength={WORKOUT_LIMITS.notesMax}
            {...form.register('trainerNotes')}
          />
        </FormField>
        <FormField
          label="Ends"
          optional
          error={errors.endDate?.message}
          hint="Leave empty to run until you close it."
        >
          <Input
            type="date"
            min={assignment.startDate > today ? assignment.startDate : today}
            {...form.register('endDate')}
          />
        </FormField>
      </form>
    </Dialog>
  );
}

function Logs({ assignment }: { assignment: WorkoutAssignmentDto }) {
  const logs = useWorkoutLogs({ assignmentId: assignment.id, pageSize: 100 });
  return (
    <Card>
      <CardHeader
        title="Workout log"
        description={
          assignment.daysLogged > 0
            ? `${plural(assignment.daysLogged, 'day')} with completed exercises`
            : undefined
        }
      />
      {logs.isPending ? (
        <ListSkeleton rows={3} label="Loading the workout log" />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
      ) : logs.data.data.length === 0 ? (
        <EmptyState
          icon={<NotebookPen aria-hidden />}
          title="Nothing logged yet"
          description="Sessions appear here when the member logs them in the portal or you log one for them."
        />
      ) : (
        <>
          <LogHistory logs={logs.data.data} />
          {logs.data.total > logs.data.data.length && (
            <p className="border-t border-border px-4 py-3 text-13 text-fg-muted sm:px-5">
              Showing the latest {logs.data.data.length} of {logs.data.total} logged exercises.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

export function WorkoutAssignmentPage() {
  const { id = '' } = useParams();
  const can = useCan();
  const { user } = useSession();
  const assignment = useWorkoutAssignment(id);
  const plan = useWorkoutPlan(assignment.data?.plan.id ?? '');
  const update = useUpdateWorkoutAssignment();
  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [closing, setClosing] = useState<'COMPLETED' | 'CANCELLED' | null>(null);

  const back = (
    <Link
      to="/workout-assignments"
      className="inline-flex items-center gap-1.5 text-13 text-fg-secondary hover:text-fg"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Assigned workouts
    </Link>
  );

  if (assignment.isPending)
    return (
      <>
        <PageHeader eyebrow={back} title="Assigned workout" />
        <Card className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-3 h-4 w-72" />
        </Card>
      </>
    );
  if (assignment.isError)
    return (
      <>
        <PageHeader eyebrow={back} title="Assigned workout" />
        <Card>
          <ErrorState error={assignment.error} onRetry={() => assignment.refetch()} />
        </Card>
      </>
    );

  const a = assignment.data;
  const active = a.status === 'ACTIVE';
  const canUpdate = can('workouts:assign') && active;
  const canLog = can('workouts:log') && active && (plan.data?.items.length ?? 0) > 0;
  const memberName = fullName(a.member);
  const seesMemberPage = permissionScope(user.role, 'members:read') === 'ALL';
  const memberCard = (
    <>
      <MemberAvatar member={a.member} size="lg" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-fg">{memberName}</span>
        <span className="block font-mono text-xs text-fg-muted">{a.member.memberCode}</span>
      </span>
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow={back}
        title={a.plan.name}
        description={`${memberName}'s workout plan`}
        actions={
          <>
            {canLog && plan.data && (
              <Button icon={<NotebookPen aria-hidden />} onClick={() => setLogging(true)}>
                Log a workout
              </Button>
            )}
            {canUpdate && (
              <>
                <Button
                  variant="secondary"
                  icon={<Pencil aria-hidden />}
                  onClick={() => setEditing(true)}
                >
                  Edit notes
                </Button>
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button
                      variant="secondary"
                      icon={<Ellipsis aria-hidden />}
                      aria-label="Close this workout"
                    />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content
                      align="end"
                      sideOffset={6}
                      className="z-50 w-56 rounded-lg border border-border bg-surface p-1.5 shadow-lg animate-pop-in"
                    >
                      <Menu.Item className={MENU_ITEM} onSelect={() => setClosing('COMPLETED')}>
                        <CircleCheck aria-hidden />
                        Mark as completed
                      </Menu.Item>
                      <Menu.Item className={MENU_ITEM} onSelect={() => setClosing('CANCELLED')}>
                        <CircleX aria-hidden />
                        Cancel this workout
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              </>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 flex min-w-0 flex-col gap-6 lg:order-1">
          <Logs assignment={a} />
          <MemberProgress memberId={a.member.id} canRecord={can('progress:record')} />
          <section aria-labelledby="plan-heading" className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="plan-heading" className="text-base font-semibold text-fg">
                The plan
              </h2>
              <Link
                to={`/workout-plans/${a.plan.id}`}
                className="text-13 font-medium text-primary-text hover:underline"
              >
                Open plan
              </Link>
            </div>
            {plan.isPending ? (
              <Card className="p-5">
                <Skeleton className="h-16" />
              </Card>
            ) : plan.isError ? (
              <Card>
                <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
              </Card>
            ) : plan.data.items.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<ClipboardList aria-hidden />}
                  title="The plan has no exercises"
                />
              </Card>
            ) : (
              <PlanDays items={plan.data.items} />
            )}
          </section>
        </div>

        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <Card className="p-5">
            {seesMemberPage ? (
              <Link
                to={`/members/${a.member.id}`}
                className="-m-2 mb-2 flex items-center gap-3 rounded-md p-2 transition-colors duration-150 hover:bg-surface-hover"
              >
                {memberCard}
              </Link>
            ) : (
              <div className="mb-4 flex items-center gap-3">{memberCard}</div>
            )}
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={ASSIGNMENT_TONES[a.status]} dot>
                {WORKOUT_ASSIGNMENT_STATUS_LABELS[a.status]}
              </Badge>
              <Badge tone={DIFFICULTY_TONES[a.plan.difficulty]}>
                {DIFFICULTY_LEVEL_LABELS[a.plan.difficulty]}
              </Badge>
              {a.plan.status === 'ARCHIVED' && <Badge tone="warning">Plan archived</Badge>}
            </div>
            <dl className="divide-y divide-border">
              <Fact label="Trainer">{a.trainer ? fullName(a.trainer) : 'None'}</Fact>
              <Fact label="Started">{formatDate(a.startDate)}</Fact>
              <Fact label="Ends">{a.endDate ? formatDate(a.endDate) : 'Open-ended'}</Fact>
              <Fact label="Days logged">
                <span className="tabular-nums">{a.daysLogged}</span>
              </Fact>
              <Fact label="Last logged">{a.lastLoggedOn ? formatDate(a.lastLoggedOn) : '—'}</Fact>
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="text-13 font-medium text-fg-muted">Notes for the member</h2>
            <p className="mt-1.5 text-sm whitespace-pre-line text-fg">
              {a.trainerNotes ?? <span className="text-fg-muted">No notes.</span>}
            </p>
          </Card>
        </div>
      </div>

      {canUpdate && editing && (
        <EditAssignmentDialog assignment={a} open={editing} onOpenChange={setEditing} />
      )}
      {canLog && plan.data && (
        <LogWorkoutDialog
          assignmentId={a.id}
          planName={a.plan.name}
          items={plan.data.items}
          mode="staff"
          open={logging}
          onOpenChange={setLogging}
        />
      )}
      {canUpdate && (
        <ConfirmDialog
          open={closing !== null}
          onOpenChange={(next) => !next && setClosing(null)}
          title={
            closing === 'CANCELLED'
              ? `Cancel ${memberName}'s workout?`
              : `Mark ${memberName}'s workout as completed?`
          }
          description="Closing is final. The member keeps the history but can no longer log sessions against this plan. You can assign it again later."
          confirmLabel={closing === 'CANCELLED' ? 'Cancel workout' : 'Mark completed'}
          tone={closing === 'CANCELLED' ? 'danger' : 'primary'}
          loading={update.isPending}
          onConfirm={() =>
            closing &&
            update.mutate(
              { id: a.id, input: { status: closing } },
              {
                onSuccess: () => {
                  toast.success(
                    closing === 'CANCELLED' ? 'Workout cancelled' : 'Workout marked completed',
                  );
                  setClosing(null);
                },
                onError: (error) => toast.error(errorMessage(error)),
              },
            )
          }
        />
      )}
    </>
  );
}
