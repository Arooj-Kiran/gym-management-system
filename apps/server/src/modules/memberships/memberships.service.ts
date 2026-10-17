import {
  addDays,
  computeEndDate,
  CURRENT_MEMBERSHIP_STATUSES,
  effectiveMembershipStatus,
  ERROR_CODES,
  MEMBERSHIP_LIMITS,
  MEMBERSHIP_STATUS_LABELS,
  membershipActions,
  renewalStartDate,
  suspendedDays,
  type AuditAction,
  type MembershipAction,
  type MembershipDto,
  type MembershipEventDto,
  type MembershipEventType,
  type MembershipStatus,
  type activateMembershipSchema,
  type assignMembershipSchema,
  type membershipListQuerySchema,
} from '@gms/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  max,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { members, membershipEvents, membershipPlans, memberships, users } from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { gymToday } from '../../lib/dates';
import { isExclusionViolation } from '../../lib/db-errors';
import { conflict, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import type { RequestContext } from '../../lib/request-context';
import { memberPhotoUrl } from '../members/members.service';
import { effectiveStatusSql, expiringSoonSql } from './current-membership';
import type { MembershipReadScope } from './memberships.policy';

type AssignMembership = z.output<typeof assignMembershipSchema>;
type MembershipListQuery = z.output<typeof membershipListQuerySchema>;
type MembershipRow = typeof memberships.$inferSelect;
type Versioned = z.output<typeof activateMembershipSchema>;

const OVERLAP_CONSTRAINT = 'memberships_no_overlap';

/** Postgres returns TIME as HH:MM:SS; the API speaks HH:MM. */
const hhmm = (value: string | null) => value?.slice(0, 5) ?? null;

const memberRefColumns = {
  memberCode: members.memberCode,
  memberFirstName: members.firstName,
  memberLastName: members.lastName,
  memberPhotoKey: members.profilePhotoKey,
};

type MembershipWithMember = MembershipRow & {
  memberCode: string;
  memberFirstName: string;
  memberLastName: string;
  memberPhotoKey: string | null;
};

function toDto(row: MembershipWithMember, today = gymToday()): MembershipDto {
  return {
    id: row.id,
    memberId: row.memberId,
    planId: row.planId,
    planName: row.planNameSnapshot,
    priceMinor: row.priceMinorSnapshot,
    accessDays: row.accessDaysSnapshot,
    accessStartTime: hhmm(row.accessStartTimeSnapshot),
    accessEndTime: hhmm(row.accessEndTimeSnapshot),
    status: row.status,
    effectiveStatus: effectiveMembershipStatus(row, today),
    startDate: row.startDate,
    endDate: row.endDate,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    suspendedAt: row.suspendedAt?.toISOString() ?? null,
    suspensionReason: row.suspensionReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    totalSuspendedDays: row.totalSuspendedDays,
    renewedFromId: row.renewedFromId,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    member: {
      id: row.memberId,
      memberCode: row.memberCode,
      firstName: row.memberFirstName,
      lastName: row.memberLastName,
      photoUrl: memberPhotoUrl(`/api/v1/members/${row.memberId}/photo`, row.memberPhotoKey),
    },
  };
}

function selectWithMember(executor: DbExecutor) {
  return executor
    .select({ ...getTableColumns(memberships), ...memberRefColumns })
    .from(memberships)
    .innerJoin(members, eq(members.id, memberships.memberId));
}

async function readDto(executor: DbExecutor, id: string) {
  const [row] = await selectWithMember(executor).where(eq(memberships.id, id)).limit(1);
  if (!row) throw notFound('Membership');
  return toDto(row);
}

/** Locks the membership row for the rest of the transaction. */
async function lockMembership(tx: DbExecutor, id: string, version?: number) {
  const [row] = await tx
    .select()
    .from(memberships)
    .where(eq(memberships.id, id))
    .limit(1)
    .for('update');
  if (!row) throw notFound('Membership');
  if (version !== undefined && version !== row.version) {
    throw conflict(
      ERROR_CODES.STALE_VERSION,
      'Someone else changed this membership a moment ago. Reload it and try again.',
      { currentVersion: row.version },
    );
  }
  return row;
}

/** Serializes date-changing work on one member's memberships (assign, renew, extend…). */
async function lockMemberMemberships(tx: DbExecutor, memberId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`member-memberships:${memberId}`}))`,
  );
}

async function requireCurrentMember(tx: DbExecutor, memberId: string) {
  const [member] = await tx
    .select({ id: members.id, archivedAt: members.archivedAt })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw notFound('Member');
  if (member.archivedAt) {
    throw conflict(
      ERROR_CODES.MEMBER_ARCHIVED,
      'This member is archived. Restore them before changing their membership.',
    );
  }
  return member;
}

async function requireAssignablePlan(tx: DbExecutor, planId: string) {
  const [plan] = await tx
    .select()
    .from(membershipPlans)
    .where(eq(membershipPlans.id, planId))
    .limit(1);
  if (!plan) throw notFound('Plan');
  if (!plan.isActive) {
    throw conflict(
      ERROR_CODES.PLAN_ARCHIVED,
      `"${plan.name}" is archived and cannot be assigned. Choose an active plan.`,
    );
  }
  return plan;
}

const ACTION_VERBS: Record<MembershipAction, string> = {
  activate: 'activated',
  renew: 'renewed',
  extend: 'extended',
  suspend: 'suspended',
  reactivate: 'reactivated',
  cancel: 'cancelled',
};

function assertAction(row: MembershipRow, action: MembershipAction) {
  if (!membershipActions(row.status).includes(action)) {
    throw conflict(
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      `A ${MEMBERSHIP_STATUS_LABELS[row.status].toLowerCase()} membership cannot be ${ACTION_VERBS[action]}.`,
      { status: row.status },
    );
  }
}

const overlapError = (existing?: {
  id: string;
  planName: string;
  status: MembershipStatus;
  startDate: string;
  endDate: string;
}) =>
  conflict(
    ERROR_CODES.MEMBERSHIP_OVERLAP,
    existing
      ? `These dates overlap the member's ${MEMBERSHIP_STATUS_LABELS[existing.status].toLowerCase()} ${existing.planName} membership (${existing.startDate} to ${existing.endDate}).`
      : "These dates overlap another of the member's pending, active or suspended memberships.",
    { existing: existing ?? null },
  );

/** Friendly pre-check; the exclusion constraint is the real guarantee. */
async function assertNoOverlap(
  tx: DbExecutor,
  memberId: string,
  startDate: string,
  endDate: string,
  excludeId?: string,
) {
  const [existing] = await tx
    .select({
      id: memberships.id,
      planName: memberships.planNameSnapshot,
      status: memberships.status,
      startDate: memberships.startDate,
      endDate: memberships.endDate,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.memberId, memberId),
        inArray(memberships.status, [...CURRENT_MEMBERSHIP_STATUSES]),
        lte(memberships.startDate, endDate),
        gte(memberships.endDate, startDate),
        excludeId ? ne(memberships.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  if (existing) throw overlapError(existing);
}

/** Maps a lost race on the exclusion constraint to the same 409 the pre-check gives. */
async function withOverlapGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isExclusionViolation(error, OVERLAP_CONSTRAINT)) throw overlapError();
    throw error;
  }
}

interface ChangeRecord {
  membership: Pick<MembershipRow, 'id' | 'memberId'>;
  eventType: MembershipEventType;
  auditAction: AuditAction;
  fromStatus: MembershipStatus | null;
  toStatus: MembershipStatus;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
}

/** Every change writes one history event and one audit row, inside the caller's transaction. */
export async function recordChange(tx: DbExecutor, ctx: RequestContext, change: ChangeRecord) {
  const reason = change.reason?.trim() || null;
  await tx.insert(membershipEvents).values({
    membershipId: change.membership.id,
    memberId: change.membership.memberId,
    eventType: change.eventType,
    fromStatus: change.fromStatus,
    toStatus: change.toStatus,
    oldValues: change.oldValues ?? null,
    newValues: change.newValues ?? null,
    reason,
    actorUserId: ctx.actorUserId,
  });
  await recordAudit(tx, ctx, {
    action: change.auditAction,
    entityType: 'MEMBERSHIP',
    entityId: change.membership.id,
    before: change.fromStatus
      ? { status: change.fromStatus, ...(change.oldValues ?? {}) }
      : (change.oldValues ?? null),
    after: { memberId: change.membership.memberId, status: change.toStatus, ...change.newValues },
    reason,
  });
}

function assertStartDateInRange(startDate: string, today: string) {
  const earliest = addDays(today, -MEMBERSHIP_LIMITS.maxBackdateDays);
  const latest = addDays(today, MEMBERSHIP_LIMITS.maxAdvanceDays);
  if (startDate < earliest || startDate > latest) {
    throw validationFailed([
      {
        path: 'startDate',
        message: `Choose a start date between ${earliest} and ${latest}`,
      },
    ]);
  }
}

// --- Reads --------------------------------------------------------------------------------

const SORTS = {
  endDate: { columns: [memberships.endDate, memberships.startDate], order: 'asc' },
  startDate: { columns: [memberships.startDate, memberships.endDate], order: 'desc' },
  createdAt: { columns: [memberships.createdAt], order: 'desc' },
  memberName: { columns: [members.lastName, members.firstName], order: 'asc' },
} as const;

/** Memberships of current (not archived) members; archived members keep theirs as history. */
export async function listMemberships(query: MembershipListQuery, scope: MembershipReadScope) {
  // Trainers see assigned members only; none exist until Stage 6 adds assignments.
  if (scope.kind === 'assigned') return paginated([], query.page, query.pageSize, 0);

  const today = gymToday();
  const filters: (SQL | undefined)[] = [isNull(members.archivedAt)];
  if (query.memberId) filters.push(eq(memberships.memberId, query.memberId));
  if (query.planId) filters.push(eq(memberships.planId, query.planId));
  if (query.status)
    filters.push(sql`${effectiveStatusSql('memberships', today)} = ${query.status}`);
  if (query.expiringWithinDays !== undefined) {
    filters.push(expiringSoonSql('memberships', today, query.expiringWithinDays));
  }
  if (query.from) filters.push(gte(memberships.endDate, query.from));
  if (query.to) filters.push(lte(memberships.startDate, query.to));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(
        ilike(sql`${members.firstName} || ' ' || ${members.lastName}`, pattern),
        ilike(members.memberCode, pattern),
        ilike(memberships.planNameSnapshot, pattern),
      ),
    );
  }
  const where = and(...filters);
  const sort = SORTS[query.sort];
  const direction = (query.order ?? sort.order) === 'asc' ? asc : desc;

  const [rows, [totals]] = await Promise.all([
    selectWithMember(db)
      .where(where)
      .orderBy(...sort.columns.map((column) => direction(column)), asc(memberships.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(memberships)
      .innerJoin(members, eq(members.id, memberships.memberId))
      .where(where),
  ]);
  return paginated(
    rows.map((row) => toDto(row, today)),
    query.page,
    query.pageSize,
    totals?.total ?? 0,
  );
}

export async function getMembership(id: string): Promise<MembershipDto> {
  return readDto(db, id);
}

/** The member ID of a membership, for object-level permission checks. */
export async function membershipMemberId(id: string): Promise<string> {
  const [row] = await db
    .select({ memberId: memberships.memberId })
    .from(memberships)
    .where(eq(memberships.id, id))
    .limit(1);
  if (!row) throw notFound('Membership');
  return row.memberId;
}

/** A member's whole membership history, newest period first. */
export async function listMemberMemberships(memberId: string): Promise<MembershipDto[]> {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw notFound('Member');
  const today = gymToday();
  const rows = await selectWithMember(db)
    .where(eq(memberships.memberId, memberId))
    .orderBy(desc(memberships.startDate), desc(memberships.createdAt));
  return rows.map((row) => toDto(row, today));
}

const actor = alias(users, 'actor');

async function listEvents(where: SQL): Promise<MembershipEventDto[]> {
  const rows = await db
    .select({
      ...getTableColumns(membershipEvents),
      planName: memberships.planNameSnapshot,
      actorFirstName: actor.firstName,
      actorLastName: actor.lastName,
    })
    .from(membershipEvents)
    .innerJoin(memberships, eq(memberships.id, membershipEvents.membershipId))
    .leftJoin(actor, eq(actor.id, membershipEvents.actorUserId))
    .where(where)
    .orderBy(desc(membershipEvents.createdAt), desc(membershipEvents.id))
    .limit(500);
  return rows.map((row) => ({
    id: row.id,
    membershipId: row.membershipId,
    planName: row.planName,
    eventType: row.eventType,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    oldValues: row.oldValues,
    newValues: row.newValues,
    reason: row.reason,
    actorName: row.actorFirstName ? `${row.actorFirstName} ${row.actorLastName}` : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listMembershipEvents(membershipId: string) {
  await membershipMemberId(membershipId);
  return listEvents(eq(membershipEvents.membershipId, membershipId));
}

export async function listMemberMembershipEvents(memberId: string) {
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  if (!member) throw notFound('Member');
  return listEvents(eq(membershipEvents.memberId, memberId));
}

// --- Writes -------------------------------------------------------------------------------

/** Assign a plan: a PENDING membership with server-computed dates and a price snapshot. */
export async function assignMembership(
  input: AssignMembership,
  ctx: RequestContext,
): Promise<MembershipDto> {
  const today = gymToday();
  const startDate = input.startDate ?? today;
  assertStartDateInRange(startDate, today);

  return withOverlapGuard(() =>
    db.transaction(async (tx) => {
      await lockMemberMemberships(tx, input.memberId);
      await requireCurrentMember(tx, input.memberId);
      const plan = await requireAssignablePlan(tx, input.planId);
      const endDate = computeEndDate(startDate, plan.durationValue, plan.durationUnit);
      await assertNoOverlap(tx, input.memberId, startDate, endDate);

      const [created] = await tx
        .insert(memberships)
        .values({
          memberId: input.memberId,
          planId: plan.id,
          planNameSnapshot: plan.name,
          priceMinorSnapshot: plan.priceMinor,
          accessDaysSnapshot: plan.accessDays,
          accessStartTimeSnapshot: plan.accessStartTime,
          accessEndTimeSnapshot: plan.accessEndTime,
          startDate,
          endDate,
          status: 'PENDING',
          createdBy: ctx.actorUserId,
        })
        .returning();
      await recordChange(tx, ctx, {
        membership: created!,
        eventType: 'CREATED',
        auditAction: 'MEMBERSHIP_ASSIGNED',
        fromStatus: null,
        toStatus: 'PENDING',
        newValues: {
          planId: plan.id,
          planName: plan.name,
          priceMinor: plan.priceMinor,
          startDate,
          endDate,
        },
      });
      return readDto(tx, created!.id);
    }),
  );
}

/**
 * PENDING → ACTIVE. The C1 payment policy needs invoices (Stage 5); until then activation
 * behaves like the default setting (OFF) and is always allowed.
 */
export async function activateMembership(id: string, input: Versioned, ctx: RequestContext) {
  return db.transaction(async (tx) => {
    const row = await lockMembership(tx, id, input.version);
    assertAction(row, 'activate');
    await requireCurrentMember(tx, row.memberId);
    if (row.endDate < gymToday()) {
      throw conflict(
        ERROR_CODES.MEMBERSHIP_PERIOD_ENDED,
        `This membership's period ended on ${row.endDate}. Cancel it and assign a new one.`,
      );
    }
    await tx
      .update(memberships)
      .set({
        status: 'ACTIVE',
        activatedAt: new Date(),
        activatedBy: ctx.actorUserId,
        version: row.version + 1,
      })
      .where(eq(memberships.id, id));
    await recordChange(tx, ctx, {
      membership: row,
      eventType: 'ACTIVATED',
      auditAction: 'MEMBERSHIP_ACTIVATED',
      fromStatus: row.status,
      toStatus: 'ACTIVE',
      newValues: { startDate: row.startDate, endDate: row.endDate },
      reason: input.reason,
    });
    return readDto(tx, id);
  });
}

/**
 * Renewal creates a new period linked by renewed_from_id; the old row and everything tied to it
 * stay untouched. It starts the day after the member's latest current end date (or today).
 * With the C1 policy OFF (the only behaviour until Stage 5) the renewal is active at once.
 */
export async function renewMembership(
  id: string,
  input: Versioned & { planId?: string },
  ctx: RequestContext,
): Promise<MembershipDto> {
  return withOverlapGuard(() =>
    db.transaction(async (tx) => {
      const source = await lockMembership(tx, id, input.version);
      assertAction(source, 'renew');
      await lockMemberMemberships(tx, source.memberId);
      await requireCurrentMember(tx, source.memberId);

      const [later] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.memberId, source.memberId),
            ne(memberships.id, source.id),
            ne(memberships.status, 'CANCELLED'),
            sql`${memberships.startDate} > ${source.startDate}`,
          ),
        )
        .limit(1);
      if (later) {
        throw conflict(
          ERROR_CODES.NOT_LATEST_MEMBERSHIP,
          'This member already has a later membership. Renew from the latest one.',
        );
      }

      const plan = await requireAssignablePlan(tx, input.planId ?? source.planId);
      const [latest] = await tx
        .select({ endDate: max(memberships.endDate) })
        .from(memberships)
        .where(
          and(
            eq(memberships.memberId, source.memberId),
            inArray(memberships.status, [...CURRENT_MEMBERSHIP_STATUSES]),
          ),
        );
      const today = gymToday();
      const startDate = renewalStartDate(latest?.endDate ?? null, today);
      const endDate = computeEndDate(startDate, plan.durationValue, plan.durationUnit);
      await assertNoOverlap(tx, source.memberId, startDate, endDate);

      const [created] = await tx
        .insert(memberships)
        .values({
          memberId: source.memberId,
          planId: plan.id,
          planNameSnapshot: plan.name,
          priceMinorSnapshot: plan.priceMinor,
          accessDaysSnapshot: plan.accessDays,
          accessStartTimeSnapshot: plan.accessStartTime,
          accessEndTimeSnapshot: plan.accessEndTime,
          startDate,
          endDate,
          status: 'ACTIVE',
          activatedAt: new Date(),
          activatedBy: ctx.actorUserId,
          renewedFromId: source.id,
          createdBy: ctx.actorUserId,
        })
        .returning();
      await recordChange(tx, ctx, {
        membership: created!,
        eventType: 'RENEWED',
        auditAction: 'MEMBERSHIP_RENEWED',
        fromStatus: null,
        toStatus: 'ACTIVE',
        oldValues: {
          renewedFromId: source.id,
          previousPlanName: source.planNameSnapshot,
          previousEndDate: source.endDate,
          previousStatus: source.status,
        },
        newValues: {
          planId: plan.id,
          planName: plan.name,
          priceMinor: plan.priceMinor,
          startDate,
          endDate,
        },
        reason: input.reason,
      });
      return readDto(tx, created!.id);
    }),
  );
}

/** Adds days to the end date; the status does not change. */
export async function extendMembership(
  id: string,
  input: Versioned & { days: number; reason: string },
  ctx: RequestContext,
) {
  return withOverlapGuard(() =>
    db.transaction(async (tx) => {
      const row = await lockMembership(tx, id, input.version);
      assertAction(row, 'extend');
      await lockMemberMemberships(tx, row.memberId);
      await requireCurrentMember(tx, row.memberId);
      const endDate = addDays(row.endDate, input.days);
      await assertNoOverlap(tx, row.memberId, row.startDate, endDate, row.id);
      await tx
        .update(memberships)
        .set({ endDate, version: row.version + 1 })
        .where(eq(memberships.id, id));
      await recordChange(tx, ctx, {
        membership: row,
        eventType: 'EXTENDED',
        auditAction: 'MEMBERSHIP_EXTENDED',
        fromStatus: row.status,
        toStatus: row.status,
        oldValues: { endDate: row.endDate },
        newValues: { endDate, days: input.days },
        reason: input.reason,
      });
      return readDto(tx, id);
    }),
  );
}

/** ACTIVE → SUSPENDED. A suspended membership is never eligible for entry. */
export async function suspendMembership(
  id: string,
  input: Versioned & { reason: string },
  ctx: RequestContext,
) {
  return db.transaction(async (tx) => {
    const row = await lockMembership(tx, id, input.version);
    assertAction(row, 'suspend');
    await requireCurrentMember(tx, row.memberId);
    if (row.endDate < gymToday()) {
      throw conflict(
        ERROR_CODES.MEMBERSHIP_PERIOD_ENDED,
        `This membership's period ended on ${row.endDate}, so there is nothing left to suspend.`,
      );
    }
    await tx
      .update(memberships)
      .set({
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspensionReason: input.reason,
        version: row.version + 1,
      })
      .where(eq(memberships.id, id));
    await recordChange(tx, ctx, {
      membership: row,
      eventType: 'SUSPENDED',
      auditAction: 'MEMBERSHIP_SUSPENDED',
      fromStatus: row.status,
      toStatus: 'SUSPENDED',
      newValues: { endDate: row.endDate },
      reason: input.reason,
    });
    return readDto(tx, id);
  });
}

/**
 * SUSPENDED → ACTIVE. The days spent suspended (suspension day up to, not including, today) are
 * always added to total_suspended_days; with `extendBySuspendedDays` they also move the end date.
 */
export async function reactivateMembership(
  id: string,
  input: Versioned & { reason: string; extendBySuspendedDays: boolean },
  ctx: RequestContext,
) {
  return withOverlapGuard(() =>
    db.transaction(async (tx) => {
      const row = await lockMembership(tx, id, input.version);
      assertAction(row, 'reactivate');
      await lockMemberMemberships(tx, row.memberId);
      await requireCurrentMember(tx, row.memberId);
      const today = gymToday();
      const days = row.suspendedAt ? suspendedDays(gymToday(row.suspendedAt), today) : 0;
      const endDate =
        input.extendBySuspendedDays && days > 0 ? addDays(row.endDate, days) : row.endDate;
      if (endDate !== row.endDate) {
        await assertNoOverlap(tx, row.memberId, row.startDate, endDate, row.id);
      }
      await tx
        .update(memberships)
        .set({
          status: 'ACTIVE',
          suspendedAt: null,
          suspensionReason: null,
          totalSuspendedDays: row.totalSuspendedDays + days,
          endDate,
          version: row.version + 1,
        })
        .where(eq(memberships.id, id));
      await recordChange(tx, ctx, {
        membership: row,
        eventType: 'REACTIVATED',
        auditAction: 'MEMBERSHIP_REACTIVATED',
        fromStatus: row.status,
        toStatus: 'ACTIVE',
        oldValues: {
          endDate: row.endDate,
          suspendedAt: row.suspendedAt?.toISOString() ?? null,
          suspensionReason: row.suspensionReason,
        },
        newValues: {
          endDate,
          suspendedDays: days,
          extendedBySuspendedDays: endDate !== row.endDate,
        },
        reason: input.reason,
      });
      return readDto(tx, id);
    }),
  );
}

/** Cancellation takes effect immediately; history, payments and attendance are kept. */
export async function cancelMembership(
  id: string,
  input: Versioned & { reason: string },
  ctx: RequestContext,
) {
  return db.transaction(async (tx) => {
    const row = await lockMembership(tx, id, input.version);
    assertAction(row, 'cancel');
    await tx
      .update(memberships)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: ctx.actorUserId,
        cancellationReason: input.reason,
        suspendedAt: null,
        suspensionReason: null,
        version: row.version + 1,
      })
      .where(eq(memberships.id, id));
    await recordChange(tx, ctx, {
      membership: row,
      eventType: 'CANCELLED',
      auditAction: 'MEMBERSHIP_CANCELLED',
      fromStatus: row.status,
      toStatus: 'CANCELLED',
      oldValues: row.status === 'SUSPENDED' ? { suspensionReason: row.suspensionReason } : null,
      newValues: { startDate: row.startDate, endDate: row.endDate },
      reason: input.reason,
    });
    return readDto(tx, id);
  });
}
