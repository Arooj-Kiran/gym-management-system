import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addDays } from '@gms/shared';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedAdapter } from '../../../biometric-agent/src/adapters/simulated-adapter';
import { Agent, SimulatedRelay, type AgentDisplay } from '../../../biometric-agent/src/agent';
import { BackendClient, type ScanOutcome } from '../../../biometric-agent/src/backend-client';
import { Outbox } from '../../../biometric-agent/src/outbox';
import { closeDb, db } from '../../src/db/client';
import { accessAttempts, attendanceRecords, biometricEnrollments } from '../../src/db/schema';
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
} from '../setup/factories';

/**
 * Contract test: the real agent code (apps/biometric-agent) against the real backend over HTTP.
 * Proves the agent and the server agree on routes, device auth, the decision schema, the
 * outbox upload and the deletion handshake. The scanner is SIMULATED.
 */

const app = testApp();
let server: Server;
let backendUrl: string;

beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});

let session: Session;
let scanner: Awaited<ReturnType<typeof createDevice>>;
let membershipId: string;
let memberId: string;
let enrollmentId: string;
let dir: string;
let agent: Agent;
let adapter: SimulatedAdapter;
let relay: SimulatedRelay;
let outbox: Outbox;
let results: ScanOutcome[];

beforeEach(async () => {
  await resetTables();
  const admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
  const plan = await createPlan({ name: 'Monthly Standard' });
  const member = await createMember({ firstName: 'Hamza', lastName: 'Qureshi' });
  memberId = member.id;
  const today = gymToday();
  membershipId = (
    await createMembership(member, plan, { startDate: addDays(today, -5), endDate: addDays(today, 25) })
  ).id;
  scanner = await createDevice();
  enrollmentId = (await enrollMember(member, scanner.device, 'SIM-0001', admin)).id;

  dir = await mkdtemp(path.join(tmpdir(), 'gms-agent-contract-'));
  adapter = new SimulatedAdapter();
  relay = new SimulatedRelay();
  outbox = new Outbox(path.join(dir, 'outbox.jsonl'));
  results = [];
  const display: AgentDisplay = {
    showResult: (outcome) => results.push(outcome),
    info: () => undefined,
    warn: () => undefined,
  };
  const client = new BackendClient({
    backendUrl,
    deviceId: scanner.device.id,
    deviceKey: scanner.key,
    requestTimeoutMs: 3000,
  });
  agent = new Agent({ adapter, client, outbox, relay, display, heartbeatSeconds: 3600 });
  await agent.start();
});
afterEach(async () => {
  await agent.stop();
  await rm(dir, { recursive: true, force: true });
});

const scanAndWait = async (ref: string) => {
  adapter.scan(ref);
  await agent.drain();
  return results.at(-1)!;
};

describe('agent ↔ backend contract (SIMULATED scanner)', () => {
  it('a GRANTED scan opens the simulated relay and records attendance', async () => {
    const outcome = await scanAndWait('SIM-0001');
    expect(outcome).toMatchObject({ granted: true, failure: null, title: 'Access Granted' });
    expect(outcome.decision?.source).toBe('SIMULATED');
    expect(relay.openings).toBe(1);
    const attendance = await db.select().from(attendanceRecords).where(eq(attendanceRecords.memberId, memberId));
    expect(attendance).toHaveLength(1);
  });

  it('cancel → the very next scan is denied and the relay stays shut', async () => {
    await scanAndWait('SIM-0001');
    const cancel = await session.agent
      .post(`/api/v1/memberships/${membershipId}/cancel`)
      .set('X-CSRF-Token', session.csrf)
      .send({ reason: 'Member asked to cancel' });
    expect(cancel.status).toBe(200);

    const outcome = await scanAndWait('SIM-0001');
    expect(outcome).toMatchObject({ granted: false, recordOffline: false });
    expect(outcome.decision?.reason).toBe('MEMBERSHIP_CANCELLED');
    expect(relay.openings).toBe(1);
  });

  it('an unknown finger is denied as not recognized', async () => {
    adapter.noMatch();
    await agent.drain();
    expect(results.at(-1)!.decision?.reason).toBe('MEMBER_NOT_RECOGNIZED');
    expect(relay.openings).toBe(0);
  });

  it('a scanner error is denied as scanner unavailable', async () => {
    adapter.fail('SENSOR_DIRTY');
    await agent.drain();
    expect(results.at(-1)!.decision?.reason).toBe('SCANNER_UNAVAILABLE');
  });

  it('the outbox upload is accepted and stored as DENIED AUTHORIZATION_UNAVAILABLE', async () => {
    const fact = { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() };
    await outbox.append(fact);
    expect(await agent.heartbeat()).toMatchObject({ ok: true, uploaded: 1 });
    const [attempt] = await db.select().from(accessAttempts).where(eq(accessAttempts.eventId, fact.eventId));
    expect(attempt).toMatchObject({ result: 'DENIED', reason: 'AUTHORIZATION_UNAVAILABLE' });
    expect(await outbox.read()).toEqual([]);
  });

  it('revoke → heartbeat deletes the template on the scanner → the backend erases the ID', async () => {
    await adapter.enroll('Hamza');
    const revoke = await session.agent
      .post(`/api/v1/biometric/enrollments/${enrollmentId}/revoke`)
      .set('X-CSRF-Token', session.csrf)
      .send({ reason: 'Member withdrew' });
    expect(revoke.status).toBe(200);

    expect(await agent.heartbeat()).toMatchObject({ ok: true, deleted: 1 });
    expect(adapter.hasTemplate('SIM-0001')).toBe(false);
    const [enrollment] = await db
      .select()
      .from(biometricEnrollments)
      .where(eq(biometricEnrollments.id, enrollmentId));
    expect(enrollment).toMatchObject({ status: 'DELETED', templateRef: null });

    // The erased ID no longer opens anything.
    const outcome = await scanAndWait('SIM-0001');
    expect(outcome.granted).toBe(false);
    expect(outcome.decision?.reason).toBe('MEMBER_NOT_RECOGNIZED');
  });

  it('a disabled device is refused and the agent stays closed', async () => {
    const disable = await session.agent
      .post(`/api/v1/devices/${scanner.device.id}/disable`)
      .set('X-CSRF-Token', session.csrf)
      .send({ reason: 'Moved to storage' });
    expect(disable.status).toBe(200);
    const outcome = await scanAndWait('SIM-0001');
    expect(outcome.granted).toBe(false);
    expect(outcome.decision?.reason).toBe('DEVICE_NOT_AUTHORIZED');
    expect(relay.openings).toBe(0);
  });
});
