import { randomUUID } from 'node:crypto';
import { addDays } from '@gms/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import {
  accessAttempts,
  attendanceRecords,
  classSessions,
  fitnessClasses,
  trainerAssignments,
} from '../../src/db/schema';
import { gymLocalToInstant, gymToday } from '../../src/lib/dates';
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
      const body = (await get(staff, '/summary')).body;
      expect(body.members.total, role).toBe(1);
      expect(body.trainer, role).toBeNull();
    }
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    expect((await get(trainer, '/summary')).body).toEqual({
      // Stage 8: no whole-gym period totals for a Trainer either.
      period: null,
      members: null,
      memberships: null,
      attendance: null,
      billing: null,
      // Stage 6: the trainer's own schedule and members instead of whole-gym figures.
      trainer: { today: [], upcoming: [], assignedMembers: 0 },
    });
    expect((await get(trainer, '/activity')).body).toEqual([]);

    const member = await signIn(app, await createUser({ role: 'MEMBER' }));
    expect((await get(member, '/summary')).status).toBe(403);
  });
});

describe('dashboard attendance cards (scenario 16, Stage 4 cards)', () => {
  it('counts today’s valid check-ins and denials in gym time, matching raw SQL', async () => {
    const today = gymToday();
    const startOfToday = gymLocalToInstant(today, '00:00');
    const lastOfYesterday = new Date(startOfToday.getTime() - 1);
    const plan = await createPlan();
    const sana = await createMember({ firstName: 'Sana', lastName: 'Iqbal' });
    const membership = await createMembership(sana, plan, {
      startDate: addDays(today, -10),
      endDate: addDays(today, 20),
    });
    const checkIn = (when: Date, status: 'VALID' | 'VOIDED' = 'VALID') =>
      db.transaction(async (tx) => {
        const attendanceId = randomUUID();
        const [attempt] = await tx
          .insert(accessAttempts)
          .values({
            occurredAt: when,
            source: 'SIMULATED',
            memberId: sana.id,
            membershipId: membership.id,
            result: 'GRANTED',
            reason: 'GRANTED',
            attendanceId,
          })
          .returning();
        await tx.insert(attendanceRecords).values({
          id: attendanceId,
          memberId: sana.id,
          membershipId: membership.id,
          checkInAt: when,
          source: 'SIMULATED',
          accessAttemptId: attempt!.id,
          status,
        });
      });
    const deny = (when: Date) =>
      db.insert(accessAttempts).values({
        occurredAt: when,
        source: 'SIMULATED',
        memberId: null,
        result: 'DENIED',
        reason: 'MEMBER_NOT_RECOGNIZED',
      });
    await checkIn(lastOfYesterday);
    await checkIn(startOfToday);
    await checkIn(new Date(startOfToday.getTime() + 1_000), 'VOIDED');
    await checkIn(new Date(startOfToday.getTime() + 2_000));
    await deny(lastOfYesterday);
    await deny(startOfToday);

    const res = await get(session, '/summary');
    expect(res.status).toBe(200);
    // Hand-computed: two valid check-ins from midnight on (not the voided one, not yesterday's
    // last millisecond), and one denial from midnight on.
    expect(res.body.attendance).toMatchObject({ checkInsToday: 2, deniedToday: 1 });
    expect(res.body.attendance.recentCheckIns).toHaveLength(2);
    expect(res.body.attendance.recentCheckIns[0].member).toMatchObject({ id: sana.id });

    const raw = await db.execute<{ check_ins: number; denied: number }>(sql`
      select
        (select count(*)::int from attendance_records where status = 'VALID'
          and (check_in_at at time zone 'Asia/Karachi')::date = ${today}::date) as check_ins,
        (select count(*)::int from access_attempts where result = 'DENIED'
          and (occurred_at at time zone 'Asia/Karachi')::date = ${today}::date) as denied
    `);
    expect(raw.rows[0]).toEqual({ check_ins: 2, denied: 1 });
  });
});

describe('trainer dashboard (Stage 6)', () => {
  it("shows the trainer's own week and assigned-member count, matching raw SQL", async () => {
    const coach = await createUser({ role: 'TRAINER', firstName: 'Iqra', lastName: 'Coach' });
    const otherCoach = await createUser({ role: 'TRAINER' });
    const today = gymToday();
    const [cls] = await db
      .insert(fitnessClasses)
      .values({ name: 'Dash Spin', defaultDurationMinutes: 45, defaultCapacity: 10 })
      .returning();
    const at = (date: string, time: string) => gymLocalToInstant(date, time);
    await db.insert(classSessions).values([
      // Today 23:00 and in 3 days: counted. In 9 days, or another trainer's: not counted.
      {
        classId: cls!.id,
        trainerId: coach.id,
        startsAt: at(today, '23:00'),
        endsAt: at(today, '23:45'),
        capacity: 10,
      },
      {
        classId: cls!.id,
        trainerId: coach.id,
        startsAt: at(addDays(today, 3), '07:00'),
        endsAt: at(addDays(today, 3), '07:45'),
        capacity: 10,
      },
      {
        classId: cls!.id,
        trainerId: coach.id,
        startsAt: at(addDays(today, 9), '07:00'),
        endsAt: at(addDays(today, 9), '07:45'),
        capacity: 10,
      },
      {
        classId: cls!.id,
        trainerId: otherCoach.id,
        startsAt: at(addDays(today, 2), '07:00'),
        endsAt: at(addDays(today, 2), '07:45'),
        capacity: 10,
      },
    ]);
    const [kept, ended] = [await createMember(), await createMember()];
    const archived = await createMember({ archivedAt: new Date(), archivedBy: admin.id });
    await db.insert(trainerAssignments).values([
      { trainerId: coach.id, memberId: kept.id, startDate: today },
      { trainerId: coach.id, memberId: ended.id, startDate: addDays(today, -9), endDate: today },
      { trainerId: coach.id, memberId: archived.id, startDate: today },
    ]);

    const body = (await get(await signIn(app, coach), '/summary')).body;
    expect(body.trainer.today.map((i: { title: string }) => i.title)).toEqual(['Dash Spin']);
    expect(body.trainer.upcoming).toHaveLength(1);
    expect(body.trainer.assignedMembers).toBe(1);

    const raw = await db.execute<{ assigned: number }>(sql`
      select count(*)::int as assigned from trainer_assignments ta
      join members m on m.id = ta.member_id
      where ta.trainer_id = ${coach.id} and ta.end_date is null and m.archived_at is null
    `);
    expect(raw.rows[0]!.assigned).toBe(1);
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

describe('dashboard billing cards (scenario 16, Stage 5 cards)', () => {
  it('sums open and overdue balances and the net revenue this month, matching raw SQL', async () => {
    const today = gymToday();
    const member = await createMember();
    const post = (path: string, body: object) =>
      session.agent.post(`/api/v1${path}`).set('X-CSRF-Token', session.csrf).send(body);
    const charge = (amountDueMinor: number, dueDate: string) =>
      post('/invoices', {
        memberId: member.id,
        description: 'Locker rental',
        amountDueMinor,
        dueDate,
      });

    const late = (await charge(60_000, addDays(today, -3)).expect(201)).body;
    const partLate = (await charge(50_000, addDays(today, -3)).expect(201)).body;
    const open = (await charge(50_000, today).expect(201)).body;
    const paid = (await charge(30_000, today).expect(201)).body;
    await post('/payments', { invoiceId: partLate.id, amountMinor: 40_000, method: 'CASH' }).expect(
      201,
    );
    const payment = (
      await post('/payments', { invoiceId: paid.id, amountMinor: 30_000, method: 'CASH' }).expect(
        201,
      )
    ).body;
    await post(`/payments/${payment.id}/refunds`, {
      amountMinor: 5_000,
      reason: 'Locker broken for a week',
      method: 'CASH',
    }).expect(201);
    expect(open.status).toBe('PENDING');
    expect(late.status).toBe('OVERDUE');

    const res = await get(session, '/summary');
    expect(res.body.billing).toEqual({
      // late 60_000 + part-paid late 10_000 + open 50_000 + paid-then-part-refunded 5_000
      outstanding: { count: 4, amountMinor: 125_000 },
      // Only the unpaid late invoice: a part-paid one stays PARTIALLY_PAID (PLAN §3.4 order),
      // which keeps this card equal to /invoices?status=OVERDUE.
      overdue: { count: 1, amountMinor: 60_000 },
      revenue: {
        month: today.slice(0, 7),
        collectedMinor: 70_000,
        refundedMinor: 5_000,
        netMinor: 65_000,
        paymentCount: 2,
      },
    });
    const raw = await db.execute<{ collected: string }>(
      sql`select coalesce(sum(amount_minor), 0) as collected from payments where status = 'COMPLETED'`,
    );
    expect(Number(raw.rows[0]!.collected)).toBe(70_000);

    const receptionist = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
    const desk = (await get(receptionist, '/summary')).body.billing;
    expect(desk.revenue).toBeNull();
    expect(desk.outstanding).toEqual({ count: 4, amountMinor: 125_000 });
    expect(desk.overdue).toEqual({ count: 1, amountMinor: 60_000 });
  });
});
