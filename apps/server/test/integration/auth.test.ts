import { Writable } from 'node:stream';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { config } from '../../src/config/env';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, userSessions, users } from '../../src/db/schema';
import { createLogger } from '../../src/lib/logger';
import { signIn, testApp } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser, TEST_PASSWORD } from '../setup/factories';

const app = testApp();
const NEW_PASSWORD = 'Another-test-pass-77';

beforeEach(resetTables);
afterAll(closeDb);

const login = (email: string, password: string, target = app) =>
  request(target).post('/api/v1/auth/login').send({ email, password });

async function auditActions(userId: string) {
  const rows = await db
    .select({ action: auditLogs.action, after: auditLogs.after })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, userId));
  return rows;
}

describe('login', () => {
  it('sets an httpOnly, SameSite=Strict session cookie and records the sign-in', async () => {
    const user = await createUser({ role: 'MANAGER' });
    const res = await login(user.email.toUpperCase(), user.password);
    expect(res.status).toBe(204);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/gms_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
    expect(res.text).toBe('');

    const [row] = await db
      .select({ lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row?.lastLoginAt).not.toBeNull();
    expect((await auditActions(user.id)).map((a) => a.action)).toContain('LOGIN_SUCCEEDED');
  });

  it('stores only a hash of the session token', async () => {
    const user = await createUser();
    const res = await login(user.email, user.password);
    const token = /gms_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1]!;
    const sessions = await db.select({ tokenHash: userSessions.tokenHash }).from(userSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sessions[0]!.tokenHash).not.toContain(token);
  });

  it('hashes passwords with argon2id', async () => {
    const user = await createUser();
    const [row] = await db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row!.hash.startsWith('$argon2id$')).toBe(true);
  });

  it('returns the same generic error for an unknown email and a wrong password', async () => {
    const user = await createUser();
    const unknown = await login('nobody@example.test', TEST_PASSWORD);
    const wrong = await login(user.email, 'Wrong-password-123');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a deactivated account with the generic error', async () => {
    const user = await createUser({ isActive: false });
    const res = await login(user.email, user.password);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const actions = await auditActions(user.id);
    expect(
      actions.some((a) => a.action === 'LOGIN_FAILED' && a.after?.reason === 'ACCOUNT_INACTIVE'),
    ).toBe(true);
  });

  it('rejects unknown fields', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.test', password: 'x', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const user = await createUser();
    for (let i = 0; i < config.accountLockoutThreshold; i += 1) {
      expect((await login(user.email, `Wrong-password-${i}`)).status).toBe(401);
    }
    const [row] = await db
      .select({ lockedUntil: users.lockedUntil })
      .from(users)
      .where(eq(users.id, user.id));
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    const locked = await login(user.email, user.password);
    expect(locked.status).toBe(401);
    expect(locked.body.error.code).toBe('INVALID_CREDENTIALS');
    const actions = (await auditActions(user.id)).map((a) => a.action);
    expect(actions).toContain('ACCOUNT_LOCKED');
  });

  it('lets the account sign in again once the lock has expired', async () => {
    const user = await createUser();
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, user.id));
    expect((await login(user.email, user.password)).status).toBe(204);
  });

  it('rate-limits repeated failed attempts with 429', async () => {
    const limited = createApp({ rateLimits: { loginMax: 3 } });
    const user = await createUser();
    for (let i = 0; i < 3; i += 1)
      expect((await login(user.email, 'Wrong-password-x', limited)).status).toBe(401);
    const res = await login(user.email, user.password, limited);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('never writes the password or session token to the logs', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logger = createLogger({ level: 'trace', destination: sink });
    const logged = createApp({ logger, rateLimits: { loginMax: 1000 } });
    const user = await createUser();
    const res = await login(user.email, user.password, logged);
    const token = /gms_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1]!;
    await request(logged).get('/api/v1/auth/me').set('Cookie', `gms_session=${token}`);
    logger.info({ body: { password: user.password, token } }, 'redaction probe');

    const output = lines.join('');
    expect(output).toContain('redaction probe');
    expect(output).not.toContain(user.password);
    expect(output).not.toContain(token);
  });
});

describe('session', () => {
  it('/auth/me returns the user, permissions and a CSRF token — never the password hash', async () => {
    const user = await createUser({ role: 'RECEPTIONIST' });
    const { me } = await signIn(app, user);
    expect(me.user.email).toBe(user.email);
    expect(me.user.role).toBe('RECEPTIONIST');
    expect(me.permissions).toContain('members:create');
    expect(me.permissions).not.toContain('staff:manage');
    expect(me.csrfToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(me.gym.name).toBeTruthy();
    expect(JSON.stringify(me)).not.toMatch(/argon2|passwordHash/);
  });

  it('requires a session for /auth/me', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout revokes the session server-side', async () => {
    const user = await createUser();
    const { agent, csrf } = await signIn(app, user);
    expect((await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf)).status).toBe(204);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    const [session] = await db.select({ revokedAt: userSessions.revokedAt }).from(userSessions);
    expect(session!.revokedAt).not.toBeNull();
  });

  it('expires an idle session', async () => {
    const user = await createUser();
    const { agent } = await signIn(app, user);
    await db
      .update(userSessions)
      .set({ lastSeenAt: sql`now() - make_interval(mins => ${config.sessionIdleMinutes + 1})` })
      .where(eq(userSessions.userId, user.id));
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('expires a session at its absolute lifetime', async () => {
    const user = await createUser();
    const { agent } = await signIn(app, user);
    await db
      .update(userSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userSessions.userId, user.id));
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('ends the session of a user who is deactivated', async () => {
    const user = await createUser();
    const { agent } = await signIn(app, user);
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id));
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('ignores a forged session cookie', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'gms_session=forged-token-value');
    expect(res.status).toBe(401);
  });
});

describe('change password', () => {
  it('changes the password, ends other sessions and keeps the current one', async () => {
    const user = await createUser();
    const current = await signIn(app, user);
    const other = await signIn(app, user);

    const res = await current.agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', current.csrf)
      .send({ currentPassword: user.password, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(204);

    expect((await current.agent.get('/api/v1/auth/me')).status).toBe(200);
    expect((await other.agent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await login(user.email, user.password)).status).toBe(401);
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(204);

    const changed = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, 'PASSWORD_CHANGED')));
    expect(changed).toHaveLength(1);
  });

  it('rejects a wrong current password', async () => {
    const user = await createUser();
    const { agent, csrf } = await signIn(app, user);
    const res = await agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: 'Not-the-password-1', newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('currentPassword');
  });

  it('rejects reusing the same password and passwords that are too short', async () => {
    const user = await createUser();
    const { agent, csrf } = await signIn(app, user);
    const same = await agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: user.password, newPassword: user.password });
    expect(same.status).toBe(400);
    const short = await agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: user.password, newPassword: 'short' });
    expect(short.status).toBe(400);
  });

  it('blocks everything except password change until a forced change is done', async () => {
    const user = await createUser({ role: 'ADMIN', mustChangePassword: true });
    const { agent, csrf, me } = await signIn(app, user);
    expect(me.user.mustChangePassword).toBe(true);

    const blocked = await agent.get('/api/v1/staff');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    await agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf)
      .send({ currentPassword: user.password, newPassword: NEW_PASSWORD })
      .expect(204);
    expect((await agent.get('/api/v1/staff')).status).toBe(200);
  });
});
