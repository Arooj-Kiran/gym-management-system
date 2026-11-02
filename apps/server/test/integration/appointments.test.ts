import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { appointments, trainerAssignments } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createMember, createUser, type TestUser } from '../setup/factories';
import { ALL_WEEK, api, eligibleMember, gymAt, gymDate, weekdayIn } from '../setup/scheduling';

const app = testApp();

let admin: Session;
let reception: Session;
let trainer: TestUser;
let otherTrainer: TestUser;
let trainerSession: Session;
let member: Awaited<ReturnType<typeof eligibleMember>>;

beforeEach(async () => {
  await resetTables();
  admin = await signIn(app, await createUser({ role: 'ADMIN' }));
  reception = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
  trainer = await createUser({ role: 'TRAINER', firstName: 'Hira', lastName: 'Coach' });
  otherTrainer = await createUser({ role: 'TRAINER', firstName: 'Danish', lastName: 'Coach' });
  trainerSession = await signIn(app, trainer);
  for (const t of [trainer, otherTrainer]) {
    const res = await api(admin).put(`/trainers/${t.id}/availability`, { slots: ALL_WEEK });
    expect(res.status).toBe(200);
  }
  member = await eligibleMember({ firstName: 'Zara' });
});
afterAll(closeDb);

const book = (as: Session, body: Record<string, unknown>) => api(as).post('/appointments', body);

async function createClassSession(trainerId: string, startsAt: string) {
  const cls = await api(admin).post('/classes', {
    name: `Class ${startsAt}`,
    defaultDurationMinutes: 60,
    defaultCapacity: 10,
  });
  const res = await api(admin).post('/class-sessions', {
    classId: cls.body.id,
    trainerId,
    startsAt,
  });
  return res;
}

describe('personal-training appointments', () => {
  it('books inside availability and refuses outside it or in the past', async () => {
    const ok = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
      durationMinutes: 60,
      notes: 'Knee rehab focus',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      status: 'BOOKED',
      durationMinutes: 60,
      trainer: { id: trainer.id },
      member: { id: member.id },
      notes: 'Knee rehab focus',
    });

    const early = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '05:00'),
    });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('OUTSIDE_AVAILABILITY');
    // The refusal names the time asked for and the hours the trainer does work that day.
    expect(early.body.error.message).toMatch(
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) 05:00–06:00 is outside the trainer's hours that day \(06:00–22:00\)\.$/,
    );

    // A weekday the trainer does not work at all says so.
    const offDay = weekdayIn(4);
    await api(admin).put(`/trainers/${otherTrainer.id}/availability`, {
      slots: ALL_WEEK.filter((slot) => slot.weekday !== offDay),
    });
    const dayOff = await book(reception, {
      trainerId: otherTrainer.id,
      memberId: member.id,
      startsAt: gymAt(4, '10:00'),
    });
    expect(dayOff.status).toBe(409);
    expect(dayOff.body.error).toMatchObject({
      code: 'OUTSIDE_AVAILABILITY',
      message: expect.stringMatching(/^The trainer has no weekly hours on \w{3}, so no session/),
    });

    const past = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.status).toBe(400);
  });

  it('a trainer double-booked across a class and an appointment → 409 (both ways)', async () => {
    const cls = await createClassSession(trainer.id, gymAt(2, '10:00'));
    expect(cls.status).toBe(201);
    const overClass = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:30'),
    });
    expect(overClass.status).toBe(409);
    expect(overClass.body.error.code).toBe('SCHEDULE_CONFLICT');

    const appt = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(3, '10:00'),
    });
    expect(appt.status).toBe(201);
    const overAppt = await createClassSession(trainer.id, gymAt(3, '10:30'));
    expect(overAppt.status).toBe(409);
    expect(overAppt.body.error.code).toBe('SCHEDULE_CONFLICT');

    const otherMember = await eligibleMember();
    const sameSlot = await book(reception, {
      trainerId: trainer.id,
      memberId: otherMember.id,
      startsAt: gymAt(3, '10:00'),
    });
    expect(sameSlot.status).toBe(409);
    expect(sameSlot.body.error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('a member cannot be in a class and a session at once', async () => {
    const cls = await createClassSession(otherTrainer.id, gymAt(2, '10:00'));
    const booking = await api(reception).post(`/class-sessions/${cls.body.data[0].id}/bookings`, {
      memberId: member.id,
    });
    expect(booking.status).toBe(201);
    const clash = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:30'),
    });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('MEMBER_SCHEDULE_CONFLICT');
  });

  it('time off blocks appointments, and cannot cover booked ones', async () => {
    const off = await api(admin).post(`/trainers/${trainer.id}/time-off`, {
      startsAt: gymAt(4, '00:00'),
      endsAt: gymAt(5, '00:00'),
      reason: 'Family wedding',
    });
    expect(off.status).toBe(201);
    const during = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(4, '12:00'),
    });
    expect(during.status).toBe(409);
    expect(during.body.error.code).toBe('SCHEDULE_CONFLICT');

    await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(6, '12:00'),
    });
    const overBooked = await api(admin).post(`/trainers/${trainer.id}/time-off`, {
      startsAt: gymAt(6, '00:00'),
      endsAt: gymAt(7, '00:00'),
    });
    expect(overBooked.status).toBe(409);
    expect(overBooked.body.error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('refuses ineligible members and trainers who are not bookable', async () => {
    const lapsed = await createMember();
    const res = await book(reception, {
      trainerId: trainer.id,
      memberId: lapsed.id,
      startsAt: gymAt(2, '10:00'),
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MEMBERSHIP_NOT_ELIGIBLE');

    await api(admin).patch(`/trainers/${trainer.id}`, { isBookable: false });
    const notBookable = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
    });
    expect(notBookable.status).toBe(409);
    expect(notBookable.body.error.code).toBe('TRAINER_NOT_BOOKABLE');
  });

  it('concurrent bookings of one trainer slot: exactly one wins', async () => {
    const crowd = await Promise.all(Array.from({ length: 6 }, () => eligibleMember()));
    const results = await Promise.all(
      crowd.map((m) =>
        book(reception, { trainerId: trainer.id, memberId: m.id, startsAt: gymAt(2, '15:00') }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) {
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('SCHEDULE_CONFLICT');
    }
    const rows = await db.select().from(appointments).where(eq(appointments.trainerId, trainer.id));
    expect(rows).toHaveLength(1);
  });

  it('reschedules, cancels, and completes only after the start', async () => {
    const appt = await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
    });
    const moved = await api(reception).patch(`/appointments/${appt.body.id}`, {
      startsAt: gymAt(2, '11:00'),
    });
    expect(moved.status).toBe(200);
    expect(moved.body.startsAt).toBe(gymAt(2, '11:00'));

    const tooEarly = await api(reception).post(`/appointments/${appt.body.id}/complete`);
    expect(tooEarly.status).toBe(409);

    const cancelled = await api(reception).post(`/appointments/${appt.body.id}/cancel`, {
      reason: 'Member unwell',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const again = await api(reception).post(`/appointments/${appt.body.id}/cancel`);
    expect(again.status).toBe(409);

    // A past appointment (inserted directly) can be completed.
    const [past] = await db
      .insert(appointments)
      .values({
        trainerId: trainer.id,
        memberId: member.id,
        startsAt: new Date(Date.now() - 2 * 3_600_000),
        endsAt: new Date(Date.now() - 3_600_000),
      })
      .returning();
    const done = await api(trainerSession).post(`/appointments/${past!.id}/no-show`);
    expect(done.status).toBe(403); // not assigned to this trainer yet
    await db.insert(trainerAssignments).values({
      trainerId: trainer.id,
      memberId: member.id,
      startDate: gymDate(0),
    });
    const completed = await api(trainerSession).post(`/appointments/${past!.id}/complete`);
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
  });

  it('offers free slots on the 30-minute grid, skipping busy times', async () => {
    await book(reception, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
    });
    const res = await api(reception).get(
      `/trainers/${trainer.id}/available-slots?date=${gymDate(2)}&durationMinutes=60`,
    );
    expect(res.status).toBe(200);
    const starts = (res.body.data as { startsAt: string }[]).map((s) => s.startsAt);
    expect(starts).toContain(gymAt(2, '06:00'));
    expect(starts).toContain(gymAt(2, '11:00'));
    expect(starts).toContain(gymAt(2, '21:00'));
    expect(starts).not.toContain(gymAt(2, '09:30'));
    expect(starts).not.toContain(gymAt(2, '10:00'));
    expect(starts).not.toContain(gymAt(2, '10:30'));
    expect(starts).not.toContain(gymAt(2, '21:30'));
  });
});

describe('trainer scope for appointments (scenario 12)', () => {
  it('trainers book only for themselves and only their assigned members', async () => {
    const forOther = await book(trainerSession, {
      trainerId: otherTrainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
    });
    expect(forOther.status).toBe(403);
    const unassigned = await book(trainerSession, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
    });
    expect(unassigned.status).toBe(403);

    const assign = await api(admin).post('/trainer-assignments', {
      trainerId: trainer.id,
      memberId: member.id,
    });
    expect(assign.status).toBe(201);
    const mine = await book(trainerSession, {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
    });
    expect(mine.status).toBe(201);
  });

  it('trainers list and read only their own appointments', async () => {
    const theirs = await book(reception, {
      trainerId: otherTrainer.id,
      memberId: member.id,
      startsAt: gymAt(2, '10:00'),
    });
    const list = await api(trainerSession).get('/appointments');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
    const filtered = await api(trainerSession).get(`/appointments?trainerId=${otherTrainer.id}`);
    expect(filtered.status).toBe(403);
    const read = await api(trainerSession).get(`/appointments/${theirs.body.id}`);
    expect(read.status).toBe(403);
    const cancel = await api(trainerSession).post(`/appointments/${theirs.body.id}/cancel`);
    expect(cancel.status).toBe(403);

    const all = await api(reception).get('/appointments');
    expect(all.body.data).toHaveLength(1);
  });
});
