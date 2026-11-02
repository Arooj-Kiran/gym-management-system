import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, classBookings, classSessions, fitnessClasses } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createMember, createUser, type TestUser } from '../setup/factories';
import { api, eligibleMember, gymAt, gymDate } from '../setup/scheduling';

const app = testApp();

let admin: Session;
let reception: Session;
let trainerA: TestUser;
let trainerB: TestUser;
let trainerSession: Session;

beforeEach(async () => {
  await resetTables();
  admin = await signIn(app, await createUser({ role: 'ADMIN' }));
  reception = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
  trainerA = await createUser({ role: 'TRAINER', firstName: 'Sana', lastName: 'Trainer' });
  trainerB = await createUser({ role: 'TRAINER', firstName: 'Omar', lastName: 'Trainer' });
  trainerSession = await signIn(app, trainerA);
});
afterAll(closeDb);

async function createClass(name = 'Morning Yoga', capacity = 10) {
  const res = await api(admin).post('/classes', {
    name,
    defaultDurationMinutes: 60,
    defaultCapacity: capacity,
    defaultTrainerId: trainerA.id,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string };
}

async function createSession(body: Record<string, unknown>) {
  const res = await api(admin).post('/class-sessions', body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data[0] as { id: string; capacity: number };
}

const book = (sessionId: string, memberId: string, as: Session = reception) =>
  api(as).post(`/class-sessions/${sessionId}/bookings`, { memberId });

/** A session that started an hour ago, inserted directly (the API only schedules the future). */
async function startedSession(classId: string, trainerId: string) {
  const startsAt = new Date(Date.now() - 3_600_000);
  const [row] = await db
    .insert(classSessions)
    .values({ classId, trainerId, startsAt, endsAt: new Date(Date.now() + 600_000), capacity: 5 })
    .returning();
  return row!;
}

describe('class templates', () => {
  it('creates, refuses a duplicate name, updates and archives', async () => {
    const yoga = await createClass('Morning Yoga');
    const duplicate = await api(admin).post('/classes', {
      name: 'morning yoga',
      defaultDurationMinutes: 45,
      defaultCapacity: 8,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_CLASS_NAME');

    const updated = await api(admin).patch(`/classes/${yoga.id}`, { defaultCapacity: 12 });
    expect(updated.status).toBe(200);
    expect(updated.body.defaultCapacity).toBe(12);

    const archived = await api(admin).post(`/classes/${yoga.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.isActive).toBe(false);

    const session = await api(admin).post('/class-sessions', {
      classId: yoga.id,
      startsAt: gymAt(2, '07:00'),
    });
    expect(session.status).toBe(409);
    expect(session.body.error.code).toBe('CLASS_ARCHIVED');

    const list = await api(reception).get('/classes');
    expect(list.body.data).toHaveLength(0);
    const all = await api(reception).get('/classes?includeArchived=true');
    expect(all.body.data).toHaveLength(1);
  });
});

describe('class sessions', () => {
  it('schedules one session with the class defaults', async () => {
    const yoga = await createClass('Morning Yoga', 14);
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    expect(session).toMatchObject({
      className: 'Morning Yoga',
      capacity: 14,
      durationMinutes: 60,
      trainer: { id: trainerA.id },
      status: 'SCHEDULED',
      bookedCount: 0,
      spotsLeft: 14,
    });
  });

  it('creates a weekly series at the same gym time, all or nothing', async () => {
    const yoga = await createClass();
    const series = await api(admin).post('/class-sessions', {
      classId: yoga.id,
      startsAt: gymAt(1, '18:00'),
      repeatWeeklyUntil: gymDate(22),
      room: 'Studio 1',
    });
    expect(series.status).toBe(201);
    expect(series.body.data).toHaveLength(4);
    for (const [i, row] of (series.body.data as { startsAt: string }[]).entries()) {
      expect(row.startsAt).toBe(gymAt(1 + 7 * i, '18:00'));
    }

    // Trainer A is busy in week 3 of a new series → nothing from that series is created.
    await createSession({ classId: yoga.id, startsAt: gymAt(15, '06:30') });
    const before = await db.select({ id: classSessions.id }).from(classSessions);
    const clash = await api(admin).post('/class-sessions', {
      classId: yoga.id,
      startsAt: gymAt(1, '06:00'),
      repeatWeeklyUntil: gymDate(22),
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SCHEDULE_CONFLICT');
    const after = await db.select({ id: classSessions.id }).from(classSessions);
    expect(after).toHaveLength(before.length);
  });

  it('refuses a past start, a busy trainer and a busy room', async () => {
    const yoga = await createClass();
    const past = await api(admin).post('/class-sessions', {
      classId: yoga.id,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status).toBe(400);

    await createSession({ classId: yoga.id, startsAt: gymAt(3, '09:00'), room: 'Studio 1' });
    const trainerBusy = await api(admin).post('/class-sessions', {
      classId: yoga.id,
      startsAt: gymAt(3, '09:30'),
      room: 'Studio 2',
    });
    expect(trainerBusy.status).toBe(409);
    expect(trainerBusy.body.error.code).toBe('SCHEDULE_CONFLICT');

    const roomBusy = await api(admin).post('/class-sessions', {
      classId: yoga.id,
      trainerId: trainerB.id,
      startsAt: gymAt(3, '09:30'),
      room: 'studio 1',
    });
    expect(roomBusy.status).toBe(409);
    expect(roomBusy.body.error.code).toBe('ROOM_CONFLICT');

    const notTrainer = await api(admin).post('/class-sessions', {
      classId: yoga.id,
      trainerId: reception.me.user.id,
      startsAt: gymAt(4, '09:00'),
    });
    expect(notTrainer.status).toBe(409);
    expect(notTrainer.body.error.code).toBe('NOT_A_TRAINER');
  });

  it('cancelling a session cancels its bookings and closes it to new ones', async () => {
    const yoga = await createClass();
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const member = await eligibleMember();
    expect((await book(session.id, member.id)).status).toBe(201);

    const noReason = await api(admin).post(`/class-sessions/${session.id}/cancel`, {});
    expect(noReason.status).toBe(400);
    const cancelled = await api(admin).post(`/class-sessions/${session.id}/cancel`, {
      reason: 'Studio flooring repair',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const roster = await api(admin).get(`/class-sessions/${session.id}/bookings`);
    expect(roster.body.data.map((b: { status: string }) => b.status)).toEqual(['CANCELLED']);
    const again = await book(session.id, (await eligibleMember()).id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CLASS_NOT_BOOKABLE');
  });
});

describe('bookings, capacity and the waitlist (§8.4)', () => {
  it('a duplicate booking → 409 DUPLICATE_BOOKING', async () => {
    const yoga = await createClass();
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const member = await eligibleMember();
    const first = await book(session.id, member.id);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'BOOKED', waitlistPosition: null });

    const second = await book(session.id, member.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_BOOKING');
  });

  it('a member cannot hold two overlapping classes', async () => {
    const yoga = await createClass('Yoga');
    const spin = await createClass('Spin');
    const a = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const b = await createSession({
      classId: spin.id,
      trainerId: trainerB.id,
      startsAt: gymAt(2, '07:30'),
    });
    const member = await eligibleMember();
    expect((await book(a.id, member.id)).status).toBe(201);
    const clash = await book(b.id, member.id);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('MEMBER_SCHEDULE_CONFLICT');
  });

  it('refuses members without an active membership, archived or blocked', async () => {
    const yoga = await createClass();
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const noMembership = await book(session.id, (await createMember()).id);
    expect(noMembership.status).toBe(409);
    expect(noMembership.body.error.code).toBe('MEMBERSHIP_NOT_ELIGIBLE');

    const blocked = await eligibleMember({
      accessBlocked: true,
      accessBlockReason: 'Unpaid balance',
      accessBlockedAt: new Date(),
    });
    const blockedRes = await book(session.id, blocked.id);
    expect(blockedRes.status).toBe(409);
    expect(blockedRes.body.error.code).toBe('MEMBERSHIP_NOT_ELIGIBLE');

    const missing = await book(session.id, '00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
  });

  it('waitlists when full and promotes the first in line when a place is cancelled', async () => {
    const yoga = await createClass('Small Group', 2);
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const [m1, m2, m3, m4] = await Promise.all([1, 2, 3, 4].map(() => eligibleMember()));
    const b1 = await book(session.id, m1!.id);
    await book(session.id, m2!.id);
    const w1 = await book(session.id, m3!.id);
    const w2 = await book(session.id, m4!.id);
    expect(w1.body).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 });
    expect(w2.body).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 2 });

    const cancel = await api(reception).post(`/bookings/${b1.body.id}/cancel`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');

    const roster = await api(admin).get(`/class-sessions/${session.id}/bookings`);
    const byMember = new Map(
      (
        roster.body.data as { member: { id: string }; status: string; waitlistPosition: number }[]
      ).map((b) => [b.member.id, b]),
    );
    expect(byMember.get(m3!.id)).toMatchObject({ status: 'BOOKED', waitlistPosition: null });
    expect(byMember.get(m4!.id)).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 });

    const [promoted] = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.action, 'CLASS_WAITLIST_PROMOTED'), eq(auditLogs.entityId, w1.body.id)),
      );
    expect(promoted).toBeDefined();

    // Cancelling a waitlist place frees nothing and promotes nobody.
    const leave = await api(reception).post(`/bookings/${w2.body.id}/cancel`);
    expect(leave.status).toBe(200);
    const session2 = await api(admin).get(`/class-sessions/${session.id}`);
    expect(session2.body).toMatchObject({ bookedCount: 2, waitlistCount: 0, spotsLeft: 0 });

    const twice = await api(reception).post(`/bookings/${w2.body.id}/cancel`);
    expect(twice.status).toBe(409);
  });

  it('raising capacity promotes from the waitlist; lowering below the seated count → 409', async () => {
    const yoga = await createClass('Small Group', 1);
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const [m1, m2] = await Promise.all([eligibleMember(), eligibleMember()]);
    await book(session.id, m1.id);
    const waiting = await book(session.id, m2.id);
    expect(waiting.body.status).toBe('WAITLISTED');

    const raised = await api(admin).patch(`/class-sessions/${session.id}`, { capacity: 2 });
    expect(raised.status).toBe(200);
    expect(raised.body).toMatchObject({ bookedCount: 2, waitlistCount: 0 });

    const lowered = await api(admin).patch(`/class-sessions/${session.id}`, { capacity: 1 });
    expect(lowered.status).toBe(409);
    expect(lowered.body.error.code).toBe('CAPACITY_BELOW_BOOKINGS');
  });

  it('capacity is never exceeded under concurrent booking', async () => {
    const yoga = await createClass('Popular HIIT', 5);
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const crowd = await Promise.all(Array.from({ length: 16 }, () => eligibleMember()));

    const results = await Promise.all(crowd.map((m) => book(session.id, m.id)));
    expect(results.map((r) => r.status).every((s) => s === 201)).toBe(true);
    const statuses = results.map((r) => r.body.status as string);
    expect(statuses.filter((s) => s === 'BOOKED')).toHaveLength(5);
    expect(statuses.filter((s) => s === 'WAITLISTED')).toHaveLength(11);
    const positions = results
      .filter((r) => r.body.status === 'WAITLISTED')
      .map((r) => r.body.waitlistPosition as number)
      .sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));

    const [seated] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(classBookings)
      .where(
        and(eq(classBookings.sessionId, session.id), inArray(classBookings.status, ['BOOKED'])),
      );
    expect(seated!.count).toBe(5);
  });

  it('the same member booking concurrently gets exactly one place', async () => {
    const yoga = await createClass();
    const session = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const member = await eligibleMember();
    const results = await Promise.all(Array.from({ length: 6 }, () => book(session.id, member.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('DUPLICATE_BOOKING');
    }
    const rows = await db
      .select()
      .from(classBookings)
      .where(eq(classBookings.sessionId, session.id));
    expect(rows).toHaveLength(1);
  });
});

describe('attendance marking and trainer scope (OWN_SESSIONS)', () => {
  it('marks attended or no-show once started; trainers only for classes they teach', async () => {
    const yoga = await createClass();
    const member = await eligibleMember();
    const future = await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const futureBooking = await book(future.id, member.id);
    const early = await api(admin).post(`/bookings/${futureBooking.body.id}/attendance`, {
      status: 'ATTENDED',
    });
    expect(early.status).toBe(409);

    const mine = await startedSession(yoga.id, trainerA.id);
    const theirs = await startedSession(yoga.id, trainerB.id);
    const [myBooking] = await db
      .insert(classBookings)
      .values({ sessionId: mine.id, memberId: member.id, status: 'BOOKED' })
      .returning();
    const other = await eligibleMember();
    const [theirBooking] = await db
      .insert(classBookings)
      .values({ sessionId: theirs.id, memberId: other.id, status: 'BOOKED' })
      .returning();

    const marked = await api(trainerSession).post(`/bookings/${myBooking!.id}/attendance`, {
      status: 'ATTENDED',
    });
    expect(marked.status).toBe(200);
    expect(marked.body.status).toBe('ATTENDED');
    const noShow = await api(trainerSession).post(`/bookings/${myBooking!.id}/attendance`, {
      status: 'NO_SHOW',
    });
    expect(noShow.body.status).toBe('NO_SHOW');

    const notMine = await api(trainerSession).post(`/bookings/${theirBooking!.id}/attendance`, {
      status: 'ATTENDED',
    });
    expect(notMine.status).toBe(403);

    expect((await api(trainerSession).get(`/class-sessions/${mine.id}/bookings`)).status).toBe(200);
    expect((await api(trainerSession).get(`/class-sessions/${theirs.id}/bookings`)).status).toBe(
      403,
    );

    // Staff cannot book or cancel a class that has started.
    const late = await book(mine.id, (await eligibleMember()).id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('BOOKING_CLOSED');
  });

  it('trainers read every class but cannot schedule or book', async () => {
    const yoga = await createClass();
    await createSession({ classId: yoga.id, startsAt: gymAt(2, '07:00') });
    const list = await api(trainerSession).get(
      `/class-sessions?from=${gymDate(0)}&to=${gymDate(7)}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    const create = await api(trainerSession).post('/class-sessions', {
      classId: yoga.id,
      startsAt: gymAt(3, '07:00'),
    });
    expect(create.status).toBe(403);
    const created = await db.select().from(fitnessClasses);
    expect(created).toHaveLength(1);
  });
});
