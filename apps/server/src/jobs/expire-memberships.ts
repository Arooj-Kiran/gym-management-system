import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { memberships } from '../db/schema';
import { gymToday } from '../lib/dates';
import type { RequestContext } from '../lib/request-context';
import { recordChange } from '../modules/memberships/memberships.service';

/** Fixed key: only one instance may run the expiry job at a time (several API processes). */
const EXPIRY_LOCK = sql`hashtext('job:membership-expiry')`;

const SYSTEM_CONTEXT: RequestContext = {
  actorUserId: null,
  actorRole: null,
  ip: null,
  userAgent: null,
  requestId: 'job:membership-expiry',
};

export interface ExpiryRunResult {
  /** false when another process held the lock and this run did nothing. */
  ran: boolean;
  expired: number;
}

/**
 * Marks every ACTIVE membership whose last day was before `today` (gym time) as EXPIRED, with an
 * EXPIRED event (actor: system) and an audit row each. Idempotent: running it twice on the same
 * day changes nothing the second time. Reads already treat such rows as expired, so a late run
 * never grants access it should not.
 */
export async function expireMemberships(today = gymToday()): Promise<ExpiryRunResult> {
  return db.transaction(async (tx) => {
    const [lock] = await tx
      .execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(${EXPIRY_LOCK}) as locked`)
      .then((result) => result.rows);
    if (!lock?.locked) return { ran: false, expired: 0 };

    // SKIP LOCKED: a row a staff member is changing right now is picked up by the next run.
    const due = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.status, 'ACTIVE'), lt(memberships.endDate, today)))
      .for('update', { skipLocked: true });
    if (due.length === 0) return { ran: true, expired: 0 };

    await tx
      .update(memberships)
      .set({ status: 'EXPIRED', version: sql`${memberships.version} + 1` })
      .where(
        inArray(
          memberships.id,
          due.map((row) => row.id),
        ),
      );
    for (const row of due) {
      await recordChange(tx, SYSTEM_CONTEXT, {
        membership: row,
        eventType: 'EXPIRED',
        auditAction: 'MEMBERSHIP_EXPIRED',
        fromStatus: 'ACTIVE',
        toStatus: 'EXPIRED',
        newValues: { endDate: row.endDate, expiredOn: today },
      });
    }
    return { ran: true, expired: due.length };
  });
}
