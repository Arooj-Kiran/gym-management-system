import {
  ERROR_CODES,
  resolvePlanRules,
  type PlanDto,
  type createPlanSchema,
  type planListQuerySchema,
  type updatePlanSchema,
} from '@gms/shared';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { membershipPlans } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';

type CreatePlan = z.output<typeof createPlanSchema>;
type UpdatePlan = z.output<typeof updatePlanSchema>;
type PlanListQuery = z.output<typeof planListQuerySchema>;
type PlanRow = typeof membershipPlans.$inferSelect;

/** Postgres returns TIME as HH:MM:SS; the API speaks HH:MM. */
const hhmm = (value: string | null) => value?.slice(0, 5) ?? null;

function toDto(row: PlanRow): PlanDto {
  return {
    id: row.id,
    name: row.name,
    planType: row.planType,
    durationValue: row.durationValue,
    durationUnit: row.durationUnit,
    priceMinor: row.priceMinor,
    description: row.description,
    benefits: row.benefits,
    allowPartialPayment: row.allowPartialPayment,
    accessDays: row.accessDays,
    accessStartTime: hhmm(row.accessStartTime),
    accessEndTime: hhmm(row.accessEndTime),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The editable shape, used for diffs and audit entries. */
function editable(row: PlanRow) {
  const { id: _id, isActive: _active, createdAt: _c, updatedAt: _u, ...fields } = toDto(row);
  return fields;
}

async function requireRow(executor: DbExecutor, id: string, forUpdate = false) {
  const query = executor.select().from(membershipPlans).where(eq(membershipPlans.id, id)).limit(1);
  const [row] = forUpdate ? await query.for('update') : await query;
  if (!row) throw notFound('Plan');
  return row;
}

function rethrowDuplicateName(error: unknown): never {
  if (isUniqueViolation(error, 'membership_plans_name_key')) {
    throw conflict(ERROR_CODES.DUPLICATE_PLAN_NAME, 'A plan with this name already exists.');
  }
  throw error;
}

const SORT_COLUMNS = {
  name: [sql`lower(${membershipPlans.name})`],
  price: [membershipPlans.priceMinor, sql`lower(${membershipPlans.name})`],
  createdAt: [membershipPlans.createdAt],
} as const;

/** Members (LIMITED scope) only ever see active plans. */
export async function listPlans(query: PlanListQuery, activeOnly: boolean) {
  const status = activeOnly ? 'active' : query.status;
  const filters: (SQL | undefined)[] = [];
  if (status !== 'all') filters.push(eq(membershipPlans.isActive, status === 'active'));
  if (query.planType) filters.push(eq(membershipPlans.planType, query.planType));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(ilike(membershipPlans.name, pattern), ilike(membershipPlans.description, pattern)),
    );
  }
  const where = and(...filters);
  const direction =
    (query.order ?? (query.sort === 'createdAt' ? 'desc' : 'asc')) === 'asc' ? asc : desc;
  const orderBy = SORT_COLUMNS[query.sort].map((column) => direction(column));

  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(membershipPlans)
      .where(where)
      .orderBy(...orderBy, asc(membershipPlans.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ total: count() }).from(membershipPlans).where(where),
  ]);
  return paginated(rows.map(toDto), query.page, query.pageSize, totals?.total ?? 0);
}

export async function getPlan(id: string, activeOnly: boolean): Promise<PlanDto> {
  const row = await requireRow(db, id);
  if (activeOnly && !row.isActive) throw notFound('Plan');
  return toDto(row);
}

export async function createPlan(input: CreatePlan, ctx: RequestContext): Promise<PlanDto> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(membershipPlans).values(input).returning();
      await recordAudit(tx, ctx, {
        action: 'PLAN_CREATED',
        entityType: 'MEMBERSHIP_PLAN',
        entityId: row!.id,
        after: editable(row!),
      });
      return toDto(row!);
    });
  } catch (error) {
    rethrowDuplicateName(error);
  }
}

/**
 * Field rules are checked on the merged plan. Switching to a fixed type without sending a
 * duration takes that type's fixed duration. Existing memberships keep their own snapshot.
 */
export async function updatePlan(
  id: string,
  input: UpdatePlan,
  ctx: RequestContext,
): Promise<PlanDto> {
  try {
    return await db.transaction(async (tx) => {
      const row = await requireRow(tx, id, true);
      const current = editable(row);
      const typeChangedToFixed =
        input.planType !== undefined &&
        input.planType !== 'CUSTOM' &&
        input.durationValue === undefined;
      const merged = {
        ...current,
        ...input,
        ...(typeChangedToFixed ? { durationValue: null, durationUnit: null } : {}),
      };
      const { plan, issues } = resolvePlanRules(merged);
      if (issues.length > 0) throw validationFailed(issues);

      const diff = diffFields(current, plan);
      if (!diff.changed) return toDto(row);
      const [updated] = await tx
        .update(membershipPlans)
        .set(diff.after as Partial<PlanRow>)
        .where(eq(membershipPlans.id, id))
        .returning();
      await recordAudit(tx, ctx, {
        action: 'PLAN_UPDATED',
        entityType: 'MEMBERSHIP_PLAN',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
      return toDto(updated!);
    });
  } catch (error) {
    rethrowDuplicateName(error);
  }
}

/** Archived plans cannot be assigned; memberships already on them are unaffected. */
export async function setPlanActive(
  id: string,
  isActive: boolean,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<PlanDto> {
  return db.transaction(async (tx) => {
    const row = await requireRow(tx, id, true);
    if (row.isActive === isActive) return toDto(row);
    const [updated] = await tx
      .update(membershipPlans)
      .set({ isActive })
      .where(eq(membershipPlans.id, id))
      .returning();
    await recordAudit(tx, ctx, {
      action: isActive ? 'PLAN_UNARCHIVED' : 'PLAN_ARCHIVED',
      entityType: 'MEMBERSHIP_PLAN',
      entityId: id,
      before: { isActive: row.isActive },
      after: { isActive },
      reason,
    });
    return toDto(updated!);
  });
}
