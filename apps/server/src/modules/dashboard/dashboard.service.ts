import {
  addDays,
  hasPermission,
  permissionScope,
  SCOPES,
  type AuditAction,
  type AuditEntityType,
  type DashboardAttendance,
  type DashboardBilling,
  type DashboardRevenue,
  type DashboardMembershipCounts,
  type DashboardActivityItem,
  type DashboardPeriod,
  type DashboardSummary,
  type DashboardTrainer,
  type ReportRange,
  type ReportSeries,
  type Role,
} from '@gms/shared';
import { and, between, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/client';
import {
  accessAttempts,
  attendanceRecords,
  auditLogs,
  invoices,
  members,
  memberships,
  payments,
  refunds,
  trainerAssignments,
  users,
} from '../../db/schema';
import { gymDayStart, gymToday } from '../../lib/dates';
import {
  effectiveInvoiceStatusSql,
  invoicePaidSql,
  invoiceRefundedSql,
  OPEN_INVOICE_STATUSES,
} from '../billing/billing.service';
import { currentEffectiveStatusSql, expiringSoonSql } from '../memberships/current-membership';
import { revenueByBucket } from '../reports/financial-reports';
import { attendanceByBucket } from '../reports/operational-reports';
import { num } from '../reports/report-sql';
import { getSettings } from '../settings/settings.service';
import { gymDateWindow, trainerScheduleItems } from '../trainers/trainers.service';

const ACTIVITY_LIMIT = 8;

/** Whole-gym member figures need unscoped member access; trainers get their own view instead. */
const seesAllMembers = (role: Role) => permissionScope(role, 'members:read') === SCOPES.ALL;
const seesAllMemberships = (role: Role) => permissionScope(role, 'memberships:read') === SCOPES.ALL;
const seesAllAttendance = (role: Role) => permissionScope(role, 'attendance:read') === SCOPES.ALL;
const seesAllPayments = (role: Role) => permissionScope(role, 'payments:read') === SCOPES.ALL;

export async function getSummary(
  role: Role,
  userId: string,
  range: ReportRange,
): Promise<DashboardSummary> {
  const [period, memberCounts, membershipCounts, attendance, billing, trainer] = await Promise.all([
    role === 'TRAINER' ? null : getPeriod(role, range),
    seesAllMembers(role) ? getMemberCounts() : null,
    seesAllMemberships(role) ? getMembershipCounts() : null,
    seesAllAttendance(role) ? getAttendanceToday() : null,
    seesAllPayments(role) ? getBilling(hasPermission(role, 'reports:financial')) : null,
    role === 'TRAINER' ? getTrainerView(userId) : null,
  ]);
  return {
    period,
    members: memberCounts,
    memberships: membershipCounts,
    attendance,
    billing,
    trainer,
  };
}

const seriesTotal = (series: ReportSeries, key: string) =>
  series.points.reduce((sum, point) => sum + (point.values[key] ?? 0), 0);

/**
 * Totals for the chosen period, from the same queries as the reports and charts so the figures
 * always agree. Revenue only with reports:financial (PLAN §4.9).
 */
async function getPeriod(role: Role, range: ReportRange): Promise<DashboardPeriod> {
  const [registrations, attendance, revenue] = await Promise.all([
    seesAllMembers(role) ? countRegistrations(range) : null,
    hasPermission(role, 'reports:operational') ? attendanceByBucket(range) : null,
    hasPermission(role, 'reports:financial') ? revenueByBucket(range) : null,
  ]);
  return {
    from: range.from,
    to: range.to,
    registrations,
    checkIns: attendance ? seriesTotal(attendance, 'checkIns') : null,
    denied: attendance ? seriesTotal(attendance, 'denied') : null,
    revenue: revenue
      ? {
          collectedMinor: seriesTotal(revenue.series, 'collected'),
          refundedMinor: seriesTotal(revenue.series, 'refunded'),
          netMinor: seriesTotal(revenue.series, 'net'),
          paymentCount: revenue.merged.reduce((sum, row) => sum + num(row.payments), 0),
        }
      : null,
  };
}

/** Archived members still count: they did register in the period (as in the report). */
async function countRegistrations(range: ReportRange) {
  const [row] = await db
    .select({ total: count() })
    .from(members)
    .where(between(members.registrationDate, range.from, range.to));
  return row?.total ?? 0;
}

const UPCOMING_DAYS = 7;

/** A trainer's own calendar for today and the week after, and how many members they coach. */
async function getTrainerView(trainerId: string): Promise<DashboardTrainer> {
  const today = gymToday();
  const options = { showPrivate: true, showShifts: true };
  const [todayItems, upcoming, [assigned]] = await Promise.all([
    trainerScheduleItems(trainerId, gymDateWindow(today, today), options),
    trainerScheduleItems(
      trainerId,
      gymDateWindow(addDays(today, 1), addDays(today, UPCOMING_DAYS)),
      options,
    ),
    db
      .select({ total: count() })
      .from(trainerAssignments)
      .innerJoin(members, eq(members.id, trainerAssignments.memberId))
      .where(
        and(
          eq(trainerAssignments.trainerId, trainerId),
          isNull(trainerAssignments.endDate),
          isNull(members.archivedAt),
        ),
      ),
  ]);
  return { today: todayItems, upcoming, assignedMembers: assigned?.total ?? 0 };
}

/**
 * Open balances for everyone who handles payments; this month's revenue (gym time) only with
 * reports:financial (PLAN §4.9).
 */
async function getBilling(withRevenue: boolean): Promise<DashboardBilling> {
  const today = gymToday();
  const status = effectiveInvoiceStatusSql(today);
  const balance = sql`greatest(0, ${invoices.amountDueMinor} - (${invoicePaidSql} - ${invoiceRefundedSql}))`;
  const [[open], revenue] = await Promise.all([
    db
      .select({
        outstandingCount: count(),
        outstandingMinor: sql<number>`coalesce(sum(${balance}), 0)::bigint`.mapWith(Number),
        overdueCount: sql<number>`count(*) filter (where ${status} = 'OVERDUE')`.mapWith(Number),
        overdueMinor:
          sql<number>`coalesce(sum(${balance}) filter (where ${status} = 'OVERDUE'), 0)::bigint`.mapWith(
            Number,
          ),
      })
      .from(invoices)
      .where(inArray(invoices.status, [...OPEN_INVOICE_STATUSES])),
    withRevenue ? getMonthRevenue(today) : null,
  ]);
  return {
    outstanding: { count: open?.outstandingCount ?? 0, amountMinor: open?.outstandingMinor ?? 0 },
    overdue: { count: open?.overdueCount ?? 0, amountMinor: open?.overdueMinor ?? 0 },
    revenue,
  };
}

/** Money collected at the counter this calendar month, less refunds paid out this month. */
async function getMonthRevenue(today: string): Promise<DashboardRevenue> {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const nextMonth =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const from = gymDayStart(`${today.slice(0, 7)}-01`);
  const to = gymDayStart(nextMonth);
  const [[collected], [refunded]] = await Promise.all([
    db
      .select({
        total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::bigint`.mapWith(Number),
        count: count(),
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'COMPLETED'),
          gte(payments.receivedAt, from),
          lt(payments.receivedAt, to),
        ),
      ),
    db
      .select({
        total: sql<number>`coalesce(sum(${refunds.amountMinor}), 0)::bigint`.mapWith(Number),
      })
      .from(refunds)
      .where(and(gte(refunds.refundedAt, from), lt(refunds.refundedAt, to))),
  ]);
  const collectedMinor = collected?.total ?? 0;
  const refundedMinor = refunded?.total ?? 0;
  return {
    month: today.slice(0, 7),
    collectedMinor,
    refundedMinor,
    netMinor: collectedMinor - refundedMinor,
    paymentCount: collected?.count ?? 0,
  };
}

const RECENT_CHECK_INS = 6;

/** Today's valid check-ins, today's denied attempts, and the latest check-ins (gym time). */
async function getAttendanceToday(): Promise<DashboardAttendance> {
  const today = gymToday();
  const start = gymDayStart(today);
  const end = gymDayStart(today, 1);
  const validToday = and(
    eq(attendanceRecords.status, 'VALID'),
    gte(attendanceRecords.checkInAt, start),
    lt(attendanceRecords.checkInAt, end),
  );
  const [[checkIns], [denied], recent] = await Promise.all([
    db.select({ total: count() }).from(attendanceRecords).where(validToday),
    db
      .select({ total: count() })
      .from(accessAttempts)
      .where(
        and(
          eq(accessAttempts.result, 'DENIED'),
          gte(accessAttempts.occurredAt, start),
          lt(accessAttempts.occurredAt, end),
        ),
      ),
    db
      .select({
        id: attendanceRecords.id,
        checkInAt: attendanceRecords.checkInAt,
        source: attendanceRecords.source,
        memberId: members.id,
        memberCode: members.memberCode,
        firstName: members.firstName,
        lastName: members.lastName,
      })
      .from(attendanceRecords)
      .innerJoin(members, eq(members.id, attendanceRecords.memberId))
      .where(validToday)
      .orderBy(desc(attendanceRecords.checkInAt), desc(attendanceRecords.id))
      .limit(RECENT_CHECK_INS),
  ]);
  return {
    checkInsToday: checkIns?.total ?? 0,
    deniedToday: denied?.total ?? 0,
    recentCheckIns: recent.map((row) => ({
      id: row.id,
      checkInAt: row.checkInAt.toISOString(),
      source: row.source,
      member: {
        id: row.memberId,
        memberCode: row.memberCode,
        firstName: row.firstName,
        lastName: row.lastName,
      },
    })),
  };
}

async function getMemberCounts() {
  const [totals] = await db
    .select({
      total: count(),
      registeredToday:
        sql<number>`count(*) filter (where ${members.registrationDate} = ${gymToday()})`.mapWith(
          Number,
        ),
    })
    .from(members)
    .where(isNull(members.archivedAt));
  return { total: totals?.total ?? 0, registeredToday: totals?.registeredToday ?? 0 };
}

/**
 * Current members by the effective status of their current membership (one count per member),
 * and the active memberships about to run out with no renewal lined up.
 */
async function getMembershipCounts(): Promise<DashboardMembershipCounts> {
  const today = gymToday();
  const { expiryReminderDays } = await getSettings();
  const status = currentEffectiveStatusSql(members.id, today);
  const countOf = (value: string) =>
    sql<number>`count(*) filter (where ${status} = ${value})`.mapWith(Number);
  const [[byStatus], [expiring]] = await Promise.all([
    db
      .select({
        active: countOf('ACTIVE'),
        pending: countOf('PENDING'),
        suspended: countOf('SUSPENDED'),
        expired: countOf('EXPIRED'),
        cancelled: countOf('CANCELLED'),
      })
      .from(members)
      .where(isNull(members.archivedAt)),
    db
      .select({ total: count() })
      .from(memberships)
      .innerJoin(members, eq(members.id, memberships.memberId))
      .where(
        and(isNull(members.archivedAt), expiringSoonSql('memberships', today, expiryReminderDays)),
      ),
  ]);
  return {
    active: byStatus?.active ?? 0,
    pending: byStatus?.pending ?? 0,
    suspended: byStatus?.suspended ?? 0,
    expired: byStatus?.expired ?? 0,
    cancelled: byStatus?.cancelled ?? 0,
    expiringSoon: expiring?.total ?? 0,
    expiringWithinDays: expiryReminderDays,
  };
}

/**
 * Recent member and membership events from the audit trail. Only who / what / when — never the before/after
 * values, which can hold contact details.
 */
export async function getActivity(role: Role): Promise<DashboardActivityItem[]> {
  if (!seesAllMembers(role)) return [];
  const actor = alias(users, 'actor');
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      createdAt: auditLogs.createdAt,
      actorFirstName: actor.firstName,
      actorLastName: actor.lastName,
      memberId: members.id,
      memberCode: members.memberCode,
      memberFirstName: members.firstName,
      memberLastName: members.lastName,
    })
    .from(auditLogs)
    .leftJoin(actor, eq(actor.id, auditLogs.actorUserId))
    .leftJoin(
      memberships,
      and(eq(auditLogs.entityType, 'MEMBERSHIP'), eq(memberships.id, auditLogs.entityId)),
    )
    .leftJoin(
      members,
      or(
        and(eq(auditLogs.entityType, 'MEMBER'), eq(members.id, auditLogs.entityId)),
        eq(members.id, memberships.memberId),
      ),
    )
    .where(inArray(auditLogs.entityType, ['MEMBER', 'MEMBERSHIP']))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(ACTIVITY_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    action: row.action as AuditAction,
    entityType: row.entityType as AuditEntityType,
    createdAt: row.createdAt.toISOString(),
    actorName: row.actorFirstName ? `${row.actorFirstName} ${row.actorLastName}` : null,
    member:
      row.memberId && row.memberCode && row.memberFirstName && row.memberLastName
        ? {
            id: row.memberId,
            memberCode: row.memberCode,
            firstName: row.memberFirstName,
            lastName: row.memberLastName,
          }
        : null,
  }));
}
