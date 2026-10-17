import {
  permissionScope,
  SCOPES,
  type AuditAction,
  type DashboardActivityItem,
  type DashboardSummary,
  type Role,
} from '@gms/shared';
import { count, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/client';
import { auditLogs, members, users } from '../../db/schema';
import { gymToday } from '../../lib/dates';

const ACTIVITY_LIMIT = 8;

/** Whole-gym member figures need unscoped member access; trainers get their own view later. */
const seesAllMembers = (role: Role) => permissionScope(role, 'members:read') === SCOPES.ALL;

export async function getSummary(role: Role): Promise<DashboardSummary> {
  if (!seesAllMembers(role)) return { members: null };
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
  return { members: { total: totals?.total ?? 0, registeredToday: totals?.registeredToday ?? 0 } };
}

/**
 * Recent member events from the audit trail. Only who / what / when — never the before/after
 * values, which can hold contact details.
 */
export async function getActivity(role: Role): Promise<DashboardActivityItem[]> {
  if (!seesAllMembers(role)) return [];
  const actor = alias(users, 'actor');
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
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
    .leftJoin(members, eq(members.id, auditLogs.entityId))
    .where(eq(auditLogs.entityType, 'MEMBER'))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(ACTIVITY_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    action: row.action as AuditAction,
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
