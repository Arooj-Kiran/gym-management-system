import type { AuditAction, AuditEntityType } from '@gms/shared';
import type { DbExecutor } from '../db/client';
import { auditLogs } from '../db/schema';
import type { RequestContext } from './request-context';

const SECRET_KEY = /pass(word)?|secret|token|hash|csrf/i;

/** Recursively removes anything that looks like a secret before it is stored. */
export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, inner]) => [key, stripSecrets(inner)]),
    );
  }
  return value;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

/** Write an audit row. Pass the transaction so the row commits (or rolls back) with the change. */
export async function recordAudit(executor: DbExecutor, ctx: RequestContext, entry: AuditEntry) {
  await executor.insert(auditLogs).values({
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ? (stripSecrets(entry.before) as Record<string, unknown>) : null,
    after: entry.after ? (stripSecrets(entry.after) as Record<string, unknown>) : null,
    reason: entry.reason?.trim() || null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  });
}

/** Only the fields whose values actually changed, as { before, after }. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    const next = after[key];
    if (next === undefined) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(next)) {
      changedBefore[key] = before[key];
      changedAfter[key] = next;
    }
  }
  return {
    before: changedBefore,
    after: changedAfter,
    changed: Object.keys(changedAfter).length > 0,
  };
}
