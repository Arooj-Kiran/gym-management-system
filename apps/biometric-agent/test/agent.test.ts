import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedAdapter } from '../src/adapters/simulated-adapter';
import { Agent, SimulatedRelay, type Relay } from '../src/agent';
import { BackendClient } from '../src/backend-client';
import { Outbox } from '../src/outbox';
import {
  closedPortUrl,
  decision,
  DEVICE_ID,
  DEVICE_KEY,
  json,
  mockBackend,
  recordingDisplay,
  tempDir,
  type RecordedRequest,
} from './helpers';

let dir: string;
let cleanup: () => Promise<void>;
const closers: (() => Promise<void>)[] = [];
beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await cleanup();
});

const ENROLLMENT_ID = '5f4e3d2c-1b0a-4987-8654-3210fedcba98';

interface Routes {
  scan?: (req: RecordedRequest) => [number, unknown];
  pendingDeletions?: { enrollmentId: string; templateRef: string }[];
}

async function setup(routes: Routes = {}, options: { backendUrl?: string; relay?: Relay } = {}) {
  let backendUrl = options.backendUrl;
  let requests: RecordedRequest[] = [];
  if (!backendUrl) {
    const backend = await mockBackend((req, res) => {
      if (req.url === '/access/scan') {
        const [status, body] = routes.scan?.(req) ?? [200, decision()];
        return json(res, status, body);
      }
      if (req.url === '/devices/heartbeat') {
        return json(res, 200, {
          serverTime: new Date().toISOString(),
          pendingDeletions: routes.pendingDeletions ?? [],
        });
      }
      if (req.url === '/access/offline-denials') {
        const { denials } = req.body as { denials: unknown[] };
        return json(res, 200, { received: denials.length, stored: denials.length });
      }
      if (req.url.endsWith('/confirm-deletion')) return json(res, 200, { status: 'DELETED' });
      return json(res, 404, { error: { code: 'NOT_FOUND' } });
    });
    closers.push(backend.close);
    backendUrl = backend.url;
    requests = backend.requests;
  }
  const adapter = new SimulatedAdapter();
  const outbox = new Outbox(path.join(dir, 'outbox.jsonl'));
  const relay = options.relay ?? new SimulatedRelay();
  const view = recordingDisplay();
  const client = new BackendClient({
    backendUrl,
    deviceId: DEVICE_ID,
    deviceKey: DEVICE_KEY,
    requestTimeoutMs: 1000,
  });
  const agent = new Agent({ adapter, client, outbox, relay, display: view.display, heartbeatSeconds: 3600 });
  closers.push(() => agent.stop());
  return { agent, adapter, outbox, relay, requests, ...view };
}

describe('Agent', () => {
  it('opens the relay only after a verified GRANTED', async () => {
    const relay = new SimulatedRelay();
    const { agent, adapter, results } = await setup({}, { relay });
    await agent.start();
    adapter.scan('SIM-0001');
    await agent.drain();
    expect(relay.openings).toBe(1);
    expect(results[0]).toMatchObject({ granted: true });
  });

  it('keeps the door shut on a server denial', async () => {
    const relay = new SimulatedRelay();
    const { agent, adapter, outbox, results } = await setup(
      {
        scan: () => [
          200,
          decision({
            decision: 'DENIED',
            reason: 'MEMBERSHIP_CANCELLED',
            title: 'Access Denied',
            message: 'Membership cancelled. Please see reception.',
          }),
        ],
      },
      { relay },
    );
    await agent.start();
    adapter.scan('SIM-0001');
    await agent.drain();
    expect(relay.openings).toBe(0);
    expect(results[0]!.message).toBe('Membership cancelled. Please see reception.');
    expect(await outbox.read()).toEqual([]);
  });

  it('denies and writes the outbox when the backend is unreachable', async () => {
    const relay = new SimulatedRelay();
    const { agent, adapter, outbox, results, warnings } = await setup(
      {},
      { backendUrl: await closedPortUrl(), relay },
    );
    await agent.start();
    expect(warnings[0]).toMatch(/Heartbeat failed/);
    const event = adapter.scan('SIM-0001');
    await agent.drain();
    expect(relay.openings).toBe(0);
    expect(results[0]).toMatchObject({ granted: false, failure: 'NETWORK' });
    expect(await outbox.read()).toEqual([{ eventId: event.eventId, occurredAt: event.occurredAt }]);
  });

  it('denies a malformed GRANTED and keeps the denial offline', async () => {
    const relay = new SimulatedRelay();
    const { agent, adapter, outbox } = await setup(
      { scan: () => [200, decision({ attemptId: undefined })] },
      { relay },
    );
    await agent.start();
    adapter.scan('SIM-0001');
    await agent.drain();
    expect(relay.openings).toBe(0);
    expect(await outbox.read()).toHaveLength(1);
  });

  it('warns staff when the relay fails after a grant', async () => {
    const relay: Relay = {
      open: () => Promise.reject(new Error('relay jammed')),
    };
    const { agent, adapter, results, warnings } = await setup({}, { relay });
    await agent.start();
    adapter.scan('SIM-0001');
    await agent.drain();
    expect(results[0]!.granted).toBe(true);
    expect(warnings).toContain('The relay did not open. Please let the member in by hand.');
  });

  it('uploads the outbox on the next heartbeat', async () => {
    const { agent, outbox, requests } = await setup();
    await outbox.append({ eventId: '0b8e9f6a-1c2d-4e3f-8a9b-0c1d2e3f4a5b', occurredAt: '2026-10-19T09:00:00.000Z' });
    const result = await agent.heartbeat();
    expect(result).toMatchObject({ ok: true, uploaded: 1 });
    expect(requests.map((request) => request.url)).toContain('/access/offline-denials');
    expect(await outbox.read()).toEqual([]);
  });

  it('deletes revoked templates from the scanner and confirms each deletion', async () => {
    const { agent, adapter, requests } = await setup({
      pendingDeletions: [{ enrollmentId: ENROLLMENT_ID, templateRef: 'SIM-0001' }],
    });
    await adapter.enroll('member');
    expect(adapter.hasTemplate('SIM-0001')).toBe(true);
    const result = await agent.heartbeat();
    expect(result).toMatchObject({ ok: true, deleted: 1 });
    expect(adapter.hasTemplate('SIM-0001')).toBe(false);
    expect(requests.map((request) => request.url)).toContain(
      `/biometric/enrollments/${ENROLLMENT_ID}/confirm-deletion`,
    );
  });

  it('reports scanner health in the heartbeat', async () => {
    const { agent, adapter, requests } = await setup();
    adapter.setHealth({ health: 'ERROR', errorCode: 'SENSOR_DIRTY' });
    await agent.heartbeat();
    expect(requests.at(-1)!.body).toEqual({ health: 'ERROR', errorCode: 'SENSOR_DIRTY' });
  });
});
