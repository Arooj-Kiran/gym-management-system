import * as Menu from '@radix-ui/react-dropdown-menu';
import { DIFFICULTY_LEVEL_LABELS, permissionScope, type WorkoutPlanDetailDto } from '@gms/shared';
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Ellipsis,
  ListPlus,
  Pencil,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { formatDate, formatRelative } from '../../lib/format';
import { MemberAvatar } from '../members/member-avatar';
import { AssignWorkoutDialog } from './assign-workout-dialog';
import { PlanBuilder } from './plan-builder';
import { PlanDays } from './plan-days';
import { WorkoutPlanFormDialog } from './workout-plan-form-dialog';
import { DIFFICULTY_TONES, plural } from './workout-format';
import {
  useArchiveWorkoutPlan,
  useDuplicateWorkoutPlan,
  useWorkoutAssignments,
  useWorkoutPlan,
} from './workouts-api';

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

function Following({ plan }: { plan: WorkoutPlanDetailDto }) {
  const assignments = useWorkoutAssignments({ planId: plan.id, status: 'ACTIVE', pageSize: 8 });
  return (
    <Card>
      <CardHeader
        title="Following this plan"
        description={
          assignments.data && assignments.data.total > 0
            ? `${plural(assignments.data.total, 'member')} you can see`
            : undefined
        }
      />
      {assignments.isPending ? (
        <ListSkeleton rows={2} label="Loading members following this plan" />
      ) : assignments.isError ? (
        <ErrorState error={assignments.error} onRetry={() => assignments.refetch()} />
      ) : assignments.data.data.length === 0 ? (
        <p className="px-4 pb-5 text-13 text-fg-muted sm:px-5">Nobody is following it right now.</p>
      ) : (
        <ul
          aria-label="Members following this plan"
          className="divide-y divide-border border-t border-border"
        >
          {assignments.data.data.map((assignment) => (
            <li key={assignment.id}>
              <Link
                to={`/workout-assignments/${assignment.id}`}
                className="group flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5"
              >
                <MemberAvatar member={assignment.member} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    {fullName(assignment.member)}
                  </span>
                  <span className="block truncate text-13 text-fg-muted">
                    {assignment.lastLoggedOn
                      ? `Last logged ${formatRelative(assignment.lastLoggedOn).toLowerCase()}`
                      : `Since ${formatDate(assignment.startDate)} · nothing logged`}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WorkoutPlanPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const { user } = useSession();
  const plan = useWorkoutPlan(id);
  const duplicate = useDuplicateWorkoutPlan();
  const archive = useArchiveWorkoutPlan();
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const back = (
    <Link
      to="/workout-plans"
      className="inline-flex items-center gap-1.5 text-13 text-fg-secondary hover:text-fg"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Workout plans
    </Link>
  );

  if (plan.isPending)
    return (
      <>
        <PageHeader eyebrow={back} title="Workout plan" />
        <Card className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-3 h-4 w-72" />
        </Card>
      </>
    );
  if (plan.isError)
    return (
      <>
        <PageHeader eyebrow={back} title="Workout plan" />
        <Card>
          <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
        </Card>
      </>
    );

  const p = plan.data;
  const active = p.status === 'ACTIVE';
  const manageScope = permissionScope(user.role, 'workouts:manage');
  const canEdit =
    can('workouts:manage') && active && (manageScope === 'ALL' || p.owner?.id === user.id);
  const canDuplicate = can('workouts:manage');
  const canAssign = can('workouts:assign') && active && p.itemCount > 0;

  const runDuplicate = () =>
    duplicate.mutate(
      { id: p.id },
      {
        onSuccess: (copy) => {
          toast.success(`${copy.name} created`, { description: 'Adjust it for your member.' });
          void navigate(`/workout-plans/${copy.id}`);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  const hasMenu = canDuplicate || canEdit;

  return (
    <>
      <PageHeader
        eyebrow={back}
        title={p.name}
        description={p.goal ?? undefined}
        actions={
          !building && (
            <>
              {canAssign && (
                <Button icon={<UserRoundPlus aria-hidden />} onClick={() => setAssigning(true)}>
                  Assign to member
                </Button>
              )}
              {canEdit && (
                <Button
                  variant="secondary"
                  icon={<Pencil aria-hidden />}
                  onClick={() => setEditing(true)}
                >
                  Edit details
                </Button>
              )}
              {hasMenu && (
                <Menu.Root>
                  <Menu.Trigger asChild>
                    <Button
                      variant="secondary"
                      icon={<Ellipsis aria-hidden />}
                      aria-label="More plan actions"
                      disabled={duplicate.isPending}
                    />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Content
                      align="end"
                      sideOffset={6}
                      className="z-50 w-52 rounded-lg border border-border bg-surface p-1.5 shadow-lg animate-pop-in"
                    >
                      {canDuplicate && (
                        <Menu.Item className={MENU_ITEM} onSelect={runDuplicate}>
                          <Copy aria-hidden />
                          Duplicate plan
                        </Menu.Item>
                      )}
                      {canEdit && (
                        <Menu.Item className={MENU_ITEM} onSelect={() => setArchiving(true)}>
                          <Archive aria-hidden />
                          Archive plan
                        </Menu.Item>
                      )}
                    </Menu.Content>
                  </Menu.Portal>
                </Menu.Root>
              )}
            </>
          )
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
          {building ? (
            <PlanBuilder plan={p} onDone={() => setBuilding(false)} />
          ) : p.items.length === 0 ? (
            <Card>
              <EmptyState
                icon={<ClipboardList aria-hidden />}
                title="No exercises yet"
                description={
                  canEdit
                    ? 'Add exercises from the library, day by day, with sets, reps and rest.'
                    : 'The plan owner has not added any exercises.'
                }
                action={
                  canEdit && (
                    <Button
                      size="sm"
                      icon={<ListPlus aria-hidden />}
                      onClick={() => setBuilding(true)}
                    >
                      Add exercises
                    </Button>
                  )
                }
              />
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-fg">
                  Exercises
                  <span className="ml-2 text-13 font-normal text-fg-muted">
                    {plural(p.itemCount, 'exercise')} · {plural(p.dayCount, 'day')}
                  </span>
                </h2>
                {canEdit && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Pencil aria-hidden />}
                    onClick={() => setBuilding(true)}
                  >
                    Edit exercises
                  </Button>
                )}
              </div>
              <PlanDays items={p.items} />
            </>
          )}
        </div>

        <div className="order-1 flex flex-col gap-6 lg:order-2">
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone={DIFFICULTY_TONES[p.difficulty]}>
                {DIFFICULTY_LEVEL_LABELS[p.difficulty]}
              </Badge>
              {p.isTemplate && <Badge>Template</Badge>}
              {!active && <Badge tone="danger">Archived</Badge>}
            </div>
            {!active && (
              <p className="mb-4 rounded-md bg-warning-subtle px-3 py-2 text-13 text-warning-text">
                Archived plans cannot be edited or assigned. Members already following it keep it
                until their assignment closes.
              </p>
            )}
            <dl className="divide-y divide-border">
              <Fact label="Trainer">{p.owner ? fullName(p.owner) : 'Gym plan'}</Fact>
              <Fact label="Content">
                {p.itemCount === 0
                  ? 'Empty'
                  : `${plural(p.itemCount, 'exercise')} · ${plural(p.dayCount, 'day')}`}
              </Fact>
              <Fact label="Following">
                <span className="tabular-nums">{plural(p.activeAssignments, 'member')}</span>
              </Fact>
              <Fact label="Updated">{formatRelative(p.updatedAt)}</Fact>
            </dl>
            {p.description && (
              <p className="mt-4 border-t border-border pt-4 text-13 whitespace-pre-line text-fg-secondary">
                {p.description}
              </p>
            )}
            {canAssign === false && can('workouts:assign') && active && p.itemCount === 0 && (
              <p className="mt-4 text-13 text-fg-muted">Add exercises before assigning the plan.</p>
            )}
          </Card>
          {p.activeAssignments > 0 ? (
            <Following plan={p} />
          ) : (
            <Card className="flex items-start gap-3 p-5 text-13 text-fg-secondary">
              <UsersRound className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
              Nobody is following this plan yet.
            </Card>
          )}
        </div>
      </div>

      {canEdit && <WorkoutPlanFormDialog plan={p} open={editing} onOpenChange={setEditing} />}
      {canAssign && <AssignWorkoutDialog plan={p} open={assigning} onOpenChange={setAssigning} />}
      {canEdit && (
        <ConfirmDialog
          open={archiving}
          onOpenChange={setArchiving}
          title={`Archive ${p.name}?`}
          description={
            p.activeAssignments > 0
              ? `${plural(p.activeAssignments, 'member')} following it keep the plan until their assignment closes. It can no longer be edited or assigned.`
              : 'It can no longer be edited or assigned. Logs and history stay on record.'
          }
          confirmLabel="Archive plan"
          tone="danger"
          reason="optional"
          loading={archive.isPending}
          onConfirm={(reason) =>
            archive.mutate(
              { id: p.id, reason: reason || undefined },
              {
                onSuccess: () => {
                  toast.success(`${p.name} archived`);
                  setArchiving(false);
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
