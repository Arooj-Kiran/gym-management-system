import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config/env';
import { closeDb } from '../../src/db/client';
import * as settingsService from '../../src/modules/settings/settings.service';
import { signIn, testApp } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser } from '../setup/factories';

const app = testApp();

beforeEach(resetTables);
afterAll(closeDb);

describe('CSRF protection', () => {
  it('rejects an unsafe request without the CSRF token', async () => {
    const { agent } = await signIn(app, await createUser());
    const res = await agent.patch('/api/v1/settings').send({ gymName: 'Iron Works Gym' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a wrong CSRF token', async () => {
    const { agent } = await signIn(app, await createUser());
    const res = await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', 'not-the-token');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it("rejects another session's CSRF token", async () => {
    const first = await signIn(app, await createUser());
    const second = await signIn(app, await createUser());
    const res = await first.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', second.csrf);
    expect(res.status).toBe(403);
  });

  it('rejects unsafe requests from a foreign Origin, even with a valid token', async () => {
    const { agent, csrf } = await signIn(app, await createUser());
    const res = await agent
      .patch('/api/v1/settings')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', csrf)
      .send({ gymName: 'Hijacked' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('accepts the configured web origin', async () => {
    const { agent, csrf } = await signIn(app, await createUser());
    const res = await agent
      .patch('/api/v1/settings')
      .set('Origin', config.webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ gymName: 'Iron Works Gym' });
    expect(res.status).toBe(200);
  });
});

describe('HTTP hardening', () => {
  it('sends security headers and hides the framework', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['x-frame-options']).toBeTruthy();
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('tells browsers and proxies never to store API responses, errors included', async () => {
    const { agent } = await signIn(app, await createUser());
    const responses = {
      'signed in': await agent.get('/api/v1/auth/me'),
      list: await agent.get('/api/v1/members'),
      'not found': await agent.get('/api/v1/does-not-exist'),
      'signed out (401)': await request(app).get('/api/v1/members'),
    };
    for (const [label, res] of Object.entries(responses)) {
      expect(res.headers['cache-control'], label).toBe('no-store');
    }
  });

  it('refuses a body over 100 KB without parsing it', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@example.test', password: 'x'.repeat(110_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('allows CORS only for the configured web origin', async () => {
    const foreign = await request(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
    const own = await request(app).get('/api/v1/health').set('Origin', config.webOrigin);
    expect(own.headers['access-control-allow-origin']).toBe(config.webOrigin);
    expect(own.headers['access-control-allow-credentials']).toBe('true');
  });

  it('echoes a valid request ID and replaces an invalid one', async () => {
    const valid = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc12345-test');
    expect(valid.headers['x-request-id']).toBe('abc12345-test');
    const invalid = await request(app).get('/api/v1/health').set('X-Request-Id', '<script>');
    expect(invalid.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns a clean 400 for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('hides internal errors behind a reference ID', async () => {
    const { agent } = await signIn(app, await createUser());
    const spy = vi
      .spyOn(settingsService, 'getSettings')
      .mockRejectedValueOnce(new Error('db exploded at /secret/path'));
    try {
      const res = await agent.get('/api/v1/settings');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toContain(res.headers['x-request-id']);
      expect(JSON.stringify(res.body)).not.toMatch(/exploded|secret|stack|at /);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('health', () => {
  it('reports liveness and database readiness', async () => {
    expect((await request(app).get('/api/v1/health')).body).toEqual({ status: 'ok' });
    const ready = await request(app).get('/api/v1/health/ready');
    expect(ready.status).toBe(200);
  });
});
