import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { invoices, payments } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser, type TestUser } from '../setup/factories';
import { ALL_WEEK, api, eligibleMember, gymAt, gymDate, weekdayIn } from '../setup/scheduling';

const app = testApp();

let admin: Session;
let reception: Session;
let trainer: TestUser;
let otherTrainer: TestUser;
let trainerSession: Session;

beforeEach(async () => {
  await resetTables();
  admin = await signIn(app, await createUser({ role: 'ADMIN' }));
  reception = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
  trainer = await createUser({ role: 'TRAINER', firstName: 'Ayesha', lastName: 'Coach' });
  otherTrainer = await createUser({ role: 'TRAINER', firstName: 'Faisal', lastName: 'Coach' });
  trainerSession = await signIn(app, trainer);
});
afterAll(closeDb);

const assign = (trainerId: string, memberId: string) =>
  api(admin).post('/trainer-assignments', { trainerId, memberId });

describe('trainer profiles', () => {
  it('lists trainers only, with profile fields and member counts', async () => {
    const member = await eligibleMember();
    await assign(trainer.id, member.id);
    const res = await api(reception).get('/trainers');
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { id: string }) => t.id).sort()).toEqual(
      [trainer.id, otherTrainer.id].sort(),
    );
    const ayesha = res.body.data.find((t: { id: string }) => t.id === trainer.id);
    expect(ayesha).toMatchObject({
      isBookable: true,
      specializations: [],
      activeMemberCount: 1,
      hasWeeklyHours: false,
    });

    const notATrainer = await api(admin).get(`/trainers/${reception.me.user.id}`);
    expect(notATrainer.status).toBe(404);
  });

  it('admins edit everything; a trainer edits only their own bio and specializations', async () => {
    const byAdmin = await api(admin).patch(`/trainers/${trainer.id}`, {
      bio: 'Strength coach, 8 years.',
      specializations: ['Strength', 'Mobility', 'Strength'],
      certifications: ['NASM-CPT'],
      isBookable: true,
    });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body).toMatchObject({
      specializations: ['Strength', 'Mobility'],
      certifications: ['NASM-CPT'],
    });

    const self = await api(trainerSession).patch(`/trainers/${trainer.id}`, {
      bio: 'Strength and rehab.',
      specializations: ['Rehab'],
    });
    expect(self.status).toBe(200);
    expect(self.body).toMatchObject({ bio: 'Strength and rehab.', certifications: ['NASM-CPT'] });

    const selfBookable = await api(trainerSession).patch(`/trainers/${trainer.id}`, {
      isBookable: false,
    });
    expect(selfBookable.status).toBe(403);
    const other = await api(trainerSession).patch(`/trainers/${otherTrainer.id}`, { bio: 'x' });
    expect(other.status).toBe(403);
  });
});

describe('availability and time off', () => {
  it('flags trainers without weekly hours, counting hours that start later', async () => {
    const flag = async (id: string) =>
      (await api(reception).get(`/trainers/${id}`)).body.hasWeeklyHours as boolean;
    expect(await flag(trainer.id)).toBe(false);

    await api(admin).put(`/trainers/${trainer.id}/availability`, {
      slots: ALL_WEEK,
      effectiveFrom: gymDate(5),
    });
    expect(await flag(trainer.id)).toBe(true);
    expect(await flag(otherTrainer.id)).toBe(false);

    // Clearing the hours from today leaves nothing in force or upcoming.
    const cleared = await api(admin).put(`/trainers/${trainer.id}/availability`, { slots: [] });
    expect(cleared.status).toBe(200);
    expect(await flag(trainer.id)).toBe(false);
  });

  it('replaces the weekly hours from a date and keeps the change as upcoming', async () => {
    const now = await api(trainerSession).put(`/trainers/${trainer.id}/availability`, {
      slots: [{ weekday: 1, startTime: '07:00', endTime: '12:00' }],
    });
    expect(now.status).toBe(200);
    expect(now.body.current).toHaveLength(1);
    expect(now.body.upcoming).toBeNull();

    const later = await api(admin).put(`/trainers/${trainer.id}/availability`, {
      slots: ALL_WEEK,
      effectiveFrom: gymDate(10),
    });
    expect(later.status).toBe(200);
    expect(later.body.current).toHaveLength(1);
    expect(later.body.current[0].effectiveTo).toBe(gymDate(9));
    expect(later.body.upcoming).toMatchObject({ effectiveFrom: gymDate(10) });
    expect(later.body.upcoming.slots).toHaveLength(7);

    const past = await api(admin).put(`/trainers/${trainer.id}/availability`, {
      slots: [],
      effectiveFrom: gymDate(-1),
    });
    expect(past.status).toBe(400);
    const overlapping = await api(admin).put(`/trainers/${trainer.id}/availability`, {
      slots: [
        { weekday: 2, startTime: '07:00', endTime: '12:00' },
        { weekday: 2, startTime: '11:00', endTime: '14:00' },
      ],
    });
    expect(overlapping.status).toBe(400);
    const notMine = await api(trainerSession).put(`/trainers/${otherTrainer.id}/availability`, {
      slots: [],
    });
    expect(notMine.status).toBe(403);
  });

  it('available slots follow the weekday hours in force on that date', async () => {
    await api(admin).put(`/trainers/${trainer.id}/availability`, {
      slots: [{ weekday: weekdayIn(3), startTime: '08:00', endTime: '10:00' }],
    });
    const res = await api(admin).get(
      `/trainers/${trainer.id}/available-slots?date=${gymDate(3)}&durationMinutes=60`,
    );
    expect(res.body.data.map((s: { startsAt: string }) => s.startsAt)).toEqual([
      gymAt(3, '08:00'),
      gymAt(3, '08:30'),
      gymAt(3, '09:00'),
    ]);
    const otherDay = await api(admin).get(
      `/trainers/${trainer.id}/available-slots?date=${gymDate(4)}`,
    );
    expect(otherDay.body.data).toEqual([]);
  });

  it('adds and cancels time off; a trainer only for themselves', async () => {
    const off = await api(trainerSession).post(`/trainers/${trainer.id}/time-off`, {
      startsAt: gymAt(5, '00:00'),
      endsAt: gymAt(6, '00:00'),
      reason: 'Medical appointment',
    });
    expect(off.status).toBe(201);
    expect(off.body.status).toBe('ACTIVE');
    const availability = await api(reception).get(`/trainers/${trainer.id}/availability`);
    expect(availability.body.timeOff).toHaveLength(1);

    const forOther = await api(trainerSession).post(`/trainers/${otherTrainer.id}/time-off`, {
      startsAt: gymAt(5, '00:00'),
      endsAt: gymAt(6, '00:00'),
    });
    expect(forOther.status).toBe(403);
    const past = await api(admin).post(`/trainers/${trainer.id}/time-off`, {
      startsAt: gymAt(-3, '00:00'),
      endsAt: gymAt(-2, '00:00'),
    });
    expect(past.status).toBe(400);

    const cancelled = await api(trainerSession).post(`/time-off/${off.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    const again = await api(admin).post(`/time-off/${off.body.id}/cancel`);
    expect(again.status).toBe(409);
  });
});

describe('assignments', () => {
  it('assigns once, refuses non-trainers, and ends', async () => {
    const member = await eligibleMember();
    const created = await assign(trainer.id, member.id);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ trainer: { id: trainer.id }, endDate: null });

    const duplicate = await assign(trainer.id, member.id);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ASSIGNMENT_EXISTS');
    const notTrainer = await assign(reception.me.user.id, member.id);
    expect(notTrainer.status).toBe(409);
    expect(notTrainer.body.error.code).toBe('NOT_A_TRAINER');
    const future = await api(admin).post('/trainer-assignments', {
      trainerId: otherTrainer.id,
      memberId: member.id,
      startDate: gymDate(3),
    });
    expect(future.status).toBe(400);

    const ended = await api(admin).post(`/trainer-assignments/${created.body.id}/end`, {
      reason: 'Member moved to evening slot',
    });
    expect(ended.status).toBe(200);
    expect(ended.body.endDate).toBe(gymDate(0));
    expect((await api(admin).post(`/trainer-assignments/${created.body.id}/end`)).status).toBe(409);
    // Ended, so a new assignment is allowed again.
    expect((await assign(trainer.id, member.id)).status).toBe(201);
  });

  it('a trainer lists only their own assignments', async () => {
    const [m1, m2] = await Promise.all([eligibleMember(), eligibleMember()]);
    await assign(trainer.id, m1.id);
    await assign(otherTrainer.id, m2.id);
    const mine = await api(trainerSession).get('/trainer-assignments');
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((a: { member: { id: string } }) => a.member.id)).toEqual([m1.id]);
    const all = await api(reception).get('/trainer-assignments');
    expect(all.body.data).toHaveLength(2);
  });
});

describe('trainers see assigned members only, trainer-safe fields (scenario 12)', () => {
  it('reads assigned members without contact or billing data; never unassigned ones', async () => {
    const assigned = await eligibleMember({
      firstName: 'Noor',
      email: 'noor@example.test',
      notes: 'Prefers mornings',
      emergencyContactName: 'Ali',
      emergencyContactPhone: '+923001234567',
    });
    const unassigned = await eligibleMember({ firstName: 'Kamran', email: 'kamran@example.test' });
    await assign(trainer.id, assigned.id);
    const [invoice] = await db
      .insert(invoices)
      .values({
        memberId: assigned.id,
        description: 'Monthly fee',
        amountDueMinor: 500_000,
        dueDate: gymDate(5),
      })
      .returning();
    await db.insert(payments).values({
      invoiceId: invoice!.id,
      memberId: assigned.id,
      amountMinor: 100_000,
      method: 'CASH',
      status: 'COMPLETED',
      receivedAt: new Date(),
    });

    const own = await api(trainerSession).get(`/members/${assigned.id}`);
    expect(own.status).toBe(200);
    expect(own.body.firstName).toBe('Noor');
    const body = JSON.stringify(own.body);
    for (const leaked of ['noor@example.test', 'Prefers mornings', '+923001234567', 'phone']) {
      expect(body).not.toContain(leaked);
    }

    expect((await api(trainerSession).get(`/members/${unassigned.id}`)).status).toBe(403);
    expect((await api(trainerSession).get(`/members/${unassigned.id}/attendance`)).status).toBe(
      403,
    );
    expect((await api(trainerSession).get(`/members/${assigned.id}/payments`)).status).toBe(403);
    expect((await api(trainerSession).get(`/members/${assigned.id}/invoices`)).status).toBe(403);
    expect((await api(trainerSession).get('/payments')).status).toBe(403);

    const list = await api(trainerSession).get('/members');
    expect(list.body.data.map((m: { id: string }) => m.id)).toEqual([assigned.id]);

    const myMembers = await api(trainerSession).get(`/trainers/${trainer.id}/members`);
    expect(myMembers.status).toBe(200);
    expect(myMembers.body.data).toHaveLength(1);
    expect(JSON.stringify(myMembers.body)).not.toContain('noor@example.test');
    expect(myMembers.body.data[0].member.currentMembership).toMatchObject({ status: 'ACTIVE' });
    const theirMembers = await api(trainerSession).get(`/trainers/${otherTrainer.id}/members`);
    expect(theirMembers.status).toBe(403);

    // Ending the assignment removes access at once.
    const [assignment] = (await api(admin).get(`/trainer-assignments?memberId=${assigned.id}`)).body
      .data;
    await api(admin).post(`/trainer-assignments/${assignment.id}/end`);
    expect((await api(trainerSession).get(`/members/${assigned.id}`)).status).toBe(403);
  });
});

describe('schedules and shifts', () => {
  it("shows a trainer's classes, appointments and time off; other trainers see no member names", async () => {
    await api(admin).put(`/trainers/${trainer.id}/availability`, { slots: ALL_WEEK });
    const member = await eligibleMember({ firstName: 'Mehwish' });
    const cls = await api(admin).post('/classes', {
      name: 'Core Blast',
      defaultDurationMinutes: 45,
      defaultCapacity: 12,
      defaultTrainerId: trainer.id,
    });
    await api(admin).post('/class-sessions', {
      classId: cls.body.id,
      startsAt: gymAt(1, '08:00'),
      room: 'Studio 2',
    });
    await api(reception).post('/appointments', {
      trainerId: trainer.id,
      memberId: member.id,
      startsAt: gymAt(1, '12:00'),
    });
    await api(admin).post(`/trainers/${trainer.id}/time-off`, {
      startsAt: gymAt(2, '00:00'),
      endsAt: gymAt(3, '00:00'),
    });
    await api(admin).post('/shifts', {
      userId: trainer.id,
      startsAt: gymAt(1, '07:00'),
      endsAt: gymAt(1, '15:00'),
    });

    const path = `/trainers/${trainer.id}/schedule?from=${gymDate(1)}&to=${gymDate(2)}`;
    const mine = await api(trainerSession).get(path);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((i: { kind: string }) => i.kind)).toEqual([
      'SHIFT',
      'CLASS',
      'APPOINTMENT',
      'TIME_OFF',
    ]);
    const appt = mine.body.data.find((i: { kind: string }) => i.kind === 'APPOINTMENT');
    expect(appt.detail).toContain('Mehwish');
    const klass = mine.body.data.find((i: { kind: string }) => i.kind === 'CLASS');
    expect(klass).toMatchObject({ title: 'Core Blast', booked: 0, capacity: 12 });

    const otherSession = await signIn(app, otherTrainer);
    const seen = await api(otherSession).get(path);
    expect(seen.status).toBe(200);
    expect(seen.body.data.map((i: { kind: string }) => i.kind)).toEqual([
      'CLASS',
      'APPOINTMENT',
      'TIME_OFF',
    ]);
    expect(JSON.stringify(seen.body)).not.toContain('Mehwish');
  });

  it('plans shifts without overlaps; receptionists read only their own', async () => {
    const receptionId = reception.me.user.id;
    const first = await api(admin).post('/shifts', {
      userId: receptionId,
      startsAt: gymAt(1, '08:00'),
      endsAt: gymAt(1, '16:00'),
      roleNote: 'Front desk',
    });
    expect(first.status).toBe(201);
    const overlap = await api(admin).post('/shifts', {
      userId: receptionId,
      startsAt: gymAt(1, '15:00'),
      endsAt: gymAt(1, '20:00'),
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('SHIFT_OVERLAP');
    const tooLong = await api(admin).post('/shifts', {
      userId: receptionId,
      startsAt: gymAt(2, '00:00'),
      endsAt: gymAt(2, '17:00'),
    });
    expect(tooLong.status).toBe(400);
    await api(admin).post('/shifts', {
      userId: trainer.id,
      startsAt: gymAt(1, '08:00'),
      endsAt: gymAt(1, '12:00'),
    });

    const range = `from=${gymDate(0)}&to=${gymDate(7)}`;
    const own = await api(reception).get(`/shifts?${range}`);
    expect(own.status).toBe(200);
    expect(own.body.data).toHaveLength(1);
    expect(own.body.data[0]).toMatchObject({ userId: receptionId, roleNote: 'Front desk' });
    expect((await api(reception).get(`/shifts?${range}&userId=${trainer.id}`)).status).toBe(403);
    expect((await api(admin).get(`/shifts?${range}`)).body.data).toHaveLength(2);
    expect((await api(reception).post('/shifts', {})).status).toBe(403);

    const moved = await api(admin).patch(`/shifts/${first.body.id}`, { endsAt: gymAt(1, '14:00') });
    expect(moved.status).toBe(200);
    const cancelled = await api(admin).post(`/shifts/${first.body.id}/cancel`, {
      reason: 'Covered by another receptionist',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await api(reception).get(`/shifts?${range}`)).body.data).toHaveLength(0);
  });
});
