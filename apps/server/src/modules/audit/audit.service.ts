import type { AuditAction, AuditLogDto, auditListQuerySchema } from '@gms/shared';
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { db } from '../../db/client';
import { auditLogs, users } from '../../db/schema';
import { gymDayStart } from '../../lib/dates';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';

type AuditListQuery = z.output<typeof auditListQuerySchema>;

export async function listAuditLogs(query: AuditListQuery) {
  const filters: (SQL | undefined)[] = [];
  if (query.action) filters.push(eq(auditLogs.action, query.action));
  if (query.entityType) filters.push(eq(auditLogs.entityType, query.entityType));
  if (query.entityId) filters.push(eq(auditLogs.entityId, query.entityId));
  if (query.actorUserId) filters.push(eq(auditLogs.actorUserId, query.actorUserId));
  if (query.from) filters.push(gte(auditLogs.createdAt, gymDayStart(query.from)));
  if (query.to) filters.push(lt(auditLogs.createdAt, gymDayStart(query.to, 1)));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(
        ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, pattern),
        ilike(users.email, pattern),
        ilike(auditLogs.reason, pattern),
      ),
    );
  }
  const where = and(...filters);
  const direction = (query.order ?? 'desc') === 'asc' ? asc : desc;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        log: auditLogs,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(direction(auditLogs.createdAt), direction(auditLogs.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where),
  ]);

  const data: AuditLogDto[] = rows.map(({ log, actorFirstName, actorLastName, actorEmail }) => ({
    id: log.id,
    action: log.action as AuditAction,
    entityType: log.entityType,
    entityId: log.entityId,
    actor:
      log.actorUserId && actorEmail
        ? { id: log.actorUserId, name: `${actorFirstName} ${actorLastName}`, email: actorEmail }
        : null,
    actorRole: log.actorRole,
    before: log.before,
    after: log.after,
    reason: log.reason,
    ip: log.ip,
    userAgent: log.userAgent,
    requestId: log.requestId,
    createdAt: log.createdAt.toISOString(),
  }));
  return paginated(data, query.page, query.pageSize, totals?.total ?? 0);
}
