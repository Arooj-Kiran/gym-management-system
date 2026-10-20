import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentDisplay } from '../src/agent';
import type { ScanOutcome } from '../src/backend-client';

export const DEVICE_ID = '7d0f4c3e-2a8b-4e51-9c6d-1f2a3b4c5d6e';
export const DEVICE_KEY = 'k'.repeat(43);

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

type Handler = (request: RecordedRequest, res: ServerResponse) => void;

/** A stand-in backend on a random local port. Each test decides how it answers. */
export async function mockBackend(handler: Handler) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      let body: unknown = raw;
      try {
        body = JSON.parse(raw);
      } catch {
        // keep the raw text
      }
      const recorded = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(recorded);
      handler(recorded, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function decision(overrides: Record<string, unknown> = {}) {
  return {
    decision: 'GRANTED',
    reason: 'GRANTED',
    title: 'Access Granted',
    message: 'Welcome, Ayesha. Valid until 31 Dec 2026.',
    member: { firstName: 'Ayesha', memberCode: 'GMS-0001', photoUrl: null },
    membership: { planName: 'Monthly', endDate: '2026-12-31' },
    attemptId: '3c9a7e10-5b2d-4f8e-a1c4-6d7e8f9a0b1c',
    duplicate: false,
    deviceId: DEVICE_ID,
    source: 'SIMULATED',
    occurredAt: '2026-10-19T09:00:00.000Z',
    ...overrides,
  };
}

/** Port with nothing listening: a refused connection. */
export async function closedPortUrl() {
  const backend = await mockBackend(() => undefined);
  await backend.close();
  return backend.url;
}

export async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'gms-agent-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function recordingDisplay() {
  const results: ScanOutcome[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  const display: AgentDisplay = {
    showResult: (outcome) => results.push(outcome),
    info: (message) => infos.push(message),
    warn: (message) => warnings.push(message),
  };
  return { display, results, warnings, infos };
}
