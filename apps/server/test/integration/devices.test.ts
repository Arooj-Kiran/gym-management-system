import { randomUUID } from 'node:crypto';
import { addDays } from '@gms/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { accessDevices, auditLogs, biometricEnrollments } from '../../src/db/schema';
import { gymToday } from '../../src/lib/dates';
import { sha256Hex } from '../../src/lib/tokens';
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

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
});
afterAll(closeDb);

const as = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
  patch: (path: string, body: object) =>
    s.agent.patch(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
});
const api = () => as(session);

const heartbeat = (authorization: string, body: object = { health: 'OK' }) =>
  request(app).post('/api/v1/devices/heartbeat').set('Authorization', authorization).send(body);

describe('device registry', () => {
  it('creates a device, shows the key once and stores only its hash', async () => {
    const response = await api().post('/devices', {
      name: 'Front entrance',
      location: 'Reception',
      deviceType: 'SIMULATED',
    });
    expect(response.status).toBe(201);
    const { device, deviceKey } = response.body;
    expect(device).toMatchObject({
      name: 'Front entrance',
      deviceType: 'SIMULATED',
      status: 'ACTIVE',
      lastSeenAt: null,
    });
    expect(deviceKey).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(JSON.stringify(device)).not.toContain(deviceKey);

    const [row] = await db.select().from(accessDevices).where(eq(accessDevices.id, device.id));
    expect(row!.apiKeyHash).toBe(sha256Hex(deviceKey));
    expect((await api().get(`/devices/${device.id}`)).body).not.toHaveProperty('deviceKey');
    expect(JSON.stringify((await api().get('/devices')).body)).not.toContain(row!.apiKeyHash);

    const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, 'DEVICE_CREATED'));
    expect(JSON.stringify(audit)).not.toContain(deviceKey);
    expect(JSON.stringify(audit)).not.toContain(row!.apiKeyHash);

    // The new key works on the device-key routes.
    expect((await heartbeat(`Device ${device.id}.${deviceKey}`)).status).toBe(200);
  });

  it('keeps vendor details for real scanners only', async () => {
    const simulated = await api().post('/devices', {
      name: 'Sim',
      location: 'Desk',
      deviceType: 'SIMULATED',
      vendor: 'ZKTeco',
    });
    expect(simulated.status).toBe(400);
    const real = await api().post('/devices', {
      name: 'Gate',
      location: 'Main door',
      deviceType: 'REAL',
      vendor: 'ZKTeco',
      model: 'K40',
    });
    expect(real.status).toBe(201);
    expect(real.body.device).toMatchObject({ deviceType: 'REAL', vendor: 'ZKTeco', model: 'K40' });

    const renamed = await api().patch(`/devices/${real.body.device.id}`, { location: 'Side door' });
    expect(renamed.body.location).toBe('Side door');
    // The type is fixed at creation.
    expect(
      (await api().patch(`/devices/${real.body.device.id}`, { deviceType: 'SIMULATED' })).status,
    ).toBe(400);
  });

  it('rotating the key invalidates the old one', async () => {
    const scanner = await createDevice();
    const rotated = await api().post(`/devices/${scanner.device.id}/rotate-key`, {
      reason: 'Agent PC replaced',
    });
    expect(rotated.status).toBe(200);
    expect(rotated.body.deviceKey).not.toBe(scanner.key);
    expect((await heartbeat(scanner.authorization)).status).toBe(401);
    expect((await heartbeat(`Device ${scanner.device.id}.${rotated.body.deviceKey}`)).status).toBe(
      200,
    );
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'DEVICE_KEY_ROTATED'));
    expect(audit).toMatchObject({ entityId: scanner.device.id, reason: 'Agent PC replaced' });
  });

  it('a disabled device cannot scan or heartbeat until it is enabled again', async () => {
    const plan = await createPlan();
    const member = await createMember();
    const today = gymToday();
    await createMembership(member, plan, {
      startDate: addDays(today, -1),
      endDate: addDays(today, 29),
    });
    const scanner = await createDevice();
    await enrollMember(member, scanner.device, 'SIM-0001', admin);
    const scan = () =>
      request(app).post('/api/v1/access/scan').set('Authorization', scanner.authorization).send({
        eventId: randomUUID(),
        matchResult: 'MATCH',
        templateRef: 'SIM-0001',
        occurredAt: new Date().toISOString(),
      });

    expect(
      (await api().post(`/devices/${scanner.device.id}/disable`, { reason: 'Lost' })).status,
    ).toBe(200);
    const denied = await scan();
    expect(denied.status).toBe(401);
    expect(denied.body.reason).toBe('DEVICE_NOT_AUTHORIZED');
    expect((await heartbeat(scanner.authorization)).status).toBe(401);

    expect((await api().post(`/devices/${scanner.device.id}/enable`)).status).toBe(200);
    expect((await scan()).body.decision).toBe('GRANTED');
    const actions = await db.select({ action: auditLogs.action }).from(auditLogs);
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['DEVICE_DISABLED', 'DEVICE_ENABLED']),
    );
  });

  it('only the Admin manages devices', async () => {
    for (const role of ['MANAGER', 'RECEPTIONIST', 'TRAINER'] as const) {
      const other = as(await signIn(app, await createUser({ role })));
      expect((await other.get('/devices')).status).toBe(403);
      expect(
        (await other.post('/devices', { name: 'X', location: 'Y', deviceType: 'SIMULATED' }))
          .status,
      ).toBe(403);
    }
  });
});

describe('heartbeat', () => {
  it('records health and last seen, and lists revoked enrollments to delete', async () => {
    const scanner = await createDevice();
    const member = await createMember();
    const enrollment = await enrollMember(member, scanner.device, 'SIM-0007', admin);
    const first = await heartbeat(scanner.authorization);
    expect(first.status).toBe(200);
    expect(first.body.pendingDeletions).toEqual([]);
    expect(new Date(first.body.serverTime).getTime()).toBeGreaterThan(Date.now() - 60_000);

    await api().post(`/biometric/enrollments/${enrollment.id}/revoke`, { reason: 'Member left' });
    const second = await heartbeat(scanner.authorization, {
      health: 'ERROR',
      errorCode: 'SENSOR_DIRTY',
    });
    expect(second.body.pendingDeletions).toEqual([
      { enrollmentId: enrollment.id, templateRef: 'SIM-0007' },
    ]);
    const device = (await api().get(`/devices/${scanner.device.id}`)).body;
    expect(device).toMatchObject({ lastHealth: 'ERROR', lastErrorCode: 'SENSOR_DIRTY' });
    expect(device.lastSeenAt).not.toBeNull();

    // The agent confirms; the ref is gone and nothing is pending.
    const confirm = await request(app)
      .post(`/api/v1/biometric/enrollments/${enrollment.id}/confirm-deletion`)
      .set('Authorization', scanner.authorization);
    expect(confirm.body).toEqual({ enrollmentId: enrollment.id, status: 'DELETED' });
    expect((await heartbeat(scanner.authorization)).body.pendingDeletions).toEqual([]);
    const [row] = await db
      .select()
      .from(biometricEnrollments)
      .where(eq(biometricEnrollments.id, enrollment.id));
    expect(row).toMatchObject({ status: 'DELETED', templateRef: null });
  });

  it('rejects unknown fields and a missing key', async () => {
    const scanner = await createDevice();
    expect((await heartbeat(scanner.authorization, { health: 'OK', extra: 1 })).status).toBe(400);
    expect(
      (await request(app).post('/api/v1/devices/heartbeat').send({ health: 'OK' })).status,
    ).toBe(401);
  });
});
