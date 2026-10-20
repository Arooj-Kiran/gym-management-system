import { afterEach, describe, expect, it } from 'vitest';
import type { ScanEvent } from '../src/adapters/scanner-adapter';
import { BackendClient, BackendError } from '../src/backend-client';
import { closedPortUrl, decision, DEVICE_ID, DEVICE_KEY, json, mockBackend } from './helpers';

const event: ScanEvent = {
  eventId: '0b8e9f6a-1c2d-4e3f-8a9b-0c1d2e3f4a5b',
  occurredAt: '2026-10-19T09:00:00.000Z',
  matchResult: 'MATCH',
  templateRef: 'SIM-0001',
};

const UNVERIFIED_MESSAGE = 'Membership could not be verified. Please see reception.';

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function clientFor(
  respond: Parameters<typeof mockBackend>[0],
  timeoutMs = 3000,
): Promise<{
  client: BackendClient;
  requests: Awaited<ReturnType<typeof mockBackend>>['requests'];
}> {
  const backend = await mockBackend(respond);
  close = backend.close;
  const client = new BackendClient({
    backendUrl: backend.url,
    deviceId: DEVICE_ID,
    deviceKey: DEVICE_KEY,
    requestTimeoutMs: timeoutMs,
  });
  return { client, requests: backend.requests };
}

describe('BackendClient.scan — fail closed (PLAN §6.2)', () => {
  it('grants only on HTTP 200 with a valid GRANTED decision and an attempt ID', async () => {
    const { client, requests } = await clientFor((_req, res) => json(res, 200, decision()));
    const outcome = await client.scan(event);
    expect(outcome).toMatchObject({ granted: true, failure: null, recordOffline: false });
    expect(outcome.title).toBe('Access Granted');
    expect(requests[0]).toMatchObject({ method: 'POST', url: '/access/scan', body: event });
    expect(requests[0]!.headers.authorization).toBe(`Device ${DEVICE_ID}.${DEVICE_KEY}`);
  });

  it('shows a server denial as it is, without an offline record', async () => {
    const { client } = await clientFor((_req, res) =>
      json(
        res,
        200,
        decision({
          decision: 'DENIED',
          reason: 'MEMBERSHIP_CANCELLED',
          title: 'Access Denied',
          message: 'Membership cancelled. Please see reception.',
          member: undefined,
          membership: undefined,
        }),
      ),
    );
    const outcome = await client.scan(event);
    expect(outcome).toMatchObject({
      granted: false,
      failure: null,
      recordOffline: false,
      message: 'Membership cancelled. Please see reception.',
    });
    expect(outcome.decision?.reason).toBe('MEMBERSHIP_CANCELLED');
  });

  it('denies a 200 that is missing the decision field', async () => {
    const body: Record<string, unknown> = decision();
    delete body.decision;
    const { client } = await clientFor((_req, res) => json(res, 200, body));
    const outcome = await client.scan(event);
    expect(outcome).toMatchObject({
      granted: false,
      failure: 'MALFORMED_RESPONSE',
      recordOffline: true,
    });
    expect(outcome.message).toBe(UNVERIFIED_MESSAGE);
  });

  it('denies a GRANTED decision that names no committed attempt', async () => {
    const { client } = await clientFor((_req, res) =>
      json(res, 200, decision({ attemptId: null })),
    );
    const outcome = await client.scan(event);
    expect(outcome).toMatchObject({ granted: false, decision: null, recordOffline: true });
    expect(outcome.message).toBe(UNVERIFIED_MESSAGE);
  });

  it('denies a GRANTED body sent with a non-200 status', async () => {
    const { client } = await clientFor((_req, res) => json(res, 201, decision()));
    expect((await client.scan(event)).granted).toBe(false);
  });

  it('denies malformed JSON', async () => {
    const { client } = await clientFor((_req, res) => json(res, 200, '{"decision":"GRANTED",'));
    expect(await client.scan(event)).toMatchObject({
      granted: false,
      failure: 'MALFORMED_RESPONSE',
      recordOffline: true,
    });
  });

  it('denies a 500 and keeps the denial offline', async () => {
    const { client } = await clientFor((_req, res) =>
      json(res, 500, { error: { code: 'INTERNAL' } }),
    );
    expect(await client.scan(event)).toMatchObject({
      granted: false,
      failure: 'SERVER_ERROR',
      recordOffline: true,
      message: UNVERIFIED_MESSAGE,
    });
  });

  it('shows a 503 AUTHORIZATION_UNAVAILABLE denial and keeps it offline', async () => {
    const { client } = await clientFor((_req, res) =>
      json(
        res,
        503,
        decision({
          decision: 'DENIED',
          reason: 'AUTHORIZATION_UNAVAILABLE',
          title: 'Access Denied',
          message: UNVERIFIED_MESSAGE,
          attemptId: null,
          member: undefined,
          membership: undefined,
        }),
      ),
    );
    expect(await client.scan(event)).toMatchObject({
      granted: false,
      failure: 'SERVER_ERROR',
      recordOffline: true,
      message: UNVERIFIED_MESSAGE,
    });
  });

  it('shows a 401 device-not-authorized denial without an offline record', async () => {
    const { client } = await clientFor((_req, res) =>
      json(
        res,
        401,
        decision({
          decision: 'DENIED',
          reason: 'DEVICE_NOT_AUTHORIZED',
          title: 'Access Denied',
          message: 'Device not authorized.',
          deviceId: null,
          member: undefined,
          membership: undefined,
        }),
      ),
    );
    expect(await client.scan(event)).toMatchObject({
      granted: false,
      failure: null,
      recordOffline: false,
      message: 'Device not authorized.',
    });
  });

  it('denies when the backend does not answer in time', async () => {
    const { client } = await clientFor(() => undefined, 300);
    const started = Date.now();
    const outcome = await client.scan(event);
    expect(outcome).toMatchObject({ granted: false, failure: 'TIMEOUT', recordOffline: true });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('denies when the backend sends headers but stalls the body', async () => {
    const { client } = await clientFor((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"decision":"GRANTED"');
    }, 300);
    expect(await client.scan(event)).toMatchObject({ granted: false, failure: 'TIMEOUT' });
  });

  it('denies when the connection is refused', async () => {
    const client = new BackendClient({
      backendUrl: await closedPortUrl(),
      deviceId: DEVICE_ID,
      deviceKey: DEVICE_KEY,
      requestTimeoutMs: 1000,
    });
    expect(await client.scan(event)).toMatchObject({
      granted: false,
      failure: 'NETWORK',
      recordOffline: true,
      message: UNVERIFIED_MESSAGE,
    });
  });
});

describe('BackendClient — heartbeat, offline denials, deletions', () => {
  it('parses pending deletions from the heartbeat', async () => {
    const pending = [
      { enrollmentId: '5f4e3d2c-1b0a-4987-8654-3210fedcba98', templateRef: 'SIM-0003' },
    ];
    const { client, requests } = await clientFor((_req, res) =>
      json(res, 200, { serverTime: new Date().toISOString(), pendingDeletions: pending }),
    );
    const result = await client.heartbeat('ERROR', 'SENSOR_DIRTY');
    expect(result.pendingDeletions).toEqual(pending);
    expect(requests[0]).toMatchObject({
      url: '/devices/heartbeat',
      body: { health: 'ERROR', errorCode: 'SENSOR_DIRTY' },
    });
  });

  it('throws a BackendError on a refused heartbeat, without the key in the message', async () => {
    const { client } = await clientFor((_req, res) => json(res, 401, { error: { code: 'X' } }));
    const error = await client.heartbeat('OK').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BackendError);
    expect((error as BackendError).status).toBe(401);
    expect((error as Error).message).not.toContain(DEVICE_KEY);
  });

  it('throws on an unexpected heartbeat body', async () => {
    const { client } = await clientFor((_req, res) => json(res, 200, { pendingDeletions: 'no' }));
    await expect(client.heartbeat('OK')).rejects.toBeInstanceOf(BackendError);
  });

  it('posts confirm-deletion for the enrollment', async () => {
    const { client, requests } = await clientFor((_req, res) =>
      json(res, 200, { status: 'DELETED' }),
    );
    await client.confirmDeletion('5f4e3d2c-1b0a-4987-8654-3210fedcba98');
    expect(requests[0]!.url).toBe(
      '/biometric/enrollments/5f4e3d2c-1b0a-4987-8654-3210fedcba98/confirm-deletion',
    );
  });
});
