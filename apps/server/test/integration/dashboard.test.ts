import { addDays } from '@gms/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
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

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
});
afterAll(closeDb);

const get = (s: Session, path: string) => s.agent.get(`/api/v1/dashboard${path}`);

describe('dashboard member cards (scenario 16, Stage 2 cards)', () => {
  it('matches raw SQL counts: current members and registrations today in gym time', async () => {
    const today = gymToday();
    await createMember({ registrationDate: today });
    await createMember({ registrationDate: today });
    await createMember({ registrationDate: '2026-01-15' });
    await createMember({ registrationDate: today, archivedAt: new Date(), archivedBy: admin.id });

    const res = await get(session, '/summary');
    expect(res.status).toBe(200);
    // Hand-computed: 3 current members, 2 of them registered today (the archived one is excluded).
    expect(res.body.members).toEqual({ total: 3, registeredToday: 2 });

    const raw = await db.execute<{ total: number; today: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where registration_date = ${today})::int as today
      from members where archived_at is null
    `);
    expect(raw.rows[0]).toEqual({ total: 3, today: 2 });
  });

  it('shows recent member activity without any personal field values', async () => {
    const created = await session.agent
      .post('/api/v1/members')
      .set('X-CSRF-Token', session.csrf)
      .send({
        firstName: 'Sana',
        lastName: 'Iqbal',
        email: 'sana.iqbal@example.test',
        phone: '0300 7654321',
      })
      .expect(201);

    const res = await get(session, '/activity');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        action: 'MEMBER_CREATED',
        entityType: 'MEMBER',
        createdAt: expect.any(String),
        actorName: 'Ayesha Malik',
        member: {
          id: created.body.id,
          memberCode: created.body.memberCode,
          firstName: 'Sana',
          lastName: 'Iqbal',
        },
      },
    ]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('example.test');
    expect(body).not.toContain('7654321');
  });

  it('caps activity at the 8 newest entries', async () => {
    for (let i = 0; i < 10; i += 1) {
      await session.agent
        .post('/api/v1/members')
        .set('X-CSRF-Token', session.csrf)
        .send({ firstName: 'Bulk', lastName: `Member ${i}`, phone: `0300 12300${10 + i}` })
        .expect(201);
    }
    const res = await get(session, '/activity');
    expect(res.body).toHaveLength(8);
    expect(res.body[0].member.lastName).toBe('Member 9');
  });

  it('gives the member cards to Admin, Manager and Receptionist, and not to a Trainer', async () => {
    await createMember();
    for (const role of ['MANAGER', 'RECEPTIONIST'] as const) {
      const staff = await signIn(app, await createUser({ role }));
      expect((await get(staff, '/summary')).body.members.total, role).toBe(1);
    }
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    expect((await get(trainer, '/summary')).body).toEqual({ members: null, memberships: null });
    expect((await get(trainer, '/activity')).body).toEqual([]);

    const member = await signIn(app, await createUser({ role: 'MEMBER' }));
    expect((await get(member, '/summary')).status).toBe(403);
  });
});

describe('dashboard membership cards (scenario 16, Stage 3 cards)', () => {
  it('counts members by their current membership and matches raw SQL', async () => {
    const today = gymToday();
    const plan = await createPlan();
    const span = (from: number, to: number) => ({
      startDate: addDays(today, from),
      endDate: addDays(today, to),
    });

    // Active, and expiring within the 7-day reminder window with nothing lined up.
    await createMembership(await createMember(), plan, span(-25, 4));
    // Active, expiring soon, but already renewed: counts as active, not expiring.
    const renewed = await createMember();
    await createMembership(renewed, plan, span(-27, 2));
    await createMembership(renewed, plan, { status: 'PENDING', ...span(3, 32) });
    // Active with plenty of time left.
    await createMembership(await createMember(), plan, span(-1, 28));
    // Pending (not started yet), and suspended.
    await createMembership(await createMember(), plan, { status: 'PENDING', ...span(2, 31) });
    await createMembership(await createMember(), plan, { status: 'SUSPENDED', ...span(-5, 24) });
    // ACTIVE past its end date (job not run yet) reads as expired; one EXPIRED row; one cancelled.
    await createMembership(await createMember(), plan, span(-31, -1));
    await createMembership(await createMember(), plan, { status: 'EXPIRED', ...span(-90, -61) });
    await createMembership(await createMember(), plan, { status: 'CANCELLED', ...span(-3, 26) });
    // A member with eleven old periods still counts once, by the latest one.
    const veteran = await createMember();
    for (let i = 0; i < 11; i += 1) {
      await createMembership(veteran, plan, {
        status: 'EXPIRED',
        ...span(-400 + i * 30, -371 + i * 30),
      });
    }
    // No membership at all, and an archived member: in neither count.
    await createMember();
    const archived = await createMember({ archivedAt: new Date(), archivedBy: admin.id });
    await createMembership(archived, plan, span(-25, 3));

    const res = await get(session, '/summary');
    expect(res.status).toBe(200);
    // Hand-computed from the rows above.
    expect(res.body.memberships).toEqual({
      active: 3,
      pending: 1,
      suspended: 1,
      expired: 3,
      cancelled: 1,
      expiringSoon: 1,
      expiringWithinDays: 7,
    });

    const raw = await db.execute<{ status: string; n: number }>(sql`
      with current_membership as (
        select distinct on (m.id) m.id,
          case when ms.status = 'ACTIVE' and ms.end_date < ${today}::date then 'EXPIRED'
               else ms.status::text end as status
        from members m
        join memberships ms on ms.member_id = m.id
        where m.archived_at is null
        order by m.id,
          case when ms.status in ('PENDING', 'ACTIVE', 'SUSPENDED')
                and ms.start_date <= ${today}::date then 0
               when ms.status in ('PENDING', 'ACTIVE', 'SUSPENDED') then 1 else 2 end,
          ms.start_date desc
      )
      select status, count(*)::int as n from current_membership group by status
    `);
    expect(Object.fromEntries(raw.rows.map((r) => [r.status, r.n]))).toEqual({
      ACTIVE: 3,
      PENDING: 1,
      SUSPENDED: 1,
      EXPIRED: 3,
      CANCELLED: 1,
    });
  });

  it('uses the reminder window from settings for expiring soon', async () => {
    const today = gymToday();
    const plan = await createPlan();
    await createMembership(await createMember(), plan, {
      startDate: addDays(today, -20),
      endDate: addDays(today, 10),
    });
    expect((await get(session, '/summary')).body.memberships.expiringSoon).toBe(0);
    await db.execute(sql`update gym_settings set expiry_reminder_days = 14`);
    expect((await get(session, '/summary')).body.memberships).toMatchObject({
      expiringSoon: 1,
      expiringWithinDays: 14,
    });
  });

  it('includes membership changes in recent activity, linked to the member', async () => {
    const plan = await createPlan();
    const member = await createMember({ firstName: 'Zara', lastName: 'Ahmed' });
    const created = await session.agent
      .post('/api/v1/memberships')
      .set('X-CSRF-Token', session.csrf)
      .send({ memberId: member.id, planId: plan.id })
      .expect(201);
    const res = await get(session, '/activity');
    expect(res.body[0]).toEqual({
      id: expect.any(String),
      action: 'MEMBERSHIP_ASSIGNED',
      entityType: 'MEMBERSHIP',
      createdAt: expect.any(String),
      actorName: 'Ayesha Malik',
      member: {
        id: member.id,
        memberCode: member.memberCode,
        firstName: 'Zara',
        lastName: 'Ahmed',
      },
    });
    expect(created.body.memberId).toBe(member.id);
  });
});
