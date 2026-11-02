import {
  ERROR_CODES,
  permissionScope,
  SCOPES,
  WORKOUT_LIMITS,
  type BodyMeasurements,
  type MembershipBrief,
  type MyWorkoutDto,
  type Paginated,
  type Permission,
  type ProgressEntryDto,
  type WorkoutAssignmentDto,
  type WorkoutLogDto,
  type WorkoutPlanDetailDto,
  type WorkoutPlanDto,
  type WorkoutPlanItemDto,
  type createWorkoutAssignmentSchema,
  type createWorkoutPlanSchema,
  type duplicateWorkoutPlanSchema,
  type logWorkoutSchema,
  type recordProgressSchema,
  type setWorkoutPlanItemsSchema,
  type updateWorkoutAssignmentSchema,
  type updateWorkoutPlanSchema,
  type workoutAssignmentListQuerySchema,
  type workoutLogListQuerySchema,
  type workoutPlanListQuerySchema,
} from '@gms/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lte,
  sql,
  type Column,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import {
  exercises,
  members,
  progressEntries,
  users,
  workoutAssignments,
  workoutLogs,
  workoutPlanItems,
  workoutPlans,
} from '../../db/schema';
import { readImage } from '../../integrations/storage/local-storage';
import { diffFields, recordAudit } from '../../lib/audit';
import { gymToday } from '../../lib/dates';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, forbidden, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';
import { exerciseImageUrl } from '../exercises/exercises.service';
import { toTrainerSafe } from '../members/members.service';
import { currentMembershipBriefSql, qualified } from '../memberships/current-membership';
import { requireOwnRow } from '../portal/portal.service';
import { requireTrainer } from '../scheduling/scheduling';
import { assignedMemberSql, isAssigned } from '../trainers/trainer-scope';

type CreatePlan = z.output<typeof createWorkoutPlanSchema>;
type UpdatePlan = z.output<typeof updateWorkoutPlanSchema>;
type DuplicatePlan = z.output<typeof duplicateWorkoutPlanSchema>;
type SetItems = z.output<typeof setWorkoutPlanItemsSchema>;
type PlanListQuery = z.output<typeof workoutPlanListQuerySchema>;
type CreateAssignment = z.output<typeof createWorkoutAssignmentSchema>;
type UpdateAssignment = z.output<typeof updateWorkoutAssignmentSchema>;
type AssignmentListQuery = z.output<typeof workoutAssignmentListQuerySchema>;
type LogWorkout = z.output<typeof logWorkoutSchema>;
type LogListQuery = z.output<typeof workoutLogListQuerySchema>;
type RecordProgress = z.output<typeof recordProgressSchema>;
type PlanRow = typeof workoutPlans.$inferSelect;
type Auth = Express.AuthContext;

const STAFF_IMAGE_BASE = '/api/v1/exercises';
const MEMBER_IMAGE_BASE = '/api/v1/me/exercises';

// --- Scope (PLAN §5) --------------------------------------------------------------------------

/**
 * A trainer reads plans they own plus plans given to a member currently assigned to them; the
 * same assignment rule decides which members' workouts, logs and progress they see.
 */
const trainerPlanSql = (trainerUserId: string): SQL =>
  sql`(${qualified(workoutPlans.ownerTrainerId)} = ${trainerUserId} or exists (
    select 1 from workout_assignments wa
    join trainer_assignments ta on ta.member_id = wa.member_id
      and ta.trainer_id = ${trainerUserId} and ta.end_date is null
    where wa.plan_id = ${qualified(workoutPlans.id)}))`;

/** Null when the caller sees every plan; otherwise the trainer's visibility condition. */
function planScopeSql(auth: Auth): SQL | undefined {
  const scope = permissionScope(auth.user.role, 'workouts:read');
  if (scope === SCOPES.ALL) return undefined;
  if (scope === SCOPES.OWN_AND_ASSIGNED) return trainerPlanSql(auth.user.id);
  throw forbidden();
}

/** Null when the caller sees every member; otherwise "assigned to this trainer". */
function memberScopeSql(auth: Auth, permission: Permission, memberId: Column) {
  const scope = permissionScope(auth.user.role, permission);
  if (scope === SCOPES.ALL) return undefined;
  if (scope === SCOPES.ASSIGNED || scope === SCOPES.OWN_AND_ASSIGNED) {
    return assignedMemberSql(memberId, auth.user.id);
  }
  throw forbidden();
}

/** 403 unless the caller's scope for `permission` covers this member. */
async function assertMemberInScope(
  auth: Auth,
  permission: Permission,
  memberId: string,
  executor: DbExecutor = db,
) {
  const scope = permissionScope(auth.user.role, permission);
  if (scope === SCOPES.ALL) return;
  if (
    (scope === SCOPES.ASSIGNED || scope === SCOPES.OWN_AND_ASSIGNED) &&
    (await isAssigned(auth.user.id, memberId, executor))
  ) {
    return;
  }
  throw forbidden('This member is not assigned to you.');
}

function assertCanManagePlan(auth: Auth, plan: PlanRow) {
  const scope = permissionScope(auth.user.role, 'workouts:manage');
  if (scope === SCOPES.ALL) return;
  if (scope === SCOPES.OWN && plan.ownerTrainerId === auth.user.id) return;
  throw forbidden('You can only change your own plans.');
}

async function requireMember(executor: DbExecutor, memberId: string) {
  const [row] = await executor
    .select({ id: members.id, archivedAt: members.archivedAt })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!row) throw notFound('Member');
  return row;
}

// --- Plans ------------------------------------------------------------------------------------

const planOwner = alias(users, 'plan_owner');

/** FROM clause over the plan's current (not removed) items, for the count subqueries. */
const liveItems = sql`from workout_plan_items i
  where i.plan_id = ${qualified(workoutPlans.id)} and i.removed_at is null`;

function selectPlans(executor: DbExecutor = db) {
  return executor
    .select({
      plan: workoutPlans,
      ownerFirstName: planOwner.firstName,
      ownerLastName: planOwner.lastName,
      itemCount: sql<number>`(select count(*)::int ${liveItems})`,
      dayCount: sql<number>`(select count(distinct i.day_number)::int ${liveItems})`,
      activeAssignments: sql<number>`(select count(*)::int from workout_assignments wa
        where wa.plan_id = ${qualified(workoutPlans.id)} and wa.status = 'ACTIVE')`,
    })
    .from(workoutPlans)
    .leftJoin(planOwner, eq(planOwner.id, workoutPlans.ownerTrainerId));
}

type PlanSelectRow = Awaited<ReturnType<typeof selectPlans>>[number];

function toPlanDto(row: PlanSelectRow): WorkoutPlanDto {
  const { plan } = row;
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    goal: plan.goal,
    difficulty: plan.difficulty,
    owner:
      plan.ownerTrainerId && row.ownerFirstName
        ? { id: plan.ownerTrainerId, firstName: row.ownerFirstName, lastName: row.ownerLastName! }
        : null,
    isTemplate: plan.isTemplate,
    status: plan.status,
    itemCount: row.itemCount,
    dayCount: row.dayCount,
    activeAssignments: row.activeAssignments,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

/** The plan's current items in day and position order. */
async function planItems(
  executor: DbExecutor,
  planId: string,
  imageBase: string,
): Promise<WorkoutPlanItemDto[]> {
  const rows = await executor
    .select({ item: workoutPlanItems, exercise: exercises })
    .from(workoutPlanItems)
    .innerJoin(exercises, eq(exercises.id, workoutPlanItems.exerciseId))
    .where(and(eq(workoutPlanItems.planId, planId), isNull(workoutPlanItems.removedAt)))
    .orderBy(asc(workoutPlanItems.dayNumber), asc(workoutPlanItems.position));
  return rows.map(({ item, exercise }) => ({
    id: item.id,
    dayNumber: item.dayNumber,
    position: item.position,
    exercise: {
      id: exercise.id,
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      difficulty: exercise.difficulty,
      instructions: exercise.instructions,
      imageUrl: exerciseImageUrl(exercise.id, exercise.imageKey, imageBase),
      isActive: exercise.isActive,
    },
    sets: item.sets,
    reps: item.reps,
    durationSeconds: item.durationSeconds,
    restSeconds: item.restSeconds,
    loadNote: item.loadNote,
    notes: item.notes,
  }));
}

async function readPlanDetail(executor: DbExecutor, id: string): Promise<WorkoutPlanDetailDto> {
  const [row] = await selectPlans(executor).where(eq(workoutPlans.id, id)).limit(1);
  if (!row) throw notFound('Workout plan');
  return { ...toPlanDto(row), items: await planItems(executor, id, STAFF_IMAGE_BASE) };
}

/** 404 when the plan does not exist, 403 when it exists but is outside the caller's scope. */
async function requireVisiblePlan(executor: DbExecutor, id: string, auth: Auth, forUpdate = false) {
  const query = executor.select().from(workoutPlans).where(eq(workoutPlans.id, id)).limit(1);
  const [plan] = forUpdate ? await query.for('update') : await query;
  if (!plan) throw notFound('Workout plan');
  const scope = planScopeSql(auth);
  if (scope && plan.ownerTrainerId !== auth.user.id) {
    const [visible] = await executor
      .select({ id: workoutPlans.id })
      .from(workoutPlans)
      .where(and(eq(workoutPlans.id, id), scope))
      .limit(1);
    if (!visible) throw forbidden('This plan is not yours or one of your members’.');
  }
  return plan;
}

export async function listPlans(
  query: PlanListQuery,
  auth: Auth,
): Promise<Paginated<WorkoutPlanDto>> {
  const where = and(
    planScopeSql(auth),
    query.status ? eq(workoutPlans.status, query.status) : undefined,
    query.difficulty ? eq(workoutPlans.difficulty, query.difficulty) : undefined,
    query.ownerTrainerId ? eq(workoutPlans.ownerTrainerId, query.ownerTrainerId) : undefined,
    query.isTemplate !== undefined ? eq(workoutPlans.isTemplate, query.isTemplate) : undefined,
    query.q ? sql`${workoutPlans.name} ilike ${likePattern(query.q)}` : undefined,
  );
  const [rows, [total]] = await Promise.all([
    selectPlans()
      .where(where)
      .orderBy(asc(workoutPlans.status), asc(workoutPlans.name))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ count: count() }).from(workoutPlans).where(where),
  ]);
  return paginated(rows.map(toPlanDto), query.page, query.pageSize, total?.count ?? 0);
}

export async function getPlan(id: string, auth: Auth): Promise<WorkoutPlanDetailDto> {
  await requireVisiblePlan(db, id, auth);
  return readPlanDetail(db, id);
}

/** A trainer always owns the plans they create; Admin / Manager may name a trainer or none. */
export async function createPlan(
  input: CreatePlan,
  auth: Auth,
  ctx: RequestContext,
): Promise<WorkoutPlanDetailDto> {
  const own = permissionScope(auth.user.role, 'workouts:manage') === SCOPES.OWN;
  if (own && input.ownerTrainerId && input.ownerTrainerId !== auth.user.id) {
    throw forbidden('You can only create plans you own.');
  }
  const ownerTrainerId = own ? auth.user.id : (input.ownerTrainerId ?? null);
  return db.transaction(async (tx) => {
    if (ownerTrainerId && !own) await requireTrainer(tx, ownerTrainerId);
    const [row] = await tx
      .insert(workoutPlans)
      .values({
        name: input.name,
        description: input.description,
        goal: input.goal,
        difficulty: input.difficulty,
        isTemplate: input.isTemplate ?? false,
        ownerTrainerId,
        createdBy: ctx.actorUserId,
      })
      .returning({ id: workoutPlans.id });
    await recordAudit(tx, ctx, {
      action: 'WORKOUT_PLAN_CREATED',
      entityType: 'WORKOUT_PLAN',
      entityId: row!.id,
      after: { name: input.name, difficulty: input.difficulty, ownerTrainerId },
    });
    return readPlanDetail(tx, row!.id);
  });
}

function assertPlanEditable(plan: PlanRow) {
  if (plan.status === 'ARCHIVED') {
    throw conflict(ERROR_CODES.WORKOUT_PLAN_ARCHIVED, 'This plan is archived.');
  }
}

export async function updatePlan(
  id: string,
  input: UpdatePlan,
  auth: Auth,
  ctx: RequestContext,
): Promise<WorkoutPlanDetailDto> {
  return db.transaction(async (tx) => {
    const plan = await requireVisiblePlan(tx, id, auth, true);
    assertCanManagePlan(auth, plan);
    assertPlanEditable(plan);
    const diff = diffFields(plan, input);
    if (Object.keys(diff.after).length > 0) {
      await tx
        .update(workoutPlans)
        .set(diff.after as Partial<PlanRow>)
        .where(eq(workoutPlans.id, id));
      await recordAudit(tx, ctx, {
        action: 'WORKOUT_PLAN_UPDATED',
        entityType: 'WORKOUT_PLAN',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
    }
    return readPlanDetail(tx, id);
  });
}

/**
 * Replace the plan's exercises. Items are matched to existing ones by exercise and day so logs
 * stay attached; an item dropped from the plan is deleted, or hidden (removed_at) when members
 * have already logged it. Archived exercises may stay on a plan but cannot be newly added.
 */
export async function setPlanItems(
  id: string,
  input: SetItems,
  auth: Auth,
  ctx: RequestContext,
): Promise<WorkoutPlanDetailDto> {
  return db.transaction(async (tx) => {
    const plan = await requireVisiblePlan(tx, id, auth, true);
    assertCanManagePlan(auth, plan);
    assertPlanEditable(plan);

    const existing = await tx
      .select()
      .from(workoutPlanItems)
      .where(and(eq(workoutPlanItems.planId, id), isNull(workoutPlanItems.removedAt)));
    const exerciseIds = [...new Set(input.items.map((item) => item.exerciseId))];
    const found =
      exerciseIds.length > 0
        ? await tx
            .select({ id: exercises.id, name: exercises.name, isActive: exercises.isActive })
            .from(exercises)
            .where(inArray(exercises.id, exerciseIds))
        : [];
    const byId = new Map(found.map((exercise) => [exercise.id, exercise]));
    const onPlan = new Set(existing.map((item) => item.exerciseId));
    const missing = input.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !byId.has(item.exerciseId));
    if (missing.length > 0) {
      throw validationFailed(
        missing.map(({ index }) => ({
          path: `items.${index}.exerciseId`,
          message: 'Exercise not found',
        })),
      );
    }
    const archived = exerciseIds
      .map((exerciseId) => byId.get(exerciseId)!)
      .find((exercise) => !exercise.isActive && !onPlan.has(exercise.id));
    if (archived) {
      throw conflict(
        ERROR_CODES.EXERCISE_ARCHIVED,
        `${archived.name} is archived and cannot be added to a plan.`,
      );
    }

    // Free the positions first so the (plan, day, position) index never sees a clash mid-way.
    await tx
      .update(workoutPlanItems)
      .set({ position: sql`${workoutPlanItems.position} + 100` })
      .where(and(eq(workoutPlanItems.planId, id), isNull(workoutPlanItems.removedAt)));

    const unused = new Map(existing.map((item) => [item.id, item]));
    const nextPosition = new Map<number, number>();
    for (const item of input.items) {
      const position = (nextPosition.get(item.dayNumber) ?? 0) + 1;
      nextPosition.set(item.dayNumber, position);
      const values = {
        dayNumber: item.dayNumber,
        position,
        sets: item.sets,
        reps: item.reps ?? null,
        durationSeconds: item.durationSeconds ?? null,
        restSeconds: item.restSeconds,
        loadNote: item.loadNote,
        notes: item.notes,
      };
      const match = [...unused.values()].find(
        (row) => row.exerciseId === item.exerciseId && row.dayNumber === item.dayNumber,
      );
      if (match) {
        unused.delete(match.id);
        await tx.update(workoutPlanItems).set(values).where(eq(workoutPlanItems.id, match.id));
      } else {
        await tx
          .insert(workoutPlanItems)
          .values({ planId: id, exerciseId: item.exerciseId, ...values });
      }
    }

    const dropped = [...unused.keys()];
    if (dropped.length > 0) {
      const logged = await tx
        .selectDistinct({ id: workoutLogs.planItemId })
        .from(workoutLogs)
        .where(inArray(workoutLogs.planItemId, dropped));
      const keep = new Set(logged.map((row) => row.id));
      const toHide = dropped.filter((itemId) => keep.has(itemId));
      const toDelete = dropped.filter((itemId) => !keep.has(itemId));
      if (toHide.length > 0) {
        await tx
          .update(workoutPlanItems)
          .set({ removedAt: new Date() })
          .where(inArray(workoutPlanItems.id, toHide));
      }
      if (toDelete.length > 0) {
        await tx.delete(workoutPlanItems).where(inArray(workoutPlanItems.id, toDelete));
      }
    }

    await recordAudit(tx, ctx, {
      action: 'WORKOUT_PLAN_ITEMS_UPDATED',
      entityType: 'WORKOUT_PLAN',
      entityId: id,
      before: { itemCount: existing.length },
      after: { itemCount: input.items.length, days: [...nextPosition.keys()].sort() },
    });
    return readPlanDetail(tx, id);
  });
}

/** A copy with the same exercises. A trainer owns their copy; Admin / Manager keep the owner. */
export async function duplicatePlan(
  id: string,
  input: DuplicatePlan,
  auth: Auth,
  ctx: RequestContext,
): Promise<WorkoutPlanDetailDto> {
  return db.transaction(async (tx) => {
    const source = await requireVisiblePlan(tx, id, auth);
    const own = permissionScope(auth.user.role, 'workouts:manage') === SCOPES.OWN;
    const name = input.name ?? `${source.name} (copy)`.slice(0, 80);
    const [copy] = await tx
      .insert(workoutPlans)
      .values({
        name,
        description: source.description,
        goal: source.goal,
        difficulty: source.difficulty,
        isTemplate: false,
        ownerTrainerId: own ? auth.user.id : source.ownerTrainerId,
        createdBy: ctx.actorUserId,
      })
      .returning({ id: workoutPlans.id });
    const items = await tx
      .select()
      .from(workoutPlanItems)
      .where(and(eq(workoutPlanItems.planId, id), isNull(workoutPlanItems.removedAt)));
    if (items.length > 0) {
      await tx.insert(workoutPlanItems).values(
        items.map(({ id: _id, planId: _planId, createdAt: _c, updatedAt: _u, ...item }) => ({
          ...item,
          planId: copy!.id,
        })),
      );
    }
    await recordAudit(tx, ctx, {
      action: 'WORKOUT_PLAN_DUPLICATED',
      entityType: 'WORKOUT_PLAN',
      entityId: copy!.id,
      after: { sourcePlanId: id, name, itemCount: items.length },
    });
    return readPlanDetail(tx, copy!.id);
  });
}

/** Archived plans cannot be edited or assigned again; members keep following open assignments. */
export async function archivePlan(
  id: string,
  auth: Auth,
  ctx: RequestContext,
): Promise<WorkoutPlanDetailDto> {
  return db.transaction(async (tx) => {
    const plan = await requireVisiblePlan(tx, id, auth, true);
    assertCanManagePlan(auth, plan);
    if (plan.status !== 'ARCHIVED') {
      await tx.update(workoutPlans).set({ status: 'ARCHIVED' }).where(eq(workoutPlans.id, id));
      await recordAudit(tx, ctx, {
        action: 'WORKOUT_PLAN_ARCHIVED',
        entityType: 'WORKOUT_PLAN',
        entityId: id,
        before: { status: plan.status },
        after: { status: 'ARCHIVED' },
      });
    }
    return readPlanDetail(tx, id);
  });
}

// --- Assignments ------------------------------------------------------------------------------

const assignmentTrainer = alias(users, 'workout_trainer');

const daysLoggedSql = sql<number>`(select count(distinct wl.performed_on)::int from workout_logs wl
  where wl.assignment_id = ${qualified(workoutAssignments.id)} and wl.completed)`;
const lastLoggedSql = sql<string | null>`(select max(wl.performed_on)::text from workout_logs wl
  where wl.assignment_id = ${qualified(workoutAssignments.id)})`;

function selectAssignments(executor: DbExecutor = db) {
  return executor
    .select({
      assignment: workoutAssignments,
      planName: workoutPlans.name,
      planDifficulty: workoutPlans.difficulty,
      planStatus: workoutPlans.status,
      trainerFirstName: assignmentTrainer.firstName,
      trainerLastName: assignmentTrainer.lastName,
      member: {
        ...getTableColumns(members),
        currentMembership: currentMembershipBriefSql(members.id, gymToday()).mapWith(
          (value) => value as MembershipBrief,
        ),
      },
      daysLogged: daysLoggedSql,
      lastLoggedOn: lastLoggedSql,
    })
    .from(workoutAssignments)
    .innerJoin(workoutPlans, eq(workoutPlans.id, workoutAssignments.planId))
    .innerJoin(members, eq(members.id, workoutAssignments.memberId))
    .leftJoin(assignmentTrainer, eq(assignmentTrainer.id, workoutAssignments.trainerId));
}

type AssignmentRow = Awaited<ReturnType<typeof selectAssignments>>[number];

function toAssignmentDto(row: AssignmentRow): WorkoutAssignmentDto {
  const { assignment } = row;
  return {
    id: assignment.id,
    plan: {
      id: assignment.planId,
      name: row.planName,
      difficulty: row.planDifficulty,
      status: row.planStatus,
    },
    member: toTrainerSafe(row.member),
    trainer:
      assignment.trainerId && row.trainerFirstName
        ? {
            id: assignment.trainerId,
            firstName: row.trainerFirstName,
            lastName: row.trainerLastName!,
          }
        : null,
    startDate: assignment.startDate,
    endDate: assignment.endDate,
    status: assignment.status,
    trainerNotes: assignment.trainerNotes,
    daysLogged: row.daysLogged,
    lastLoggedOn: row.lastLoggedOn,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

async function readAssignment(executor: DbExecutor, id: string): Promise<WorkoutAssignmentDto> {
  const [row] = await selectAssignments(executor).where(eq(workoutAssignments.id, id)).limit(1);
  if (!row) throw notFound('Workout assignment');
  return toAssignmentDto(row);
}

/** Open assignments first, then newest. A trainer sees their assigned members' only. */
export async function listAssignments(
  query: AssignmentListQuery,
  auth: Auth,
): Promise<Paginated<WorkoutAssignmentDto>> {
  const search = query.q ? likePattern(query.q) : null;
  const where = and(
    memberScopeSql(auth, 'workouts:read', workoutAssignments.memberId),
    query.memberId ? eq(workoutAssignments.memberId, query.memberId) : undefined,
    query.planId ? eq(workoutAssignments.planId, query.planId) : undefined,
    query.trainerId ? eq(workoutAssignments.trainerId, query.trainerId) : undefined,
    query.status ? eq(workoutAssignments.status, query.status) : undefined,
    search
      ? sql`(${members.firstName} || ' ' || ${members.lastName} ilike ${search}
          or ${members.memberCode} ilike ${search} or ${workoutPlans.name} ilike ${search})`
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    selectAssignments()
      .where(where)
      .orderBy(
        sql`${workoutAssignments.status} = 'ACTIVE' desc`,
        desc(workoutAssignments.startDate),
        desc(workoutAssignments.createdAt),
      )
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ count: count() })
      .from(workoutAssignments)
      .innerJoin(workoutPlans, eq(workoutPlans.id, workoutAssignments.planId))
      .innerJoin(members, eq(members.id, workoutAssignments.memberId))
      .where(where),
  ]);
  return paginated(rows.map(toAssignmentDto), query.page, query.pageSize, total?.count ?? 0);
}

export async function getAssignment(id: string, auth: Auth): Promise<WorkoutAssignmentDto> {
  const dto = await readAssignment(db, id);
  await assertMemberInScope(auth, 'workouts:read', dto.member.id);
  return dto;
}

/**
 * Give a plan to a member. A trainer assigns only to members assigned to them, only plans they
 * can read, and is always the responsible trainer. Admin / Manager may name a trainer, who must
 * be assigned to the member.
 */
export async function createAssignment(
  input: CreateAssignment,
  auth: Auth,
  ctx: RequestContext,
): Promise<WorkoutAssignmentDto> {
  const today = gymToday();
  const startDate = input.startDate ?? today;
  if (input.endDate && input.endDate < startDate) {
    throw validationFailed([{ path: 'endDate', message: 'Must be on or after the start date' }]);
  }
  if (input.endDate && input.endDate < today) {
    throw validationFailed([{ path: 'endDate', message: 'Cannot end in the past' }]);
  }
  const trainerScoped = permissionScope(auth.user.role, 'workouts:assign') === SCOPES.ASSIGNED;
  try {
    return await db.transaction(async (tx) => {
      const member = await requireMember(tx, input.memberId);
      let trainerId: string | null;
      if (trainerScoped) {
        if (input.trainerId && input.trainerId !== auth.user.id) {
          throw forbidden('You can only assign plans as yourself.');
        }
        if (!(await isAssigned(auth.user.id, input.memberId, tx))) {
          throw forbidden('This member is not assigned to you.');
        }
        trainerId = auth.user.id;
      } else {
        trainerId = input.trainerId ?? null;
        if (trainerId) {
          await requireTrainer(tx, trainerId);
          if (!(await isAssigned(trainerId, input.memberId, tx))) {
            throw validationFailed([
              { path: 'trainerId', message: 'This trainer is not assigned to the member' },
            ]);
          }
        }
      }
      if (member.archivedAt) {
        throw conflict(ERROR_CODES.MEMBER_ARCHIVED, 'This member is archived.');
      }
      const plan = await requireVisiblePlan(tx, input.planId, auth);
      if (plan.status === 'ARCHIVED') {
        throw conflict(ERROR_CODES.WORKOUT_PLAN_ARCHIVED, 'This plan is archived.');
      }
      const [items] = await tx
        .select({ count: count() })
        .from(workoutPlanItems)
        .where(and(eq(workoutPlanItems.planId, plan.id), isNull(workoutPlanItems.removedAt)));
      if (!items?.count) {
        throw conflict(ERROR_CODES.WORKOUT_PLAN_EMPTY, 'Add exercises to this plan first.');
      }
      const [row] = await tx
        .insert(workoutAssignments)
        .values({
          planId: plan.id,
          memberId: input.memberId,
          trainerId,
          startDate,
          endDate: input.endDate,
          trainerNotes: input.trainerNotes,
          assignedBy: ctx.actorUserId,
        })
        .returning({ id: workoutAssignments.id });
      await recordAudit(tx, ctx, {
        action: 'WORKOUT_ASSIGNED',
        entityType: 'WORKOUT_ASSIGNMENT',
        entityId: row!.id,
        after: { planId: plan.id, memberId: input.memberId, trainerId, startDate },
      });
      return readAssignment(tx, row!.id);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'workout_assignments_open_key')) {
      throw conflict(ERROR_CODES.ASSIGNMENT_EXISTS, 'This member is already following this plan.');
    }
    throw error;
  }
}

/** Notes, end date, or closing (COMPLETED / CANCELLED, final). */
export async function updateAssignment(
  id: string,
  input: UpdateAssignment,
  auth: Auth,
  ctx: RequestContext,
): Promise<WorkoutAssignmentDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workoutAssignments)
      .where(eq(workoutAssignments.id, id))
      .for('update')
      .limit(1);
    if (!row) throw notFound('Workout assignment');
    await assertMemberInScope(auth, 'workouts:assign', row.memberId, tx);
    if (row.status !== 'ACTIVE') {
      throw conflict(ERROR_CODES.ASSIGNMENT_CLOSED, 'This workout plan has already been closed.');
    }
    if (input.endDate && input.endDate < row.startDate) {
      throw validationFailed([{ path: 'endDate', message: 'Must be on or after the start date' }]);
    }
    const diff = diffFields(row, input);
    if (Object.keys(diff.after).length > 0) {
      await tx
        .update(workoutAssignments)
        .set(diff.after as Partial<typeof workoutAssignments.$inferInsert>)
        .where(eq(workoutAssignments.id, id));
      await recordAudit(tx, ctx, {
        action: 'WORKOUT_ASSIGNMENT_UPDATED',
        entityType: 'WORKOUT_ASSIGNMENT',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
    }
    return readAssignment(tx, id);
  });
}

// --- Logs -------------------------------------------------------------------------------------

const logItem = alias(workoutPlanItems, 'log_item');
const logExercise = alias(exercises, 'log_exercise');
const logUser = alias(users, 'log_user');

function selectLogs(executor: DbExecutor = db) {
  return executor
    .select({
      log: workoutLogs,
      exerciseName: logExercise.name,
      loggedByFirstName: logUser.firstName,
      loggedByLastName: logUser.lastName,
    })
    .from(workoutLogs)
    .leftJoin(logItem, eq(logItem.id, workoutLogs.planItemId))
    .leftJoin(logExercise, eq(logExercise.id, logItem.exerciseId))
    .leftJoin(logUser, eq(logUser.id, workoutLogs.loggedBy));
}

function toLogDto(row: Awaited<ReturnType<typeof selectLogs>>[number]): WorkoutLogDto {
  const { log } = row;
  return {
    id: log.id,
    assignmentId: log.assignmentId,
    memberId: log.memberId,
    planItemId: log.planItemId,
    exerciseName: row.exerciseName,
    performedOn: log.performedOn,
    completed: log.completed,
    actualSets: log.actualSets,
    actualReps: log.actualReps,
    actualLoad: log.actualLoad,
    actualDurationSeconds: log.actualDurationSeconds,
    notes: log.notes,
    loggedByName: row.loggedByFirstName ? `${row.loggedByFirstName} ${row.loggedByLastName}` : null,
    createdAt: log.createdAt.toISOString(),
  };
}

async function listLogsWhere(where: SQL | undefined, query: LogListQuery) {
  const [rows, [total]] = await Promise.all([
    selectLogs()
      .where(where)
      .orderBy(desc(workoutLogs.performedOn), asc(logItem.dayNumber), asc(logItem.position))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ count: count() }).from(workoutLogs).where(where),
  ]);
  return paginated(rows.map(toLogDto), query.page, query.pageSize, total?.count ?? 0);
}

const logFilters = (query: LogListQuery) => [
  query.assignmentId ? eq(workoutLogs.assignmentId, query.assignmentId) : undefined,
  query.from ? gte(workoutLogs.performedOn, query.from) : undefined,
  query.to ? lte(workoutLogs.performedOn, query.to) : undefined,
];

export async function listLogs(query: LogListQuery, auth: Auth): Promise<Paginated<WorkoutLogDto>> {
  return listLogsWhere(
    and(
      memberScopeSql(auth, 'workouts:read', workoutLogs.memberId),
      query.memberId ? eq(workoutLogs.memberId, query.memberId) : undefined,
      ...logFilters(query),
    ),
    query,
  );
}

/** Who is logging: staff (scoped by `workouts:log`) or the member themself. */
export type LogActor = { kind: 'staff'; auth: Auth } | { kind: 'member'; memberId: string };

/**
 * Record a day's work against an open assignment. Re-logging the same exercise on the same day
 * updates that entry. Logs are activity, not configuration, so they are not audited.
 */
export async function logWorkout(
  input: LogWorkout,
  actor: LogActor,
  ctx: RequestContext,
): Promise<WorkoutLogDto[]> {
  const today = gymToday();
  const performedOn = input.performedOn ?? today;
  if (performedOn > today) {
    throw validationFailed([{ path: 'performedOn', message: 'Cannot be in the future' }]);
  }
  const itemIds = input.entries.map((entry) => entry.planItemId).filter(Boolean) as string[];
  const repeated = itemIds.findIndex((itemId, index) => itemIds.indexOf(itemId) !== index);
  if (repeated >= 0) {
    throw validationFailed([
      { path: `entries.${repeated}.planItemId`, message: 'Each exercise can be logged once' },
    ]);
  }
  const ids = await db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(workoutAssignments)
      .where(eq(workoutAssignments.id, input.assignmentId))
      .limit(1);
    if (!assignment) throw notFound('Workout');
    if (actor.kind === 'member') {
      if (assignment.memberId !== actor.memberId) throw notFound('Workout');
    } else {
      await assertMemberInScope(actor.auth, 'workouts:log', assignment.memberId, tx);
    }
    if (assignment.status !== 'ACTIVE') {
      throw conflict(ERROR_CODES.ASSIGNMENT_CLOSED, 'This workout plan has been closed.');
    }
    if (performedOn < assignment.startDate) {
      throw validationFailed([{ path: 'performedOn', message: 'Before this plan started' }]);
    }
    if (assignment.endDate && performedOn > assignment.endDate) {
      throw validationFailed([{ path: 'performedOn', message: 'After this plan ended' }]);
    }
    if (itemIds.length > 0) {
      const items = await tx
        .select({ id: workoutPlanItems.id })
        .from(workoutPlanItems)
        .where(
          and(
            inArray(workoutPlanItems.id, itemIds),
            eq(workoutPlanItems.planId, assignment.planId),
            isNull(workoutPlanItems.removedAt),
          ),
        );
      const valid = new Set(items.map((item) => item.id));
      const invalid = input.entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.planItemId && !valid.has(entry.planItemId));
      if (invalid.length > 0) {
        throw validationFailed(
          invalid.map(({ index }) => ({
            path: `entries.${index}.planItemId`,
            message: 'Not part of this plan',
          })),
        );
      }
    }
    const saved: string[] = [];
    for (const entry of input.entries) {
      const values = {
        completed: entry.completed,
        actualSets: entry.actualSets ?? null,
        actualReps: entry.actualReps ?? null,
        actualLoad: entry.actualLoad,
        actualDurationSeconds: entry.actualDurationSeconds ?? null,
        notes: entry.notes,
        loggedBy: ctx.actorUserId,
      };
      const insert = tx.insert(workoutLogs).values({
        assignmentId: assignment.id,
        memberId: assignment.memberId,
        planItemId: entry.planItemId ?? null,
        performedOn,
        ...values,
      });
      const [row] = entry.planItemId
        ? await insert
            .onConflictDoUpdate({
              target: [workoutLogs.assignmentId, workoutLogs.planItemId, workoutLogs.performedOn],
              targetWhere: sql`plan_item_id is not null`,
              set: { ...values, updatedAt: new Date() },
            })
            .returning({ id: workoutLogs.id })
        : await insert.returning({ id: workoutLogs.id });
      saved.push(row!.id);
    }
    return saved;
  });
  const rows = await selectLogs()
    .where(inArray(workoutLogs.id, ids))
    .orderBy(asc(logItem.dayNumber), asc(logItem.position));
  return rows.map(toLogDto);
}

// --- Progress ---------------------------------------------------------------------------------

const progressUser = alias(users, 'progress_user');

function toProgressDto(
  row: typeof progressEntries.$inferSelect,
  firstName: string | null,
  lastName: string | null,
): ProgressEntryDto {
  return {
    id: row.id,
    memberId: row.memberId,
    recordedOn: row.recordedOn,
    weightKg: row.weightKg,
    bodyFatPct: row.bodyFatPct,
    measurements: row.measurements,
    notes: row.notes,
    recordedByName: firstName ? `${firstName} ${lastName}` : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The most recent entries, oldest first (chart order). */
async function progressHistory(memberId: string): Promise<ProgressEntryDto[]> {
  const rows = await db
    .select({
      entry: progressEntries,
      firstName: progressUser.firstName,
      lastName: progressUser.lastName,
    })
    .from(progressEntries)
    .leftJoin(progressUser, eq(progressUser.id, progressEntries.recordedBy))
    .where(eq(progressEntries.memberId, memberId))
    .orderBy(desc(progressEntries.recordedOn), desc(progressEntries.createdAt))
    .limit(WORKOUT_LIMITS.progressHistoryMax);
  return rows.reverse().map((row) => toProgressDto(row.entry, row.firstName, row.lastName));
}

async function insertProgress(memberId: string, input: RecordProgress, ctx: RequestContext) {
  const today = gymToday();
  const recordedOn = input.recordedOn ?? today;
  if (recordedOn > today) {
    throw validationFailed([{ path: 'recordedOn', message: 'Cannot be in the future' }]);
  }
  const measurements: BodyMeasurements = Object.fromEntries(
    Object.entries(input.measurements ?? {}).filter(([, value]) => (value ?? null) !== null),
  );
  return db.transaction(async (tx) => {
    const member = await requireMember(tx, memberId);
    if (member.archivedAt) {
      throw conflict(ERROR_CODES.MEMBER_ARCHIVED, 'This member is archived.');
    }
    const [row] = await tx
      .insert(progressEntries)
      .values({
        memberId,
        recordedOn,
        weightKg: input.weightKg ?? null,
        bodyFatPct: input.bodyFatPct ?? null,
        measurements,
        notes: input.notes,
        recordedBy: ctx.actorUserId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: 'PROGRESS_RECORDED',
      entityType: 'PROGRESS_ENTRY',
      entityId: row!.id,
      after: {
        memberId,
        recordedOn,
        fields: [
          ...(row!.weightKg !== null ? ['weightKg'] : []),
          ...(row!.bodyFatPct !== null ? ['bodyFatPct'] : []),
          ...Object.keys(measurements),
        ],
      },
    });
    const [actor] = ctx.actorUserId
      ? await tx
          .select({ firstName: users.firstName, lastName: users.lastName })
          .from(users)
          .where(eq(users.id, ctx.actorUserId))
          .limit(1)
      : [];
    return toProgressDto(row!, actor?.firstName ?? null, actor?.lastName ?? null);
  });
}

export async function listMemberProgress(memberId: string, auth: Auth) {
  await requireMember(db, memberId);
  await assertMemberInScope(auth, 'progress:read', memberId);
  return progressHistory(memberId);
}

export async function recordMemberProgress(
  memberId: string,
  input: RecordProgress,
  auth: Auth,
  ctx: RequestContext,
): Promise<ProgressEntryDto> {
  await requireMember(db, memberId);
  await assertMemberInScope(auth, 'progress:record', memberId);
  return insertProgress(memberId, input, ctx);
}

// --- Portal (/me) -----------------------------------------------------------------------------

const ownMemberId = async (userId: string) => (await requireOwnRow(db, userId)).id;

/** The member's plans: open ones first, then the most recently closed. */
export async function listMyWorkouts(userId: string): Promise<MyWorkoutDto[]> {
  const memberId = await ownMemberId(userId);
  const rows = await selectAssignments()
    .where(eq(workoutAssignments.memberId, memberId))
    .orderBy(
      sql`${workoutAssignments.status} = 'ACTIVE' desc`,
      desc(workoutAssignments.startDate),
      desc(workoutAssignments.createdAt),
    )
    .limit(20);
  const plans = await Promise.all(
    rows.map(async (row) => {
      const [plan] = await selectPlans().where(eq(workoutPlans.id, row.assignment.planId)).limit(1);
      return { plan: plan!, items: await planItems(db, row.assignment.planId, MEMBER_IMAGE_BASE) };
    }),
  );
  return rows.map((row, index) => {
    const dto = toAssignmentDto(row);
    const { plan, items } = plans[index]!;
    const {
      owner: _owner,
      activeAssignments: _active,
      isTemplate: _template,
      ...planFields
    } = toPlanDto(plan);
    return {
      assignmentId: dto.id,
      status: dto.status,
      startDate: dto.startDate,
      endDate: dto.endDate,
      trainerNotes: dto.trainerNotes,
      trainer: dto.trainer,
      plan: { ...planFields, items },
      daysLogged: dto.daysLogged,
      lastLoggedOn: dto.lastLoggedOn,
    };
  });
}

export async function listMyLogs(
  userId: string,
  query: LogListQuery,
): Promise<Paginated<WorkoutLogDto>> {
  const memberId = await ownMemberId(userId);
  return listLogsWhere(and(eq(workoutLogs.memberId, memberId), ...logFilters(query)), query);
}

export async function logMyWorkout(
  userId: string,
  input: LogWorkout,
  ctx: RequestContext,
): Promise<WorkoutLogDto[]> {
  return logWorkout(input, { kind: 'member', memberId: await ownMemberId(userId) }, ctx);
}

export async function listMyProgress(userId: string): Promise<ProgressEntryDto[]> {
  return progressHistory(await ownMemberId(userId));
}

export async function recordMyProgress(
  userId: string,
  input: RecordProgress,
  ctx: RequestContext,
): Promise<ProgressEntryDto> {
  return insertProgress(await ownMemberId(userId), input, ctx);
}

/** Only exercises that appear in one of the member's own plans (VIA_ASSIGNED_PLANS). */
export async function readMyExerciseImage(userId: string, exerciseId: string) {
  const memberId = await ownMemberId(userId);
  const [row] = await db
    .select({ imageKey: exercises.imageKey })
    .from(exercises)
    .where(
      and(
        eq(exercises.id, exerciseId),
        sql`exists (select 1 from workout_plan_items i
          join workout_assignments wa on wa.plan_id = i.plan_id
          where i.exercise_id = ${qualified(exercises.id)} and wa.member_id = ${memberId})`,
      ),
    )
    .limit(1);
  const image = row?.imageKey ? await readImage(row.imageKey) : null;
  if (!image) throw notFound('Image');
  return image;
}
