import { randomUUID } from 'node:crypto';
import { addDays } from '@gms/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { attendanceRecords, auditLogs, members } from '../../src/db/schema';
import { gymToday } from '../../src/lib/dates';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import {
  createDevice,
  createMember,
  createMembership,
  createPlan,
  createUser,
  enrollMember,
  type TestUser,
} from '../setup/factories';

const app = testApp();

let admin: TestUser;
let session: Session;
let member: Awaited<ReturnType<typeof createMember>>;
let scanner: Awaited<ReturnType<typeof createDevice>>;
let today: string;

beforeEach(async () => {
  await resetTables();
  today = gymToday();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
  const plan = await createPlan({ name: 'Monthly Standard' });
  member = await createMember({ firstName: 'Hamza', lastName: 'Qureshi' });
  await createMembership(member, plan, {
    startDate: addDays(today, -5),
    endDate: addDays(today, 25),
  });
  scanner = await createDevice();
  await enrollMember(member, scanner.device, 'SIM-0001', admin);
});
afterAll(closeDb);

const as = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
});
const api = () => as(session);

/** A granted scan; returns the attendance row it created. */
async function checkIn() {
  const response = await request(app)
    .post('/api/v1/access/scan')
    .set('Authorization', scanner.authorization)
    .send({
      eventId: randomUUID(),
      matchResult: 'MATCH',
      templateRef: 'SIM-0001',
      occurredAt: new Date().toISOString(),
    });
  expect(response.body.decision).toBe('GRANTED');
  const [row] = await db.select().from(attendanceRecords);
  return row!;
}

describe('daily list', () => {
  it("lists today's check-ins with member, plan and source, and filters by search", async () => {
    const record = await checkIn();
    const today = await api().get('/attendance/today');
    expect(today.status).toBe(200);
    expect(today.body.total).toBe(1);
    expect(today.body.data[0]).toMatchObject({
      id: record.id,
      member: { id: member.id, firstName: 'Hamza', memberCode: member.memberCode },
      planName: 'Monthly Standard',
      source: 'SIMULATED',
      status: 'VALID',
      checkOutAt: null,
      correctionCount: 0,
    });

    expect((await api().get('/attendance/today?q=Hamza')).body.total).toBe(1);
    expect((await api().get('/attendance/today?q=Nobody')).body.total).toBe(0);
    expect((await api().get(`/attendance?date=${addDays(gymToday(), -1)}`)).body.total).toBe(0);
    expect((await api().get(`/attendance?memberId=${member.id}`)).body.total).toBe(1);
    expect((await api().get(`/members/${member.id}/attendance`)).body.total).toBe(1);
    const attempts = await api().get(`/members/${member.id}/access-attempts`);
    expect(attempts.body.total).toBe(1);
  });

  it('rejects unknown query fields', async () => {
    expect((await api().get('/attendance?foo=1')).status).toBe(400);
  });
});

describe('check-out', () => {
  it('sets the check-out time once; a second check-out → 409', async () => {
    const record = await checkIn();
    const first = await api().post(`/attendance/${record.id}/check-out`);
    expect(first.status).toBe(200);
    expect(first.body.checkOutAt).not.toBeNull();
    expect(new Date(first.body.checkOutAt).getTime()).toBeGreaterThan(
      new Date(first.body.checkInAt).getTime(),
    );
    const again = await api().post(`/attendance/${record.id}/check-out`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_OUT');
  });

  it('refuses a voided record and an unknown id', async () => {
    const record = await checkIn();
    await api().post(`/attendance/${record.id}/corrections`, {
      status: 'VOIDED',
      reason: 'Staff test scan',
    });
    const voided = await api().post(`/attendance/${record.id}/check-out`);
    expect(voided.status).toBe(409);
    expect(voided.body.error.code).toBe('ATTENDANCE_VOIDED');
    expect((await api().post(`/attendance/${randomUUID()}/check-out`)).status).toBe(404);
  });
});

describe('corrections', () => {
  it('records one correction per changed field, audits before/after, never overwrites silently', async () => {
    const record = await checkIn();
    const newIn = new Date(record.checkInAt.getTime() - 30 * 60_000).toISOString();
    const newOut = new Date(record.checkInAt.getTime() - 5 * 60_000).toISOString();
    const response = await api().post(`/attendance/${record.id}/corrections`, {
      checkInAt: newIn,
      checkOutAt: newOut,
      reason: 'Member forgot to scan on arrival',
    });
    expect(response.status).toBe(200);
    expect(response.body.correctionCount).toBe(2);
    expect(response.body.checkInAt).toBe(newIn);

    const history = await api().get(`/attendance/${record.id}/corrections`);
    expect(history.body.data).toHaveLength(2);
    expect(history.body.data.map((c: { field: string }) => c.field).sort()).toEqual([
      'CHECK_IN_AT',
      'CHECK_OUT_AT',
    ]);
    const checkInChange = history.body.data.find(
      (c: { field: string }) => c.field === 'CHECK_IN_AT',
    );
    expect(checkInChange).toMatchObject({
      oldValue: record.checkInAt.toISOString(),
      newValue: newIn,
      reason: 'Member forgot to scan on arrival',
      correctedByName: 'Ayesha Malik',
    });

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'ATTENDANCE_CORRECTED'));
    expect(audit).toMatchObject({ actorUserId: admin.id, entityId: record.id });
    expect(audit!.before).toEqual({
      CHECK_IN_AT: record.checkInAt.toISOString(),
      CHECK_OUT_AT: null,
    });
    expect(audit!.after).toEqual({ CHECK_IN_AT: newIn, CHECK_OUT_AT: newOut });
  });

  it('validates the times and requires a reason and a real change', async () => {
    const record = await checkIn();
    const url = `/attendance/${record.id}/corrections`;
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    expect((await api().post(url, { checkInAt: future, reason: 'Wrong' })).status).toBe(400);
    const before = new Date(record.checkInAt.getTime() - 60_000).toISOString();
    expect((await api().post(url, { checkOutAt: before, reason: 'Wrong' })).status).toBe(400);
    expect((await api().post(url, { status: 'VALID', reason: 'Same' })).status).toBe(422);
    expect((await api().post(url, { status: 'VOIDED' })).status).toBe(400);
    expect((await api().post(url, { reason: 'Nothing' })).status).toBe(400);
  });
});

describe('roles and scope', () => {
  it('a Receptionist can check in by hand and check out, but cannot correct', async () => {
    const receptionist = await createUser({ role: 'RECEPTIONIST' });
    const desk = as(await signIn(app, receptionist));
    const record = await checkIn();
    expect((await desk.post(`/attendance/${record.id}/check-out`)).status).toBe(200);
    const correction = await desk.post(`/attendance/${record.id}/corrections`, {
      status: 'VOIDED',
      reason: 'Test',
    });
    expect(correction.status).toBe(403);
  });

  it('a Trainer sees no attendance until members are assigned (Stage 6)', async () => {
    await checkIn();
    const trainer = as(await signIn(app, await createUser({ role: 'TRAINER' })));
    const list = await trainer.get('/attendance/today');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
    expect((await trainer.get(`/attendance?memberId=${member.id}`)).status).toBe(403);
    expect((await trainer.get(`/members/${member.id}/attendance`)).status).toBe(403);
    const [record] = await db.select().from(attendanceRecords);
    expect((await trainer.get(`/attendance/${record!.id}/corrections`)).status).toBe(403);
    expect(
      (await trainer.post('/attendance/manual-check-in', { memberId: member.id, reason: 'x' }))
        .status,
    ).toBe(403);
  });

  it('a member sees only their own valid check-ins at /me/attendance', async () => {
    const user = await createUser({ role: 'MEMBER', email: 'hamza.portal@example.test' });
    await db.update(members).set({ userId: user.id }).where(eq(members.id, member.id));
    const record = await checkIn();
    const portal = as(await signIn(app, user));
    const mine = await portal.get('/me/attendance');
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.data[0].id).toBe(record.id);
    expect(mine.body.data[0]).not.toHaveProperty('accessAttemptId');

    await api().post(`/attendance/${record.id}/corrections`, { status: 'VOIDED', reason: 'Test' });
    expect((await portal.get('/me/attendance')).body.total).toBe(0);
    // Staff routes stay closed to members.
    expect((await portal.get('/attendance/today')).status).toBe(403);
  });
});
