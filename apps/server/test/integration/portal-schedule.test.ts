import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { appointments, classSessions, gymSettings } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createMember, createUser, type TestUser } from '../setup/factories';
import { ALL_WEEK, api, gymAt, gymDate, portalMember } from '../setup/scheduling';

const app = testApp();

let admin: Session;
let trainer: TestUser;
let classId: string;
let a: Awaited<ReturnType<typeof portalMember>>;
let b: Awaited<ReturnType<typeof portalMember>>;

beforeEach(async () => {
  await resetTables();
  admin = await signIn(app, await createUser({ role: 'ADMIN' }));
  trainer = await createUser({ role: 'TRAINER', firstName: 'Rabia', lastName: 'Coach' });
  await api(admin).put(`/trainers/${trainer.id}/availability`, { slots: ALL_WEEK });
  await api(admin).patch(`/trainers/${trainer.id}`, {
    bio: 'Pilates and posture.',
    specializations: ['Pilates'],
  });
  const cls = await api(admin).post('/classes', {
    name: 'Evening Pilates',
    defaultDurationMinutes: 60,
    defaultCapacity: 1,
    defaultTrainerId: trainer.id,
  });
  classId = cls.body.id;
  a = await portalMember(app, 'Amna');
  b = await portalMember(app, 'Bilal');
});
afterAll(closeDb);

const me = (m: { session: Session }) => ({
  get: (path: string) => api(m.session).get(`/me${path}`),
  post: (path: string, body: object = {}) => api(m.session).post(`/me${path}`, body),
});

async function scheduleSession(days: number, time = '18:00') {
  const res = await api(admin).post('/class-sessions', { classId, startsAt: gymAt(days, time) });
  return res.body.data[0] as { id: string };
}

describe('portal classes (§4.10)', () => {
  it('lists sessions with bookability, books, waitlists and cancels own bookings', async () => {
    const session = await scheduleSession(2);
    const listed = await me(a).get(`/class-sessions?from=${gymDate(0)}&to=${gymDate(6)}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ bookable: true, myBooking: null, spotsLeft: 1 });
    expect(listed.body.data[0]).not.toHaveProperty('cancelReason');

    const booked = await me(a).post('/bookings', { sessionId: session.id });
    expect(booked.status).toBe(201);
    expect(booked.body.status).toBe('BOOKED');
    const duplicate = await me(a).post('/bookings', { sessionId: session.id });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_BOOKING');

    const waitlisted = await me(b).post('/bookings', { sessionId: session.id });
    expect(waitlisted.body).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 });

    const afterA = await me(a).get(`/class-sessions?from=${gymDate(0)}&to=${gymDate(6)}`);
    expect(afterA.body.data[0]).toMatchObject({
      bookable: false,
      myBooking: { status: 'BOOKED' },
    });

    const cancelled = await me(a).post(`/bookings/${booked.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    const promoted = await me(b).get('/schedule');
    expect(promoted.body.data).toEqual([
      expect.objectContaining({ kind: 'CLASS', status: 'BOOKED', title: 'Evening Pilates' }),
    ]);
  });

  it('a guessed booking or appointment id of another member → 404', async () => {
    const session = await scheduleSession(2);
    const bBooking = await me(b).post('/bookings', { sessionId: session.id });
    expect(bBooking.status).toBe(201);
    const steal = await me(a).post(`/bookings/${bBooking.body.id}/cancel`);
    expect(steal.status).toBe(404);
    expect(JSON.stringify(steal.body)).not.toContain('Bilal');

    const [appt] = await db
      .insert(appointments)
      .values({
        trainerId: trainer.id,
        memberId: b.member.id,
        startsAt: new Date(gymAt(3, '10:00')),
        endsAt: new Date(gymAt(3, '11:00')),
      })
      .returning();
    expect((await me(a).post(`/appointments/${appt!.id}/cancel`)).status).toBe(404);
    expect((await me(a).get('/appointments')).body.data).toEqual([]);
    expect((await me(b).get('/appointments')).body.data).toHaveLength(1);

    // The member id in a body is never trusted: /me/bookings takes the session id only.
    const forged = await me(a).post('/bookings', { sessionId: session.id, memberId: b.member.id });
    expect(forged.status).toBe(400);
  });

  it('closes online booking and cancellation at the cutoff; staff can still act', async () => {
    await db.update(gymSettings).set({ classBookingCutoffMinutes: 120 });
    const startsAt = new Date(Date.now() + 90 * 60_000);
    const [soon] = await db
      .insert(classSessions)
      .values({
        classId,
        trainerId: trainer.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        capacity: 5,
      })
      .returning();
    const listed = await me(a).get(`/class-sessions?from=${gymDate(0)}&to=${gymDate(1)}`);
    const row = listed.body.data.find((s: { id: string }) => s.id === soon!.id);
    expect(row).toMatchObject({ bookable: false });
    expect(row.notBookableReason).toMatch(/closed/i);

    const late = await me(a).post('/bookings', { sessionId: soon!.id });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('BOOKING_CLOSED');

    const byStaff = await api(admin).post(`/class-sessions/${soon!.id}/bookings`, {
      memberId: a.member.id,
    });
    expect(byStaff.status).toBe(201);
    const lateCancel = await me(a).post(`/bookings/${byStaff.body.id}/cancel`);
    expect(lateCancel.status).toBe(409);
    expect(lateCancel.body.error.code).toBe('BOOKING_CLOSED');
  });

  it('explains why an ineligible member cannot book', async () => {
    await scheduleSession(2);
    const user = await createUser({ role: 'MEMBER', email: 'lapsed@example.test' });
    await createMember({ userId: user.id, email: 'lapsed@example.test' });
    const lapsed = await signIn(app, user);
    const listed = await api(lapsed).get(`/me/class-sessions?from=${gymDate(0)}&to=${gymDate(6)}`);
    expect(listed.body.data[0]).toMatchObject({ bookable: false });
    expect(listed.body.data[0].notBookableReason).toMatch(/no active membership/i);
  });
});

describe('portal trainers, schedule and appointments', () => {
  it('shows public trainer fields only, with assignedToMe', async () => {
    await api(admin).post('/trainer-assignments', { trainerId: trainer.id, memberId: a.member.id });
    const res = await me(a).get('/trainers');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: trainer.id,
        bio: 'Pilates and posture.',
        specializations: ['Pilates'],
        assignedToMe: true,
      }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('@example.test');
    expect((await me(b).get('/trainers')).body.data[0].assignedToMe).toBe(false);
  });

  it('lists and cancels own appointments, without staff notes', async () => {
    const booked = await api(admin).post('/appointments', {
      trainerId: trainer.id,
      memberId: a.member.id,
      startsAt: gymAt(3, '10:00'),
      notes: 'Watch left shoulder',
    });
    expect(booked.status).toBe(201);
    const list = await me(a).get('/appointments');
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('shoulder');

    const schedule = await me(a).get('/schedule');
    expect(schedule.body.data).toEqual([
      expect.objectContaining({ kind: 'APPOINTMENT', title: 'Personal training' }),
    ]);

    const cancelled = await me(a).post(`/appointments/${booked.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await me(a).get('/schedule')).body.data).toEqual([]);
  });
});
