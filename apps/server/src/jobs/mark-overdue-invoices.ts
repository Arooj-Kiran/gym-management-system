import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { gymToday } from '../lib/dates';
import { markOverdueInvoices } from '../modules/billing/billing.service';

/** Fixed key: only one instance may run the overdue job at a time (several API processes). */
const OVERDUE_LOCK = sql`hashtext('job:invoice-overdue')`;

export interface OverdueRunResult {
  /** false when another process held the lock and this run did nothing. */
  ran: boolean;
  marked: number;
}

/**
 * Marks every PENDING invoice whose due date was before `today` (gym time) as OVERDUE.
 * Idempotent: a second run on the same day changes nothing. Partly paid invoices stay
 * PARTIALLY_PAID (PLAN §3.4 status order).
 */
export async function markOverdue(today = gymToday()): Promise<OverdueRunResult> {
  return db.transaction(async (tx) => {
    const [lock] = await tx
      .execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${OVERDUE_LOCK}) as locked`,
      )
      .then((result) => result.rows);
    if (!lock?.locked) return { ran: false, marked: 0 };
    return { ran: true, marked: await markOverdueInvoices(tx, today) };
  });
}
