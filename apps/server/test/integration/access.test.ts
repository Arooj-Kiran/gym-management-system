import { randomUUID } from 'node:crypto';
import { addDays, type AccessDecision } from '@gms/shared';
import { and, count, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config/env';
import { closeDb, db } from '../../src/db/client';
import {
  accessAttempts,
  attendanceRecords,
  auditLogs,
  biometricEnrollments,
  members,
  memberships,
} from '../../src/db/schema';
import { gymToday } from '../../src/lib/dates';
import { gymNow } from '../../src/modules/access/eligibility';
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

/**
 * PLAN §8.3 mandatory biometric test set and Section 19 scenarios 4–9 and 15, end to end through
 * the device-key scan route. Every scan goes through the one AccessDecisionService.
 */

const app = testApp();

type Device = Awaited<ReturnType<typeof createDevice>>;
type Member = Awaited<ReturnType<typeof createMember>>;

let admin: TestUser;
let session: Session;
let plan: Awaited<ReturnType<typeof createPlan>>;
let scanner: Device;
let member: Member;
let today: string;

beforeEach(async () => {
  await resetTables();
  today = gymToday();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
  plan = await createPlan({ name: 'Monthly Standard' });
  scanner = await createDevice();
  member = await createMember({ firstName: 'Hamza', lastName: 'Qureshi' });
  await enrollMember(member, scanner.device, 'SIM-0001', admin);
});
afterAll(closeDb);

const api = () => ({
  get: (path: string) => session.agent.get(`/api/v1${path}`),
  post: (path: string, body: object = {}) =>
    session.agent.post(`/api/v1${path}`).set('X-CSRF-Token', session.csrf).send(body),
});

function scan(
  body: Record<string, unknown> = {},
  device: Device = scanner,
  target: ReturnType<typeof testApp> = app,
) {
  return request(target)
    .post('/api/v1/access/scan')
    .set('Authorization', device.authorization)
    .send({
      eventId: randomUUID(),
      matchResult: 'MATCH',
      templateRef: 'SIM-0001',
      occurredAt: new Date().toISOString(),
      ...body,
    });
}

/** An ACTIVE membership covering today, ten days in. */
const activeMembership = (overrides: Partial<Parameters<typeof createMembership>[2]> = {}) =>
  createMembership(member, plan, {
    startDate: addDays(today, -10),
    endDate: addDays(today, 20),
    ...overrides,
  });

const countAttendance = async (memberId = member.id) =>
  (
    await db
      .select({ n: count() })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.memberId, memberId))
  )[0]!.n;

const allAttempts = () => db.select().from(accessAttempts).orderBy(accessAttempts.receivedAt);

function expectDenied(decision: AccessDecision, reason: AccessDecision['reason']) {
  expect(decision.decision).toBe('DENIED');
  expect(decision.reason).toBe(reason);
  // A denial never shows membership details, and at most the first name.
  expect(decision.membership).toBeUndefined();
  if (decision.member) expect(Object.keys(decision.member)).toEqual(['firstName']);
}

describe('PLAN §8.3 mandatory set', () => {
  it('1. active → GRANTED, with one attendance row and one committed GRANTED attempt', async () => {
    const membership = await activeMembership();
    const response = await scan();
    expect(response.status).toBe(200);
    const decision = response.body as AccessDecision;
    expect(decision).toMatchObject({
      decision: 'GRANTED',
      reason: 'GRANTED',
      source: 'SIMULATED',
      duplicate: false,
      deviceId: scanner.device.id,
      member: { firstName: 'Hamza', memberCode: member.memberCode, photoUrl: null },
      membership: { planName: 'Monthly Standard', endDate: membership.endDate },
    });

    const attempts = await allAttempts();
    expect(attempts).toHaveLength(1);
    const [attendance] = await db.select().from(attendanceRecords);
    expect(attempts[0]).toMatchObject({
      id: decision.attemptId,
      result: 'GRANTED',
      source: 'SIMULATED',
      memberId: member.id,
      membershipId: membership.id,
      attendanceId: attendance!.id,
      deviceId: scanner.device.id,
    });
    expect(attendance).toMatchObject({
      memberId: member.id,
      membershipId: membership.id,
      source: 'SIMULATED',
      status: 'VALID',
      accessAttemptId: decision.attemptId,
      checkOutAt: null,
    });
  });

  it('2. active, then cancelled → the next scan is DENIED immediately, even inside the duplicate window', async () => {
    const membership = await activeMembership();
    expect((await scan()).body.decision).toBe('GRANTED');

    const cancel = await api().post(`/memberships/${membership.id}/cancel`, {
      reason: 'Member asked to cancel',
    });
    expect(cancel.status).toBe(200);

    const next = await scan();
    expect(next.status).toBe(200);
    expectDenied(next.body, 'MEMBERSHIP_CANCELLED');
    expect(next.body.duplicate).toBe(false);
    // History stays intact: the first check-in and both attempts remain.
    expect(await countAttendance()).toBe(1);
    expect((await allAttempts()).map((a) => a.result)).toEqual(['GRANTED', 'DENIED']);
  });

  it('3. expired → DENIED', async () => {
    await createMembership(member, plan, {
      status: 'EXPIRED',
      startDate: addDays(today, -40),
      endDate: addDays(today, -10),
    });
    expectDenied((await scan()).body, 'MEMBERSHIP_EXPIRED');
    expect(await countAttendance()).toBe(0);
  });

  it('4. suspended → DENIED', async () => {
    await activeMembership({ status: 'SUSPENDED' });
    expectDenied((await scan()).body, 'MEMBERSHIP_SUSPENDED');
  });

  it('5. unknown fingerprint → MEMBER_NOT_RECOGNIZED with no member attached', async () => {
    await activeMembership();
    const response = await scan({ matchResult: 'NO_MATCH', templateRef: undefined });
    expectDenied(response.body, 'MEMBER_NOT_RECOGNIZED');
    expect(response.body.member).toBeUndefined();
    const [attempt] = await allAttempts();
    expect(attempt).toMatchObject({ memberId: null, reason: 'MEMBER_NOT_RECOGNIZED' });
  });

  it('6. scanner unavailable → DENIED SCANNER_UNAVAILABLE with the error code logged', async () => {
    await activeMembership();
    const response = await scan({
      matchResult: 'DEVICE_ERROR',
      templateRef: undefined,
      errorCode: 'SENSOR_TIMEOUT',
    });
    expect(response.status).toBe(200);
    expectDenied(response.body, 'SCANNER_UNAVAILABLE');
    const [attempt] = await allAttempts();
    expect(attempt).toMatchObject({ errorCode: 'SENSOR_TIMEOUT', memberId: null });
    expect(await countAttendance()).toBe(0);
  });

  it('7. authorization unavailable → DENIED (simulated eligibility failure)', async () => {
    await activeMembership();
    const response = await api().post('/access/simulate', {
      deviceId: scanner.device.id,
      templateRef: 'SIM-0001',
      scenario: 'AUTHORIZATION_UNAVAILABLE',
    });
    expect(response.status).toBe(200);
    expectDenied(response.body, 'AUTHORIZATION_UNAVAILABLE');
    expect(await countAttendance()).toBe(0);
    const attempts = await allAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ result: 'DENIED', reason: 'AUTHORIZATION_UNAVAILABLE' });
  });
});

describe('PLAN §8.3 additional cases', () => {
  it('denies a PENDING membership', async () => {
    await activeMembership({ status: 'PENDING' });
    expectDenied((await scan()).body, 'MEMBERSHIP_NOT_ACTIVATED');
  });

  it('denies a membership that has not started yet', async () => {
    await createMembership(member, plan, {
      startDate: addDays(today, 1),
      endDate: addDays(today, 30),
    });
    expectDenied((await scan()).body, 'MEMBERSHIP_NOT_STARTED');
  });

  it('denies an inactive and an archived member', async () => {
    await activeMembership();
    await db.update(members).set({ accountStatus: 'INACTIVE' }).where(eq(members.id, member.id));
    const inactive = (await scan()).body as AccessDecision;
    expectDenied(inactive, 'MEMBER_INACTIVE');
    expect(inactive.member).toEqual({ firstName: 'Hamza' });

    await db
      .update(members)
      .set({ accountStatus: 'ACTIVE', archivedAt: new Date(), archivedBy: admin.id })
      .where(eq(members.id, member.id));
    expectDenied((await scan()).body, 'MEMBER_INACTIVE');
  });

  it('denies an access-blocked member', async () => {
    await activeMembership();
    await db
      .update(members)
      .set({ accessBlocked: true, accessBlockedAt: new Date() })
      .where(eq(members.id, member.id));
    expectDenied((await scan()).body, 'ACCESS_BLOCKED');
  });

  it('denies outside the plan days and hours', async () => {
    const otherDay = (gymNow(config.gymTimezone).isoWeekday % 7) + 1;
    await activeMembership({ accessDaysSnapshot: [otherDay] });
    expectDenied((await scan()).body, 'OUTSIDE_ACCESS_HOURS');
  });

  it('a duplicate scan inside the window keeps one attendance row and marks the attempt duplicate', async () => {
    await activeMembership();
    const first = (await scan()).body as AccessDecision;
    const second = (await scan()).body as AccessDecision;
    expect(first).toMatchObject({ decision: 'GRANTED', duplicate: false });
    expect(second).toMatchObject({ decision: 'GRANTED', duplicate: true });
    expect(second.attemptId).not.toBe(first.attemptId);

    expect(await countAttendance()).toBe(1);
    const attempts = await allAttempts();
    expect(attempts.map((a) => a.isDuplicate)).toEqual([false, true]);
    expect(attempts[1]!.attendanceId).toBe(attempts[0]!.attendanceId);
  });

  it('a scan outside the window creates a new attendance row', async () => {
    const noWindow = testApp(undefined, { duplicateWindowSeconds: 0 });
    await activeMembership();
    await scan({}, scanner, noWindow);
    const second = (await scan({}, scanner, noWindow)).body as AccessDecision;
    expect(second).toMatchObject({ decision: 'GRANTED', duplicate: false });
    expect(await countAttendance()).toBe(2);
  });

  it('a duplicate eventId returns the identical decision and writes no new row', async () => {
    const membership = await activeMembership();
    const eventId = randomUUID();
    const first = await scan({ eventId });
    // The membership is cancelled in between: a retry still replays the stored decision.
    await api().post(`/memberships/${membership.id}/cancel`, { reason: 'Moved away' });
    const retry = await scan({ eventId });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(await allAttempts()).toHaveLength(1);
    expect(await countAttendance()).toBe(1);
  });

  it('a check-out does not make a later scan eligible', async () => {
    const membership = await activeMembership();
    const granted = (await scan()).body as AccessDecision;
    const [attendance] = await db.select().from(attendanceRecords);
    expect((await api().post(`/attendance/${attendance!.id}/check-out`)).status).toBe(200);
    await api().post(`/memberships/${membership.id}/cancel`, { reason: 'Left the gym' });

    expectDenied((await scan()).body, 'MEMBERSHIP_CANCELLED');
    expect(granted.decision).toBe('GRANTED');
    expect(await countAttendance()).toBe(1);
  });

  it('logs every attempt, granted and denied, with time, member, result, reason, device and source', async () => {
    await activeMembership();
    const before = Date.now();
    await scan();
    await scan({ matchResult: 'NO_MATCH', templateRef: undefined });
    await scan({ templateRef: 'SIM-9999' });
    await scan({ matchResult: 'DEVICE_ERROR', templateRef: undefined });

    const attempts = await allAttempts();
    expect(attempts.map((a) => [a.result, a.reason, a.memberId])).toEqual([
      ['GRANTED', 'GRANTED', member.id],
      ['DENIED', 'MEMBER_NOT_RECOGNIZED', null],
      ['DENIED', 'MEMBER_NOT_RECOGNIZED', null],
      ['DENIED', 'SCANNER_UNAVAILABLE', null],
    ]);
    for (const attempt of attempts) {
      expect(attempt.deviceId).toBe(scanner.device.id);
      expect(attempt.source).toBe('SIMULATED');
      expect(attempt.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
      expect(attempt.receivedAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    }

    const log = await api().get('/access/attempts?pageSize=10');
    expect(log.status).toBe(200);
    expect(log.body.total).toBe(4);
  });
});

describe('Scenario 4: eligible member check-in', () => {
  it('grants on the first and on the last day of the period (inclusive, gym time zone)', async () => {
    const first = await createMembership(member, plan, {
      startDate: today,
      endDate: addDays(today, 29),
    });
    expect((await scan()).body.decision).toBe('GRANTED');

    await db
      .update(memberships)
      .set({ startDate: addDays(today, -29), endDate: today })
      .where(eq(memberships.id, first.id));
    const last = (await scan()).body as AccessDecision;
    expect(last.decision).toBe('GRANTED');
    expect(last.membership?.endDate).toBe(today);
  });

  it('manual check-in → GRANTED (source MANUAL) with an audit row naming the staff member', async () => {
    await activeMembership();
    const response = await api().post('/attendance/manual-check-in', {
      memberId: member.id,
      reason: 'Scanner wet after cleaning',
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      decision: 'GRANTED',
      source: 'MANUAL',
      deviceId: null,
    });
    const [attempt] = await allAttempts();
    expect(attempt).toMatchObject({
      source: 'MANUAL',
      verifiedByUserId: admin.id,
      deviceId: null,
    });
    const [attendance] = await db.select().from(attendanceRecords);
    expect(attendance).toMatchObject({ source: 'MANUAL', createdBy: admin.id });

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'ACCESS_MANUAL_CHECK_IN'));
    expect(audit).toMatchObject({
      actorUserId: admin.id,
      entityId: attempt!.id,
      reason: 'Scanner wet after cleaning',
    });
    expect(audit!.after).toMatchObject({ memberId: member.id, result: 'GRANTED' });
  });

  it('manual check-in runs the same rules: a cancelled member is denied and audited', async () => {
    await activeMembership({ status: 'CANCELLED' });
    const response = await api().post('/attendance/manual-check-in', {
      memberId: member.id,
      reason: 'Forgot to enroll',
    });
    expect(response.status).toBe(200);
    expectDenied(response.body, 'MEMBERSHIP_CANCELLED');
    expect(await countAttendance()).toBe(0);
    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'ACCESS_MANUAL_CHECK_IN'));
    expect(audits).toHaveLength(1);
  });

  it('manual check-in of an unknown member → 404, nothing logged', async () => {
    const response = await api().post('/attendance/manual-check-in', {
      memberId: randomUUID(),
      reason: 'Typo test',
    });
    expect(response.status).toBe(404);
    expect(await allAttempts()).toHaveLength(0);
  });

  it('manual check-in requires a reason', async () => {
    const response = await api().post('/attendance/manual-check-in', { memberId: member.id });
    expect(response.status).toBe(400);
  });
});

describe('Scenario 5: cancel and the next scan', () => {
  it('a concurrent cancel never leaves a GRANTED attempt recorded after the cancel commits', async () => {
    const membership = await activeMembership();

    // Hold an uncommitted cancel; the scan must wait on the membership row lock.
    let commitCancel!: () => void;
    const gate = new Promise<void>((resolve) => (commitCancel = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const cancelTx = db.transaction(async (tx) => {
      await tx
        .update(memberships)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Race test' })
        .where(eq(memberships.id, membership.id));
      locked();
      await gate;
    });
    await lockTaken;

    const scanPromise = scan().then((response) => response);
    // Wait until the scan is really blocked on the lock before committing.
    for (let i = 0; i < 50; i += 1) {
      const [row] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
      ).then((result) => result.rows);
      if (row!.n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    commitCancel();
    await cancelTx;

    const response = await scanPromise;
    expectDenied(response.body, 'MEMBERSHIP_CANCELLED');
    const granted = await db
      .select()
      .from(accessAttempts)
      .where(eq(accessAttempts.result, 'GRANTED'));
    expect(granted).toHaveLength(0);
    expect(await countAttendance()).toBe(0);
  });
});

describe('Scenario 6: expired', () => {
  it('denies an ACTIVE membership whose end date was yesterday (expiry job not run yet)', async () => {
    await createMembership(member, plan, {
      status: 'ACTIVE',
      startDate: addDays(today, -30),
      endDate: addDays(today, -1),
    });
    expectDenied((await scan()).body, 'MEMBERSHIP_EXPIRED');
  });
});

describe('Scenario 7: suspend and reactivate', () => {
  it('suspend → DENIED, reactivate → GRANTED', async () => {
    const membership = await activeMembership();
    const suspend = await api().post(`/memberships/${membership.id}/suspend`, {
      reason: 'Medical leave',
    });
    expect(suspend.status).toBe(200);
    expectDenied((await scan()).body, 'MEMBERSHIP_SUSPENDED');

    const reactivate = await api().post(`/memberships/${membership.id}/reactivate`, {
      reason: 'Back from leave',
    });
    expect(reactivate.status).toBe(200);
    expect((await scan()).body.decision).toBe('GRANTED');
  });
});

describe('Scenario 8: unknown fingerprints', () => {
  beforeEach(() => activeMembership());

  it('the unenrolled SIM-9999 → MEMBER_NOT_RECOGNIZED', async () => {
    expectDenied((await scan({ templateRef: 'SIM-9999' })).body, 'MEMBER_NOT_RECOGNIZED');
  });

  it('a MATCH without a ref is rejected as invalid input', async () => {
    expect((await scan({ templateRef: undefined })).status).toBe(400);
  });

  it('a revoked or deleted enrollment → MEMBER_NOT_RECOGNIZED, no member attached', async () => {
    await db
      .update(biometricEnrollments)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokeReason: 'Test' })
      .where(eq(biometricEnrollments.memberId, member.id));
    const revoked = await scan();
    expectDenied(revoked.body, 'MEMBER_NOT_RECOGNIZED');
    expect(revoked.body.member).toBeUndefined();

    await db
      .update(biometricEnrollments)
      .set({ status: 'DELETED', deletedAt: new Date(), templateRef: null })
      .where(eq(biometricEnrollments.memberId, member.id));
    expectDenied((await scan()).body, 'MEMBER_NOT_RECOGNIZED');
    expect((await allAttempts()).every((a) => a.memberId === null)).toBe(true);
  });

  it('a ref enrolled on another device is not recognized here', async () => {
    const other = await createDevice();
    expectDenied((await scan({}, other)).body, 'MEMBER_NOT_RECOGNIZED');
  });
});

describe('Scenario 9: authorization cannot be verified', () => {
  beforeEach(() => activeMembership());

  it('a failure injected into the eligibility query → 503 DENIED, no attendance row', async () => {
    await db.execute(sql`alter table memberships rename column status to status_broken`);
    try {
      const response = await scan();
      expect(response.status).toBe(503);
      expectDenied(response.body, 'AUTHORIZATION_UNAVAILABLE');
      expect(response.body.attemptId).toEqual(expect.any(String));
    } finally {
      await db.execute(sql`alter table memberships rename column status_broken to status`);
    }
    expect(await countAttendance()).toBe(0);
    const attempts = await allAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ result: 'DENIED', reason: 'AUTHORIZATION_UNAVAILABLE' });
  });

  it('a statement timeout → 503 DENIED', async () => {
    const quick = testApp(undefined, { dbTimeoutMs: 300 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = db.transaction(async (tx) => {
      await tx.execute(sql`select id from members where id = ${member.id} for no key update`);
      locked();
      await gate;
    });
    await lockTaken;
    try {
      const response = await scan({}, scanner, quick);
      expect(response.status).toBe(503);
      expectDenied(response.body, 'AUTHORIZATION_UNAVAILABLE');
    } finally {
      release();
      await holder;
    }
    expect(await countAttendance()).toBe(0);
    expect((await allAttempts()).map((a) => a.reason)).toEqual(['AUTHORIZATION_UNAVAILABLE']);
  });

  it('a failure at commit time → 503 DENIED; a grant is never returned before commit', async () => {
    await db.execute(sql`
      create or replace function test_fail_at_commit() returns trigger language plpgsql as $$
      begin raise exception 'forced commit failure'; end $$`);
    await db.execute(sql`
      create constraint trigger test_fail_at_commit after insert on attendance_records
      deferrable initially deferred for each row execute function test_fail_at_commit()`);
    try {
      const response = await scan();
      expect(response.status).toBe(503);
      expectDenied(response.body, 'AUTHORIZATION_UNAVAILABLE');
    } finally {
      await db.execute(sql`drop trigger test_fail_at_commit on attendance_records`);
      await db.execute(sql`drop function test_fail_at_commit()`);
    }
    expect(await countAttendance()).toBe(0);
    const attempts = await allAttempts();
    expect(attempts.map((a) => a.result)).toEqual(['DENIED']);
  });

  describe('unauthorized devices → 401 DEVICE_NOT_AUTHORIZED, logged, never decided', () => {
    it('a disabled device', async () => {
      const disabled = await createDevice({ status: 'DISABLED' });
      const response = await scan({}, disabled);
      expect(response.status).toBe(401);
      expectDenied(response.body, 'DEVICE_NOT_AUTHORIZED');
      const [attempt] = await allAttempts();
      expect(attempt).toMatchObject({ deviceId: disabled.device.id, memberId: null });
      expect(await countAttendance()).toBe(0);
    });

    it('a wrong key, an unknown device and a malformed header', async () => {
      const wrongKey = { ...scanner, authorization: `Device ${scanner.device.id}.${'x'.repeat(43)}` };
      const unknown = { ...scanner, authorization: `Device ${randomUUID()}.${scanner.key}` };
      const malformed = { ...scanner, authorization: 'Bearer nonsense' };
      for (const device of [wrongKey, unknown, malformed]) {
        const response = await scan({}, device);
        expect(response.status).toBe(401);
        expectDenied(response.body, 'DEVICE_NOT_AUTHORIZED');
      }
      const missing = await request(app).post('/api/v1/access/scan').send({});
      expect(missing.status).toBe(401);
      expect(await countAttendance()).toBe(0);
      expect((await allAttempts()).every((a) => a.reason === 'DEVICE_NOT_AUTHORIZED')).toBe(true);
    });
  });
});

describe('Scenario 15: simulated vs real', () => {
  it('a simulated device claiming REAL is still stored as SIMULATED', async () => {
    await activeMembership();
    const response = await scan({ source: 'REAL' });
    expect(response.body.source).toBe('SIMULATED');
    const [attempt] = await allAttempts();
    expect(attempt!.source).toBe('SIMULATED');
    const [attendance] = await db.select().from(attendanceRecords);
    expect(attendance!.source).toBe('SIMULATED');
  });

  it('a REAL device path stores REAL; a SIM- ref is not recognized there', async () => {
    await activeMembership();
    const real = await createDevice({ deviceType: 'REAL', vendor: 'ZKTeco' });
    await db
      .update(biometricEnrollments)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokeReason: 'Moving to real scanner' })
      .where(eq(biometricEnrollments.memberId, member.id));
    await db.insert(biometricEnrollments).values({
      memberId: member.id,
      deviceId: real.device.id,
      provider: 'ZKTECO',
      templateRef: '1042',
      consentId: (await db.execute<{ id: string }>(sql`select id from biometric_consents limit 1`))
        .rows[0]!.id,
      enrolledBy: admin.id,
    });

    const granted = await scan({ templateRef: '1042' }, real);
    expect(granted.body).toMatchObject({ decision: 'GRANTED', source: 'REAL' });
    expectDenied((await scan({ templateRef: 'SIM-0001' }, real)).body, 'MEMBER_NOT_RECOGNIZED');
    const attempts = await allAttempts();
    expect(attempts.map((a) => a.source)).toEqual(['REAL', 'REAL']);
  });

  it('the simulator panel drives the same decision service and refuses REAL devices', async () => {
    await activeMembership();
    const granted = await api().post('/access/simulate', {
      deviceId: scanner.device.id,
      templateRef: 'SIM-0001',
    });
    expect(granted.body).toMatchObject({ decision: 'GRANTED', source: 'SIMULATED' });
    const noMatch = await api().post('/access/simulate', {
      deviceId: scanner.device.id,
      scenario: 'NO_MATCH',
    });
    expectDenied(noMatch.body, 'MEMBER_NOT_RECOGNIZED');
    const unavailable = await api().post('/access/simulate', {
      deviceId: scanner.device.id,
      scenario: 'SCANNER_UNAVAILABLE',
    });
    expectDenied(unavailable.body, 'SCANNER_UNAVAILABLE');

    const real = await createDevice({ deviceType: 'REAL' });
    const refused = await api().post('/access/simulate', {
      deviceId: real.device.id,
      templateRef: 'SIM-0001',
    });
    expect(refused.status).toBe(404);

    const fixtures = await api().get('/access/simulator/fixtures');
    expect(fixtures.status).toBe(200);
    expect(fixtures.body.fixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ templateRef: 'SIM-0001', expected: 'GRANTED' }),
        expect.objectContaining({ templateRef: 'SIM-9999', expected: 'MEMBER_NOT_RECOGNIZED' }),
      ]),
    );
  });

  it('simulator routes → 404 when BIOMETRIC_SIMULATOR_ENABLED is off', async () => {
    const off = testApp(undefined, { simulatorEnabled: false });
    const offSession = await signIn(off, admin);
    const simulate = await offSession.agent
      .post('/api/v1/access/simulate')
      .set('X-CSRF-Token', offSession.csrf)
      .send({ deviceId: scanner.device.id, templateRef: 'SIM-0001' });
    expect(simulate.status).toBe(404);
    expect((await offSession.agent.get('/api/v1/access/simulator/fixtures')).status).toBe(404);
    expect(await allAttempts()).toHaveLength(0);
  });

  it('a disabled simulated device in the panel → DEVICE_NOT_AUTHORIZED', async () => {
    const disabled = await createDevice({ status: 'DISABLED' });
    const response = await api().post('/access/simulate', {
      deviceId: disabled.device.id,
      templateRef: 'SIM-0001',
    });
    expectDenied(response.body, 'DEVICE_NOT_AUTHORIZED');
  });
});

describe('agent outbox (offline denials)', () => {
  it('stores denial facts as DENIED AUTHORIZATION_UNAVAILABLE and ignores re-uploads', async () => {
    const denials = [
      { eventId: randomUUID(), occurredAt: new Date(Date.now() - 60_000).toISOString() },
      { eventId: randomUUID(), occurredAt: new Date().toISOString() },
    ];
    const upload = () =>
      request(app)
        .post('/api/v1/access/offline-denials')
        .set('Authorization', scanner.authorization)
        .send({ denials });
    const first = await upload();
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: 2, stored: 2 });
    expect((await upload()).body).toEqual({ received: 2, stored: 0 });

    const attempts = await allAttempts();
    expect(attempts).toHaveLength(2);
    for (const attempt of attempts) {
      expect(attempt).toMatchObject({
        result: 'DENIED',
        reason: 'AUTHORIZATION_UNAVAILABLE',
        uploadedFromOutbox: true,
        source: 'SIMULATED',
        memberId: null,
      });
    }
  });

  it('a later scan with an uploaded eventId replays the stored denial', async () => {
    await activeMembership();
    const eventId = randomUUID();
    await request(app)
      .post('/api/v1/access/offline-denials')
      .set('Authorization', scanner.authorization)
      .send({ denials: [{ eventId, occurredAt: new Date().toISOString() }] });
    const replay = await scan({ eventId });
    expectDenied(replay.body, 'AUTHORIZATION_UNAVAILABLE');
    expect(await countAttendance()).toBe(0);
  });

  it('requires a device key', async () => {
    const response = await request(app)
      .post('/api/v1/access/offline-denials')
      .send({ denials: [{ eventId: randomUUID(), occurredAt: new Date().toISOString() }] });
    expect(response.status).toBe(401);
  });
});

describe('append-only logs', () => {
  it('UPDATE and DELETE on access_attempts fail at the database level', async () => {
    await activeMembership();
    await scan();
    await expect(
      db.update(accessAttempts).set({ reason: 'GRANTED' }).where(sql`true`),
    ).rejects.toThrow();
    await expect(db.delete(accessAttempts).where(sql`true`)).rejects.toThrow();
    expect(await allAttempts()).toHaveLength(1);
  });

  it('UPDATE and DELETE on attendance_corrections fail at the database level', async () => {
    await activeMembership();
    await scan();
    const [attendance] = await db.select().from(attendanceRecords);
    const corrected = await api().post(`/attendance/${attendance!.id}/corrections`, {
      status: 'VOIDED',
      reason: 'Test scan by staff',
    });
    expect(corrected.status).toBe(200);
    await expect(
      db.execute(sql`update attendance_corrections set reason = 'changed'`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from attendance_corrections`)).rejects.toThrow();
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from attendance_corrections`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('there is no DELETE route for attendance', async () => {
    await activeMembership();
    await scan();
    const [attendance] = await db.select().from(attendanceRecords);
    const response = await session.agent
      .delete(`/api/v1/attendance/${attendance!.id}`)
      .set('X-CSRF-Token', session.csrf);
    expect(response.status).toBe(404);
    expect(await countAttendance()).toBe(1);
  });
});

describe('device clock', () => {
  it('replaces an implausible device time with the server receive time', async () => {
    await activeMembership();
    const response = await scan({ occurredAt: '2020-01-01T00:00:00Z' });
    expect(new Date(response.body.occurredAt).getFullYear()).toBeGreaterThanOrEqual(2026);
    const [attempt] = await db
      .select()
      .from(accessAttempts)
      .where(and(eq(accessAttempts.memberId, member.id)));
    expect(attempt!.occurredAt.getFullYear()).toBeGreaterThanOrEqual(2026);
  });
});
