import { PLAN_TYPES } from '@gms/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, membershipPlans } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createPlan, createUser, type TestUser } from '../setup/factories';

const app = testApp();

let admin: TestUser;
let session: Session;

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN' });
  session = await signIn(app, admin);
});
afterAll(closeDb);

const as = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1/membership-plans${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1/membership-plans${path}`).set('X-CSRF-Token', s.csrf).send(body),
  patch: (path: string, body: object) =>
    s.agent.patch(`/api/v1/membership-plans${path}`).set('X-CSRF-Token', s.csrf).send(body),
});
const api = () => as(session);

async function auditFor(entityId: string, action: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, action)));
}

const detailPaths = (body: { error: { details?: { path: string }[] } }) =>
  (body.error.details ?? []).map((detail) => detail.path);

describe('create plans (scenario 2, plan part)', () => {
  const expected = {
    MONTHLY: { durationValue: 1, durationUnit: 'MONTH' },
    QUARTERLY: { durationValue: 3, durationUnit: 'MONTH' },
    SIX_MONTH: { durationValue: 6, durationUnit: 'MONTH' },
    ANNUAL: { durationValue: 12, durationUnit: 'MONTH' },
    CUSTOM: { durationValue: 45, durationUnit: 'DAY' },
  } as const;

  it.each(PLAN_TYPES)(
    'creates a %s plan with the right duration and an audit row',
    async (type) => {
      const res = await api().post('', {
        name: `${type} plan`,
        planType: type,
        priceMinor: 750_000,
        benefits: ['Gym floor', 'Lockers'],
        ...(type === 'CUSTOM' ? { durationValue: 45, durationUnit: 'DAY' } : {}),
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: `${type} plan`,
        planType: type,
        priceMinor: 750_000,
        benefits: ['Gym floor', 'Lockers'],
        allowPartialPayment: false,
        accessDays: null,
        accessStartTime: null,
        accessEndTime: null,
        isActive: true,
        ...expected[type],
      });
      const [audit] = await auditFor(res.body.id, 'PLAN_CREATED');
      expect(audit!.actorUserId).toBe(admin.id);
      expect(audit!.after).toMatchObject({ planType: type, priceMinor: 750_000 });
    },
  );

  it('stores access days and hours, normalizing the day list', async () => {
    const res = await api().post('', {
      name: 'Ladies mornings',
      planType: 'MONTHLY',
      priceMinor: 400_000,
      accessDays: [5, 1, 3, 3],
      accessStartTime: '06:00',
      accessEndTime: '11:30',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      accessDays: [1, 3, 5],
      accessStartTime: '06:00',
      accessEndTime: '11:30',
    });

    const everyDay = await api().post('', {
      name: 'Every day',
      planType: 'MONTHLY',
      priceMinor: 400_000,
      accessDays: [1, 2, 3, 4, 5, 6, 7],
    });
    expect(everyDay.body.accessDays).toBeNull();
  });

  it.each([
    [{ planType: 'MONTHLY', durationValue: 2 }, 'durationValue'],
    [{ planType: 'ANNUAL', durationValue: 12, durationUnit: 'DAY' }, 'durationValue'],
    [{ planType: 'CUSTOM' }, 'durationValue'],
    [{ planType: 'CUSTOM', durationValue: 10 }, 'durationUnit'],
    [{ planType: 'CUSTOM', durationValue: 3651, durationUnit: 'DAY' }, 'durationValue'],
    [{ planType: 'CUSTOM', durationValue: 0, durationUnit: 'DAY' }, 'durationValue'],
    [{ planType: 'MONTHLY', priceMinor: -1 }, 'priceMinor'],
    [{ planType: 'MONTHLY', priceMinor: 10.5 }, 'priceMinor'],
    [{ planType: 'MONTHLY', accessStartTime: '09:00' }, 'accessEndTime'],
    [{ planType: 'MONTHLY', accessStartTime: '18:00', accessEndTime: '09:00' }, 'accessEndTime'],
    [{ planType: 'MONTHLY', accessStartTime: '25:00', accessEndTime: '26:00' }, 'accessStartTime'],
    [{ planType: 'MONTHLY', accessDays: [0] }, 'accessDays.0'],
    [{ planType: 'MONTHLY', accessDays: [] }, 'accessDays'],
    [{ planType: 'MONTHLY', benefits: [''] }, 'benefits.0'],
    [{ planType: 'MONTHLY', name: 'X' }, 'name'],
    [{ planType: 'WEEKLY' }, 'planType'],
  ])('rejects %j (%s)', async (fields, path) => {
    const res = await api().post('', { name: 'Rule check', priceMinor: 100_000, ...fields });
    expect(res.status).toBe(400);
    expect(detailPaths(res.body)).toContain(path);
    expect(await db.select().from(membershipPlans)).toHaveLength(0);
  });

  it('rejects unknown fields and duplicate names (case-insensitive)', async () => {
    const base = { name: 'Monthly Standard', planType: 'MONTHLY', priceMinor: 600_000 };
    expect((await api().post('', { ...base, isActive: false })).status).toBe(400);
    await api().post('', base).expect(201);
    const dup = await api().post('', { ...base, name: '  monthly standard ' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_PLAN_NAME');
  });
});

describe('update and archive plans', () => {
  it('re-checks the rules on the merged plan and audits only the changes', async () => {
    const plan = await createPlan({ name: 'Flexible', priceMinor: 500_000 });

    const bad = await api().patch(`/${plan.id}`, { durationValue: 2 });
    expect(bad.status).toBe(400);
    expect(detailPaths(bad.body)).toContain('durationValue');

    const custom = await api().patch(`/${plan.id}`, {
      planType: 'CUSTOM',
      durationValue: 10,
      durationUnit: 'DAY',
      priceMinor: 200_000,
    });
    expect(custom.status).toBe(200);
    expect(custom.body).toMatchObject({
      planType: 'CUSTOM',
      durationValue: 10,
      durationUnit: 'DAY',
    });
    const [audit] = await auditFor(plan.id, 'PLAN_UPDATED');
    expect(audit!.before).toEqual({
      planType: 'MONTHLY',
      durationValue: 1,
      durationUnit: 'MONTH',
      priceMinor: 500_000,
    });

    // Back to a fixed type without a duration: the fixed duration is filled in.
    const quarterly = await api().patch(`/${plan.id}`, { planType: 'QUARTERLY' });
    expect(quarterly.status).toBe(200);
    expect(quarterly.body).toMatchObject({ durationValue: 3, durationUnit: 'MONTH' });

    const hours = await api().patch(`/${plan.id}`, { accessStartTime: '07:00' });
    expect(hours.status).toBe(400);

    expect((await api().patch(`/${plan.id}`, {})).status).toBe(400);
    expect((await api().patch(`/${plan.id}`, { isActive: false })).status).toBe(400);
  });

  it('archives and restores a plan', async () => {
    const plan = await createPlan();
    const archived = await api().post(`/${plan.id}/archive`, { reason: 'Replaced by new pricing' });
    expect(archived.status).toBe(200);
    expect(archived.body.isActive).toBe(false);
    expect((await auditFor(plan.id, 'PLAN_ARCHIVED'))[0]!.reason).toBe('Replaced by new pricing');

    expect((await api().get('')).body.total).toBe(0);
    expect((await api().get('?status=archived')).body.total).toBe(1);

    const restored = await api().post(`/${plan.id}/unarchive`, {});
    expect(restored.body.isActive).toBe(true);
    expect(await auditFor(plan.id, 'PLAN_UNARCHIVED')).toHaveLength(1);
  });

  it('lists, filters and sorts plans', async () => {
    await createPlan({ name: 'Bravo', priceMinor: 300_000 });
    await createPlan({ name: 'alpha', priceMinor: 900_000 });
    await createPlan({
      name: 'Charlie',
      planType: 'ANNUAL',
      durationValue: 12,
      priceMinor: 100_000,
    });
    const names = (res: { body: { data: { name: string }[] } }) =>
      res.body.data.map((plan) => plan.name);

    expect(names(await api().get(''))).toEqual(['Charlie', 'Bravo', 'alpha']);
    expect(names(await api().get('?sort=name'))).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(names(await api().get('?sort=price&order=desc'))).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(names(await api().get('?planType=ANNUAL'))).toEqual(['Charlie']);
    expect(names(await api().get('?q=brav'))).toEqual(['Bravo']);
  });
});

describe('plan permissions', () => {
  it('lets only the Admin manage plans', async () => {
    const plan = await createPlan();
    for (const role of ['MANAGER', 'RECEPTIONIST', 'TRAINER', 'MEMBER'] as const) {
      const other = as(await signIn(app, await createUser({ role })));
      const body = { name: `${role} plan`, planType: 'MONTHLY', priceMinor: 1 };
      expect((await other.post('', body)).status, role).toBe(403);
      expect((await other.patch(`/${plan.id}`, { priceMinor: 1 })).status, role).toBe(403);
      expect((await other.post(`/${plan.id}/archive`, {})).status, role).toBe(403);
    }
    const [row] = await db.select().from(membershipPlans).where(eq(membershipPlans.id, plan.id));
    expect(row!.priceMinor).toBe(plan.priceMinor);
    expect(row!.isActive).toBe(true);
  });

  it('shows a member active plans only, and hides archived ones by id', async () => {
    const active = await createPlan({ name: 'Open' });
    const archived = await createPlan({ name: 'Retired', isActive: false });
    const member = as(await signIn(app, await createUser({ role: 'MEMBER' })));

    const all = await member.get('?status=all');
    expect(all.status).toBe(200);
    expect(all.body.data.map((plan: { id: string }) => plan.id)).toEqual([active.id]);
    expect((await member.get(`/${active.id}`)).status).toBe(200);
    expect((await member.get(`/${archived.id}`)).status).toBe(404);

    // Staff still see archived plans.
    expect((await api().get(`/${archived.id}`)).status).toBe(200);
  });

  it('refuses plans to a trainer (not in the matrix)', async () => {
    const trainer = as(await signIn(app, await createUser({ role: 'TRAINER' })));
    expect((await trainer.get('')).status).toBe(403);
  });
});
