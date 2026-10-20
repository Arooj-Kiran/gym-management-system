import {
  permissionScope,
  SCOPES,
  type AuditAction,
  type AuditEntityType,
  type DashboardAttendance,
  type DashboardMembershipCounts,
  type DashboardActivityItem,
  type DashboardSummary,
  type Role,
} from '@gms/shared';
import { and, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/client';
import {
  accessAttempts,
  attendanceRecords,
  auditLogs,
  members,
  memberships,
  users,
} from '../../db/schema';
import { gymDayStart, gymToday } from '../../lib/dates';
import { currentEffectiveStatusSql, expiringSoonSql } from '../memberships/current-membership';
import { getSettings } from '../settings/settings.service';

const ACTIVITY_LIMIT = 8;

/** Whole-gym member figures need unscoped member access; trainers get their own view later. */
const seesAllMembers = (role: Role) => permissionScope(role, 'members:read') === SCOPES.ALL;
const seesAllMemberships = (role: Role) => permissionScope(role, 'memberships:read') === SCOPES.ALL;
const seesAllAttendance = (role: Role) => permissionScope(role, 'attendance:read') === SCOPES.ALL;

export async function getSummary(role: Role): Promise<DashboardSummary> {
  const [memberCounts, membershipCounts, attendance] = await Promise.all([
    seesAllMembers(role) ? getMemberCounts() : null,
    seesAllMemberships(role) ? getMembershipCounts() : null,
    seesAllAttendance(role) ? getAttendanceToday() : null,
  ]);
  return { members: memberCounts, memberships: membershipCounts, attendance };
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
