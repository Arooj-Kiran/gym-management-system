import { addDays } from '@gms/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, pool } from '../../src/db/client';
import { auditLogs, membershipEvents, memberships } from '../../src/db/schema';
import { expireMemberships } from '../../src/jobs/expire-memberships';
import { gymToday } from '../../src/lib/dates';
import { resetTables } from '../setup/db';
import { createMember, createMembership, createPlan } from '../setup/factories';

let today: string;
let plan: Awaited<ReturnType<typeof createPlan>>;

beforeEach(async () => {
  await resetTables();
  today = gymToday();
  plan = await createPlan({ name: 'Monthly Standard' });
});
afterAll(closeDb);

const statusOf = async (id: string) =>
  (await db.select().from(memberships).where(eq(memberships.id, id)))[0]!.status;

describe('daily expiry job (scenario 6, job part)', () => {
  it('expires ACTIVE memberships whose last day has passed, with an event and an audit row', async () => {
    const lapsed = await createMembership(await createMember(), plan, {
      startDate: addDays(today, -30),
      endDate: addDays(today, -1),
    });
    const lastDay = await createMembership(await createMember(), plan, {
      startDate: addDays(today, -29),
      endDate: today,
    });
    const suspended = await createMembership(await createMember(), plan, {
      status: 'SUSPENDED',
      startDate: addDays(today, -40),
      endDate: addDays(today, -5),
    });
    const pending = await createMembership(await createMember(), plan, {
      status: 'PENDING',
      startDate: addDays(today, -40),
      endDate: addDays(today, -5),
    });

    expect(await expireMemberships()).toEqual({ ran: true, expired: 1 });

    expect(await statusOf(lapsed.id)).toBe('EXPIRED');
    // The last day still counts: it expires tomorrow.
    expect(await statusOf(lastDay.id)).toBe('ACTIVE');
    // Only ACTIVE → EXPIRED is a valid transition.
    expect(await statusOf(suspended.id)).toBe('SUSPENDED');
    expect(await statusOf(pending.id)).toBe('PENDING');

    const [row] = await db.select().from(memberships).where(eq(memberships.id, lapsed.id));
    expect(row!.version).toBe(lapsed.version + 1);
    const events = await db
      .select()
      .from(membershipEvents)
      .where(eq(membershipEvents.membershipId, lapsed.id));
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'EXPIRED',
        fromStatus: 'ACTIVE',
        toStatus: 'EXPIRED',
        actorUserId: null,
      }),
    ]);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.entityId, lapsed.id));
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'MEMBERSHIP_EXPIRED',
        entityType: 'MEMBERSHIP',
        actorUserId: null,
        requestId: 'job:membership-expiry',
      }),
    ]);
  });

  it('is idempotent: a second run the same day changes nothing', async () => {
    await createMembership(await createMember(), plan, {
      startDate: addDays(today, -30),
      endDate: addDays(today, -1),
    });
    expect(await expireMemberships()).toEqual({ ran: true, expired: 1 });
    expect(await expireMemberships()).toEqual({ ran: true, expired: 0 });
    expect(await db.select().from(membershipEvents)).toHaveLength(1);
  });

  it('computes "passed" in gym time: the run date decides, not the server clock', async () => {
    const row = await createMembership(await createMember(), plan, {
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(await expireMemberships('2026-01-31')).toEqual({ ran: true, expired: 0 });
    expect(await expireMemberships('2026-02-01')).toEqual({ ran: true, expired: 1 });
    expect(await statusOf(row.id)).toBe('EXPIRED');
  });

  it('skips the run while another process holds the advisory lock', async () => {
    const row = await createMembership(await createMember(), plan, {
      startDate: addDays(today, -30),
      endDate: addDays(today, -1),
    });
    const other = await pool.connect();
    try {
      await other.query('begin');
      await other.query(`select pg_advisory_xact_lock(hashtext('job:membership-expiry'))`);
      expect(await expireMemberships()).toEqual({ ran: false, expired: 0 });
      expect(await statusOf(row.id)).toBe('ACTIVE');
      await other.query('rollback');
    } finally {
      other.release();
    }
    expect(await expireMemberships()).toEqual({ ran: true, expired: 1 });
  });

  it('leaves a row another transaction has locked for the next run', async () => {
    const locked = await createMembership(await createMember(), plan, {
      startDate: addDays(today, -30),
      endDate: addDays(today, -1),
    });
    const free = await createMembership(await createMember(), plan, {
      startDate: addDays(today, -30),
      endDate: addDays(today, -2),
    });
    const other = await pool.connect();
    try {
      await other.query('begin');
      await other.query('select id from memberships where id = $1 for update', [locked.id]);
      expect(await expireMemberships()).toEqual({ ran: true, expired: 1 });
      await other.query('rollback');
    } finally {
      other.release();
    }
    expect(await statusOf(free.id)).toBe('EXPIRED');
    expect(await statusOf(locked.id)).toBe('ACTIVE');
    expect(await expireMemberships()).toEqual({ ran: true, expired: 1 });
    const [count] = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from memberships where status = 'EXPIRED'`,
      )
    ).rows;
    expect(count!.n).toBe(2);
  });
});
