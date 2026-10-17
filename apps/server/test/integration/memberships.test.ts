import { addDays, computeEndDate } from '@gms/shared';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, membershipEvents, memberships } from '../../src/db/schema';
import { gymToday } from '../../src/lib/dates';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import {
  createMember,
  createMembership,
  createPlan,
  createUser,
  type TestUser,
} from '../setup/factories';

const app = testApp();

let admin: TestUser;
let session: Session;
let member: Awaited<ReturnType<typeof createMember>>;
let plan: Awaited<ReturnType<typeof createPlan>>;
let today: string;

beforeEach(async () => {
  await resetTables();
  today = gymToday();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
  member = await createMember({ firstName: 'Hamza', lastName: 'Qureshi' });
  plan = await createPlan({ name: 'Monthly Standard', priceMinor: 450_000 });
});
afterAll(closeDb);

const as = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
});
const api = () => as(session);

const eventsOf = (membershipId: string) =>
  db
    .select()
    .from(membershipEvents)
    .where(eq(membershipEvents.membershipId, membershipId))
    .orderBy(membershipEvents.createdAt);

const auditFor = (entityId: string, action: string) =>
  db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, action)));

const rowOf = async (id: string) =>
  (await db.select().from(memberships).where(eq(memberships.id, id)))[0]!;

async function assign(startDate?: string, planId = plan.id) {
  const res = await api().post('/memberships', { memberId: member.id, planId, startDate });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; startDate: string; endDate: string; version: number };
}

async function assignActive(startDate?: string) {
  const created = await assign(startDate);
  const res = await api().post(`/memberships/${created.id}/activate`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { id: string; startDate: string; endDate: string; version: number };
}

describe('assign a plan (scenario 2, without invoice)', () => {
  it('creates a PENDING membership with server-computed dates and a price snapshot', async () => {
    const res = await api().post('/memberships', { memberId: member.id, planId: plan.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      memberId: member.id,
      planId: plan.id,
      planName: 'Monthly Standard',
      priceMinor: 450_000,
      status: 'PENDING',
      effectiveStatus: 'PENDING',
      startDate: today,
      endDate: computeEndDate(today, 1, 'MONTH'),
      activatedAt: null,
      totalSuspendedDays: 0,
      renewedFromId: null,
      version: 1,
      member: { id: member.id, firstName: 'Hamza', lastName: 'Qureshi' },
    });

    const [event] = await eventsOf(res.body.id);
    expect(event).toMatchObject({
      eventType: 'CREATED',
      fromStatus: null,
      toStatus: 'PENDING',
      actorUserId: admin.id,
      memberId: member.id,
    });
    expect(event!.newValues).toMatchObject({ priceMinor: 450_000, startDate: today });
    const [audit] = await auditFor(res.body.id, 'MEMBERSHIP_ASSIGNED');
    expect(audit).toMatchObject({ entityType: 'MEMBERSHIP', actorUserId: admin.id });
    expect(audit!.after).toMatchObject({ memberId: member.id, status: 'PENDING' });
  });

  it('keeps the price snapshot when the plan price changes later', async () => {
    const created = await assign();
    await session.agent
      .patch(`/api/v1/membership-plans/${plan.id}`)
      .set('X-CSRF-Token', session.csrf)
      .send({ priceMinor: 999_000 })
      .expect(200);
    const res = await api().get(`/memberships/${created.id}`);
    expect(res.body.priceMinor).toBe(450_000);
  });

  it('computes day plans inclusively and accepts a future start date', async () => {
    const dayPlan = await createPlan({
      name: 'Ten day pass',
      planType: 'CUSTOM',
      durationValue: 10,
      durationUnit: 'DAY',
    });
    const start = addDays(today, 5);
    const res = await api().post('/memberships', {
      memberId: member.id,
      planId: dayPlan.id,
      startDate: start,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startDate: start, endDate: addDays(start, 9) });
  });

  it('rejects start dates outside the allowed window and fields the server computes', async () => {
    for (const startDate of [addDays(today, -31), addDays(today, 366)]) {
      const res = await api().post('/memberships', {
        memberId: member.id,
        planId: plan.id,
        startDate,
      });
      expect(res.status, startDate).toBe(400);
      expect(res.body.error.details[0].path).toBe('startDate');
    }
    const forged = await api().post('/memberships', {
      memberId: member.id,
      planId: plan.id,
      endDate: addDays(today, 400),
      status: 'ACTIVE',
    });
    expect(forged.status).toBe(400);
    expect(await db.select().from(memberships)).toHaveLength(0);
  });

  it('refuses archived plans and archived members', async () => {
    const archivedPlan = await createPlan({ name: 'Old plan', isActive: false });
    const planRes = await api().post('/memberships', {
      memberId: member.id,
      planId: archivedPlan.id,
    });
    expect(planRes.status).toBe(409);
    expect(planRes.body.error.code).toBe('PLAN_ARCHIVED');

    const archived = await createMember({ archivedAt: new Date(), archivedBy: admin.id });
    const memberRes = await api().post('/memberships', {
      memberId: archived.id,
      planId: plan.id,
    });
    expect(memberRes.status).toBe(409);
    expect(memberRes.body.error.code).toBe('MEMBER_ARCHIVED');

    const missing = await api().post('/memberships', {
      memberId: '00000000-0000-4000-8000-000000000000',
      planId: plan.id,
    });
    expect(missing.status).toBe(404);
    expect(await db.select().from(memberships)).toHaveLength(0);
  });

  it('refuses overlapping current periods, but allows one after a cancelled period', async () => {
    const first = await assign();
    const overlap = await api().post('/memberships', {
      memberId: member.id,
      planId: plan.id,
      startDate: addDays(today, 10),
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('MEMBERSHIP_OVERLAP');
    expect(overlap.body.error.existing).toMatchObject({ id: first.id, status: 'PENDING' });

    const back = await api().post('/memberships', {
      memberId: member.id,
      planId: plan.id,
      startDate: addDays(first.endDate, 1),
    });
    expect(back.status).toBe(201);

    await api()
      .post(`/memberships/${first.id}/cancel`, { reason: 'Assigned the wrong plan' })
      .expect(200);
    const again = await api().post('/memberships', {
      memberId: member.id,
      planId: plan.id,
      startDate: today,
    });
    expect(again.status).toBe(201);
  });

  it('lets only one of two simultaneous assignments through', async () => {
    const results = await Promise.all([
      api().post('/memberships', { memberId: member.id, planId: plan.id }),
      api().post('/memberships', { memberId: member.id, planId: plan.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(memberships)).toHaveLength(1);
  });
});

describe('database guarantees', () => {
  it('the exclusion constraint rejects overlapping current periods written directly', async () => {
    await createMembership(member, plan, { startDate: today, endDate: addDays(today, 29) });
    await expect(
      createMembership(member, plan, {
        status: 'PENDING',
        startDate: addDays(today, 29),
        endDate: addDays(today, 40),
      }),
    ).rejects.toMatchObject({ cause: { code: '23P01' } });
    // A cancelled or expired period does not block anything.
    await createMembership(member, plan, {
      status: 'CANCELLED',
      startDate: today,
      endDate: addDays(today, 29),
    });
  });

  it('check constraints keep status fields consistent', async () => {
    await expect(
      createMembership(member, plan, {
        status: 'ACTIVE',
        activatedAt: null,
        startDate: today,
        endDate: today,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(
      createMembership(member, plan, {
        status: 'PENDING',
        startDate: today,
        endDate: addDays(today, -1),
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('membership_events is append-only', async () => {
    const created = await assign();
    await expect(
      db.execute(
        sql`update membership_events set reason = 'edited' where membership_id = ${created.id}`,
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only/i) } });
    await expect(
      db.execute(sql`delete from membership_events where membership_id = ${created.id}`),
    ).rejects.toThrow();
    expect(await eventsOf(created.id)).toHaveLength(1);
  });
});

describe('activate, renew, extend, suspend, reactivate, cancel (scenario 3)', () => {
  it('activates a PENDING membership and writes an ACTIVATED event', async () => {
    const created = await assign();
    const res = await api().post(`/memberships/${created.id}/activate`, { version: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', version: 2 });
    expect(res.body.activatedAt).toEqual(expect.any(String));
    const events = await eventsOf(created.id);
    expect(events.map((e) => e.eventType)).toEqual(['CREATED', 'ACTIVATED']);
    expect(events[1]).toMatchObject({ fromStatus: 'PENDING', toStatus: 'ACTIVE' });
    expect(await auditFor(created.id, 'MEMBERSHIP_ACTIVATED')).toHaveLength(1);
  });

  it('refuses to activate a pending period that has already ended', async () => {
    const old = await createMembership(member, plan, {
      status: 'PENDING',
      startDate: addDays(today, -40),
      endDate: addDays(today, -10),
    });
    const res = await api().post(`/memberships/${old.id}/activate`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEMBERSHIP_PERIOD_ENDED');
  });

  it('renews into a new linked period starting the day after the current end date', async () => {
    const current = await assignActive();
    const res = await api().post(`/memberships/${current.id}/renew`);
    expect(res.status).toBe(201);
    const start = addDays(current.endDate, 1);
    expect(res.body).toMatchObject({
      status: 'ACTIVE',
      renewedFromId: current.id,
      startDate: start,
      endDate: computeEndDate(start, 1, 'MONTH'),
      priceMinor: 450_000,
    });
    // The old period is untouched.
    expect(await rowOf(current.id)).toMatchObject({ status: 'ACTIVE', endDate: current.endDate });
    const [event] = await eventsOf(res.body.id);
    expect(event).toMatchObject({ eventType: 'RENEWED', toStatus: 'ACTIVE' });
    expect(event!.oldValues).toMatchObject({ renewedFromId: current.id });
    expect(await auditFor(res.body.id, 'MEMBERSHIP_RENEWED')).toHaveLength(1);

    // Renewing the old period again would skip the one just created.
    const twice = await api().post(`/memberships/${current.id}/renew`);
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('NOT_LATEST_MEMBERSHIP');
  });

  it('renews an expired membership from today, optionally onto another plan', async () => {
    const expired = await createMembership(member, plan, {
      status: 'EXPIRED',
      startDate: addDays(today, -60),
      endDate: addDays(today, -31),
    });
    const quarterly = await createPlan({
      name: 'Quarterly Plus',
      planType: 'QUARTERLY',
      durationValue: 3,
      priceMinor: 1_200_000,
    });
    const res = await api().post(`/memberships/${expired.id}/renew`, { planId: quarterly.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      planName: 'Quarterly Plus',
      priceMinor: 1_200_000,
      startDate: today,
      endDate: computeEndDate(today, 3, 'MONTH'),
      renewedFromId: expired.id,
    });
  });

  it('extends the end date without changing the status', async () => {
    const current = await assignActive();
    const res = await api().post(`/memberships/${current.id}/extend`, {
      days: 5,
      reason: 'Gym closed for repairs',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', endDate: addDays(current.endDate, 5) });
    const events = await eventsOf(current.id);
    expect(events.at(-1)).toMatchObject({
      eventType: 'EXTENDED',
      fromStatus: 'ACTIVE',
      toStatus: 'ACTIVE',
      reason: 'Gym closed for repairs',
      oldValues: { endDate: current.endDate },
    });
  });

  it('will not extend into the next period', async () => {
    const current = await assignActive();
    await api().post(`/memberships/${current.id}/renew`).expect(201);
    const res = await api().post(`/memberships/${current.id}/extend`, {
      days: 3,
      reason: 'Goodwill days',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEMBERSHIP_OVERLAP');
    expect((await rowOf(current.id)).endDate).toBe(current.endDate);
  });

  it('suspends and reactivates, adding the suspended days to the end date when asked', async () => {
    const start = addDays(today, -10);
    const current = await createMembership(member, plan, {
      startDate: start,
      endDate: addDays(start, 29),
    });
    const suspended = await api().post(`/memberships/${current.id}/suspend`, {
      reason: 'Medical leave',
    });
    expect(suspended.status).toBe(200);
    expect(suspended.body).toMatchObject({
      status: 'SUSPENDED',
      suspensionReason: 'Medical leave',
    });

    // Pretend the suspension started 4 days ago (gym time), as if time had passed.
    await db.execute(
      sql`update memberships set suspended_at = now() - interval '4 days' where id = ${current.id}`,
    );
    const res = await api().post(`/memberships/${current.id}/reactivate`, {
      reason: 'Back from leave',
      extendBySuspendedDays: true,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ACTIVE',
      suspendedAt: null,
      suspensionReason: null,
      totalSuspendedDays: 4,
      endDate: addDays(current.endDate, 4),
    });
    const events = await eventsOf(current.id);
    expect(events.map((e) => e.eventType)).toEqual(['SUSPENDED', 'REACTIVATED']);
    expect(events[1]!.newValues).toMatchObject({ suspendedDays: 4, extendedBySuspendedDays: true });
  });

  it('reactivates without moving the end date by default', async () => {
    const current = await createMembership(member, plan, {
      status: 'SUSPENDED',
      startDate: addDays(today, -10),
      endDate: addDays(today, 19),
      suspendedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    const res = await api().post(`/memberships/${current.id}/reactivate`, {
      reason: 'Back from travel',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ endDate: current.endDate, totalSuspendedDays: 3 });
  });

  it('cancels immediately and keeps the history', async () => {
    const current = await assignActive();
    const res = await api().post(`/memberships/${current.id}/cancel`, {
      reason: 'Member moved to another city',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Member moved to another city',
    });
    expect(res.body.cancelledAt).toEqual(expect.any(String));
    expect((await eventsOf(current.id)).map((e) => e.eventType)).toEqual([
      'CREATED',
      'ACTIVATED',
      'CANCELLED',
    ]);
    const history = await api().get(`/members/${member.id}/membership-events`);
    expect(history.body.data.map((e: { eventType: string }) => e.eventType)).toEqual([
      'CANCELLED',
      'ACTIVATED',
      'CREATED',
    ]);
    expect(history.body.data[0]).toMatchObject({
      actorName: 'Ayesha Malik',
      reason: 'Member moved to another city',
      planName: 'Monthly Standard',
    });
  });

  it.each([
    ['PENDING', 'suspend', { reason: 'Medical leave' }],
    ['PENDING', 'reactivate', { reason: 'Back again' }],
    ['PENDING', 'renew', {}],
    ['ACTIVE', 'activate', {}],
    ['ACTIVE', 'reactivate', { reason: 'Back again' }],
    ['SUSPENDED', 'suspend', { reason: 'Medical leave' }],
    ['SUSPENDED', 'activate', {}],
    ['SUSPENDED', 'renew', {}],
    ['CANCELLED', 'activate', {}],
    ['CANCELLED', 'cancel', { reason: 'Cancel twice' }],
    ['CANCELLED', 'extend', { days: 3, reason: 'Goodwill days' }],
    ['EXPIRED', 'suspend', { reason: 'Medical leave' }],
    ['EXPIRED', 'reactivate', { reason: 'Back again' }],
    ['EXPIRED', 'cancel', { reason: 'Too late' }],
  ] as const)('%s → %s is refused with 409 and changes nothing', async (status, action, body) => {
    const row = await createMembership(member, plan, {
      status,
      startDate: status === 'EXPIRED' ? addDays(today, -40) : today,
      endDate: status === 'EXPIRED' ? addDays(today, -11) : addDays(today, 29),
    });
    const res = await api().post(`/memberships/${row.id}/${action}`, body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(await rowOf(row.id)).toEqual(row);
    expect(await eventsOf(row.id)).toHaveLength(0);
  });

  it('rejects a stale version without changing anything', async () => {
    const current = await assignActive();
    const res = await api().post(`/memberships/${current.id}/suspend`, {
      reason: 'Medical leave',
      version: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'STALE_VERSION', currentVersion: 2 });
    expect((await rowOf(current.id)).status).toBe('ACTIVE');
  });

  it('requires a reason for status changes', async () => {
    const current = await assignActive();
    for (const action of ['suspend', 'cancel', 'extend']) {
      const res = await api().post(`/memberships/${current.id}/${action}`, { days: 2 });
      expect(res.status, action).toBe(400);
    }
  });
});

describe('unauthorized staff cannot change membership status (scenario 11)', () => {
  async function snapshot(id: string) {
    return { row: await rowOf(id), events: (await eventsOf(id)).length };
  }

  it('Receptionist: 403 on cancel, suspend, reactivate and extend; allowed to assign, activate and renew', async () => {
    const receptionist = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
    const active = await createMembership(member, plan, {
      startDate: today,
      endDate: addDays(today, 29),
    });
    const before = await snapshot(active.id);
    for (const [action, body] of [
      ['cancel', { reason: 'No longer needed' }],
      ['suspend', { reason: 'Medical leave' }],
      ['reactivate', { reason: 'Back again' }],
      ['extend', { days: 3, reason: 'Goodwill days' }],
    ] as const) {
      const res = await as(receptionist).post(`/memberships/${active.id}/${action}`, body);
      expect(res.status, action).toBe(403);
    }
    expect(await snapshot(active.id)).toEqual(before);

    const renewed = await as(receptionist).post(`/memberships/${active.id}/renew`);
    expect(renewed.status).toBe(201);
    const other = await createMember();
    const assigned = await as(receptionist).post('/memberships', {
      memberId: other.id,
      planId: plan.id,
    });
    expect(assigned.status).toBe(201);
    expect((await as(receptionist).post(`/memberships/${assigned.body.id}/activate`)).status).toBe(
      200,
    );
  });

  it('Trainer and Member: 403 on every membership mutation', async () => {
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    const memberUser = await createUser({ role: 'MEMBER' });
    await db.execute(sql`update members set user_id = ${memberUser.id} where id = ${member.id}`);
    const portal = await signIn(app, memberUser);
    const pending = await createMembership(member, plan, {
      status: 'PENDING',
      startDate: today,
      endDate: addDays(today, 29),
    });
    const before = await snapshot(pending.id);

    for (const s of [trainer, portal]) {
      const create = await as(s).post('/memberships', { memberId: member.id, planId: plan.id });
      expect(create.status).toBe(403);
      for (const [action, body] of [
        ['activate', {}],
        ['renew', {}],
        ['cancel', { reason: 'No longer needed' }],
        ['suspend', { reason: 'Medical leave' }],
        ['reactivate', { reason: 'Back again' }],
        ['extend', { days: 3, reason: 'Goodwill days' }],
      ] as const) {
        const res = await as(s).post(`/memberships/${pending.id}/${action}`, body);
        expect(res.status, `${s.me.user.role} ${action}`).toBe(403);
      }
    }
    expect(await snapshot(pending.id)).toEqual(before);
    expect(await db.select().from(memberships)).toHaveLength(1);
  });

  it('Trainer: membership lists are empty and single memberships out of scope until assignments exist', async () => {
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    const row = await createMembership(member, plan, {
      startDate: today,
      endDate: addDays(today, 29),
    });
    const list = await as(trainer).get('/memberships');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
    for (const path of [
      `/memberships/${row.id}`,
      `/memberships/${row.id}/events`,
      `/members/${member.id}/memberships`,
      `/members/${member.id}/membership-events`,
    ]) {
      expect((await as(trainer).get(path)).status, path).toBe(403);
    }
  });

  it('Member: staff membership routes are closed; their own is read through /me', async () => {
    const memberUser = await createUser({ role: 'MEMBER' });
    await db.execute(sql`update members set user_id = ${memberUser.id} where id = ${member.id}`);
    const portal = await signIn(app, memberUser);
    const row = await createMembership(member, plan, {
      startDate: today,
      endDate: addDays(today, 29),
    });
    for (const path of [
      '/memberships',
      `/memberships/${row.id}`,
      `/members/${member.id}/memberships`,
    ]) {
      expect((await as(portal).get(path)).status, path).toBe(403);
    }
  });
});

describe('membership lists', () => {
  it('filters by effective status and lists expiring-soon memberships without a renewal', async () => {
    const soon = await createMember({ firstName: 'Soon' });
    const renewed = await createMember({ firstName: 'Renewed' });
    const lapsed = await createMember({ firstName: 'Lapsed' });
    const archived = await createMember({ archivedAt: new Date(), archivedBy: admin.id });

    const soonRow = await createMembership(soon, plan, {
      startDate: addDays(today, -25),
      endDate: addDays(today, 4),
    });
    await createMembership(renewed, plan, {
      startDate: addDays(today, -25),
      endDate: addDays(today, 3),
    });
    await createMembership(renewed, plan, {
      status: 'PENDING',
      startDate: addDays(today, 4),
      endDate: addDays(today, 33),
    });
    // ACTIVE but past its end date: the job has not run yet, yet it reads as EXPIRED.
    const lapsedRow = await createMembership(lapsed, plan, {
      startDate: addDays(today, -31),
      endDate: addDays(today, -1),
    });
    await createMembership(archived, plan, {
      startDate: addDays(today, -25),
      endDate: addDays(today, 2),
    });

    const expiring = await api().get('/memberships?expiringWithinDays=7');
    expect(expiring.status).toBe(200);
    expect(expiring.body.data.map((m: { id: string }) => m.id)).toEqual([soonRow.id]);
    expect(expiring.body.total).toBe(1);

    const expired = await api().get('/memberships?status=EXPIRED');
    expect(expired.body.data).toHaveLength(1);
    expect(expired.body.data[0]).toMatchObject({
      id: lapsedRow.id,
      status: 'ACTIVE',
      effectiveStatus: 'EXPIRED',
    });

    const all = await api().get('/memberships?sort=memberName&q=soon');
    expect(all.body.data.map((m: { id: string }) => m.id)).toEqual([soonRow.id]);
  });

  it('shows the current membership on the member list and filters by it', async () => {
    const none = await createMember({ firstName: 'Nobody' });
    const created = await assignActive();
    const list = await api().get('/members?pageSize=50');
    const byId = Object.fromEntries(
      list.body.data.map((m: { id: string; currentMembership: unknown }) => [
        m.id,
        m.currentMembership,
      ]),
    );
    expect(byId[none.id]).toBeNull();
    expect(byId[member.id]).toEqual({
      id: created.id,
      planName: 'Monthly Standard',
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      startDate: today,
      endDate: created.endDate,
    });

    const active = await api().get('/members?membershipStatus=ACTIVE');
    expect(active.body.data.map((m: { id: string }) => m.id)).toEqual([member.id]);
    const withNone = await api().get('/members?membershipStatus=NONE');
    expect(withNone.body.data.map((m: { id: string }) => m.id)).toEqual([none.id]);

    const detail = await api().get(`/members/${member.id}`);
    expect(detail.body.currentMembership).toMatchObject({ id: created.id });
    const memberships = await api().get(`/members/${member.id}/memberships`);
    expect(memberships.body.data).toHaveLength(1);
  });

  it('prefers a running period over an upcoming renewal as the current membership', async () => {
    const running = await assignActive();
    await api().post(`/memberships/${running.id}/renew`).expect(201);
    const detail = await api().get(`/members/${member.id}`);
    expect(detail.body.currentMembership.id).toBe(running.id);
  });
});
