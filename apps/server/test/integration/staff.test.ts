import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, userSessions } from '../../src/db/schema';
import * as staffService from '../../src/modules/staff/staff.service';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser, type TestUser } from '../setup/factories';

const app = testApp();
const TEMP_PASSWORD = 'Temporary-pass-2026';

let admin: TestUser;
let session: Session;

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
});
afterAll(closeDb);

const post = (path: string, body: object = {}) =>
  session.agent.post(`/api/v1/staff${path}`).set('X-CSRF-Token', session.csrf).send(body);
const patch = (path: string, body: object) =>
  session.agent.patch(`/api/v1/staff${path}`).set('X-CSRF-Token', session.csrf).send(body);

const login = ({ email, password }: Pick<TestUser, 'email' | 'password'>) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

async function auditFor(entityId: string, action: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, action)));
}

const newStaff = {
  email: 'Bilal.Ahmed@Example.test',
  firstName: 'Bilal',
  lastName: 'Ahmed',
  phone: '0300 1234567',
  jobTitle: 'Front desk',
  hireDate: '2026-09-01',
  role: 'RECEPTIONIST',
  temporaryPassword: TEMP_PASSWORD,
};

describe('create staff', () => {
  it('creates a staff account that must change its password, and audits it without the password', async () => {
    const res = await post('', newStaff);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'bilal.ahmed@example.test',
      phone: '+923001234567',
      role: 'RECEPTIONIST',
      isActive: true,
      mustChangePassword: true,
      jobTitle: 'Front desk',
      hireDate: '2026-09-01',
    });
    expect(JSON.stringify(res.body)).not.toContain(TEMP_PASSWORD);
    expect(res.body.passwordHash).toBeUndefined();

    const [audit] = await auditFor(res.body.id, 'STAFF_CREATED');
    expect(audit!.actorUserId).toBe(admin.id);
    expect(audit!.actorRole).toBe('ADMIN');
    expect(audit!.after).toMatchObject({ email: 'bilal.ahmed@example.test', role: 'RECEPTIONIST' });
    expect(JSON.stringify(audit)).not.toContain(TEMP_PASSWORD);

    const signedIn = await signIn(app, { email: newStaff.email, password: TEMP_PASSWORD });
    expect(signedIn.me.user.mustChangePassword).toBe(true);
  });

  it('blocks a duplicate email regardless of case', async () => {
    await post('', newStaff).expect(201);
    const res = await post('', { ...newStaff, email: 'BILAL.AHMED@example.test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });

  it('refuses the MEMBER role, weak passwords and unknown fields', async () => {
    expect((await post('', { ...newStaff, role: 'MEMBER' })).status).toBe(400);
    expect((await post('', { ...newStaff, temporaryPassword: 'short' })).status).toBe(400);
    const extra = await post('', { ...newStaff, isActive: false });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('list and view staff', () => {
  it('lists, searches, filters and paginates', async () => {
    await createUser({ role: 'TRAINER', firstName: 'Usman', lastName: 'Tariq' });
    await createUser({ role: 'TRAINER', firstName: 'Sana', lastName: 'Iqbal', isActive: false });
    await createUser({ role: 'MEMBER', firstName: 'Hidden', lastName: 'Member' });

    const all = await session.agent.get('/api/v1/staff');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(3);
    expect(all.body.data.every((s: { role: string }) => s.role !== 'MEMBER')).toBe(true);

    const trainers = await session.agent.get('/api/v1/staff?role=TRAINER&status=active');
    expect(trainers.body.data.map((s: { firstName: string }) => s.firstName)).toEqual(['Usman']);

    const search = await session.agent.get('/api/v1/staff?q=iqb');
    expect(search.body.data.map((s: { lastName: string }) => s.lastName)).toEqual(['Iqbal']);

    const page = await session.agent.get('/api/v1/staff?pageSize=2&page=2&sort=name');
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page.body.data).toHaveLength(1);
  });

  it('returns 404 for a member or unknown id, and 400 for a malformed id', async () => {
    const member = await createUser({ role: 'MEMBER' });
    expect((await session.agent.get(`/api/v1/staff/${member.id}`)).status).toBe(404);
    expect(
      (await session.agent.get('/api/v1/staff/8b1c3a5e-0000-4000-8000-000000000000')).status,
    ).toBe(404);
    expect((await session.agent.get('/api/v1/staff/not-a-uuid')).status).toBe(400);
  });
});

describe('edit staff', () => {
  it('updates profile fields and audits only what changed', async () => {
    const trainer = await createUser({ role: 'TRAINER', firstName: 'Usman' });
    const res = await patch(`/${trainer.id}`, {
      firstName: 'Usman',
      jobTitle: 'Head coach',
      notes: 'Strength team',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      firstName: 'Usman',
      jobTitle: 'Head coach',
      notes: 'Strength team',
    });

    const [audit] = await auditFor(trainer.id, 'STAFF_UPDATED');
    expect(audit!.before).toEqual({ jobTitle: null, notes: null });
    expect(audit!.after).toEqual({ jobTitle: 'Head coach', notes: 'Strength team' });
  });

  it('does not write an audit row when nothing changed', async () => {
    const trainer = await createUser({ role: 'TRAINER', firstName: 'Usman' });
    await patch(`/${trainer.id}`, { firstName: 'Usman' }).expect(200);
    expect(await auditFor(trainer.id, 'STAFF_UPDATED')).toHaveLength(0);
  });

  it('rejects an email already used by another account', async () => {
    const other = await createUser({ role: 'TRAINER' });
    const res = await patch(`/${other.id}`, { email: admin.email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });
});

describe('roles', () => {
  it('changes a role with a reason and audits before/after', async () => {
    const trainer = await createUser({ role: 'TRAINER' });
    const res = await patch(`/${trainer.id}/role`, {
      role: 'MANAGER',
      reason: 'Promoted to floor manager',
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('MANAGER');
    const [audit] = await auditFor(trainer.id, 'ROLE_CHANGED');
    expect(audit).toMatchObject({
      before: { role: 'TRAINER' },
      after: { role: 'MANAGER' },
      reason: 'Promoted to floor manager',
    });
  });

  it('refuses to change your own role', async () => {
    const res = await patch(`/${admin.id}/role`, { role: 'TRAINER' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_ACTION_NOT_ALLOWED');
  });

  it('lets one admin demote another while a second active admin remains', async () => {
    const second = await createUser({ role: 'ADMIN' });
    await patch(`/${second.id}/role`, { role: 'MANAGER' }).expect(200);
    await post(`/${second.id}/deactivate`, { reason: 'Left the gym' }).expect(200);
  });

  it('never removes the last active admin (demotion or deactivation)', async () => {
    // Through the API an admin always counts as "another active admin", so the guard is
    // exercised at service level with a non-admin actor (e.g. a future system job).
    const systemCtx = {
      actorUserId: null,
      actorRole: null,
      ip: null,
      userAgent: null,
      requestId: null,
    };
    await expect(
      staffService.changeRole(admin.id, 'MANAGER', undefined, systemCtx),
    ).rejects.toMatchObject({
      status: 409,
      code: 'LAST_ADMIN',
    });
    await expect(
      staffService.setActive(admin.id, false, 'Testing', systemCtx),
    ).rejects.toMatchObject({
      status: 409,
      code: 'LAST_ADMIN',
    });

    // An inactive admin does not count as a remaining admin.
    await createUser({ role: 'ADMIN', isActive: false });
    await expect(
      staffService.changeRole(admin.id, 'MANAGER', undefined, systemCtx),
    ).rejects.toMatchObject({
      code: 'LAST_ADMIN',
    });
    expect(await auditFor(admin.id, 'ROLE_CHANGED')).toHaveLength(0);
  });
});

describe('activation and password reset', () => {
  it('deactivation needs a reason, ends sessions and is audited', async () => {
    const trainer = await createUser({ role: 'TRAINER' });
    const trainerSession = await signIn(app, trainer);

    expect((await post(`/${trainer.id}/deactivate`, {})).status).toBe(400);
    const res = await post(`/${trainer.id}/deactivate`, { reason: 'Contract ended' });
    expect(res.status).toBe(200);
    expect(res.body.isActive).toBe(false);
    expect((await trainerSession.agent.get('/api/v1/auth/me')).status).toBe(401);

    const live = await db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(eq(userSessions.userId, trainer.id), isNull(userSessions.revokedAt)));
    expect(live).toHaveLength(0);
    const [audit] = await auditFor(trainer.id, 'STAFF_DEACTIVATED');
    expect(audit!.reason).toBe('Contract ended');

    await post(`/${trainer.id}/activate`, { reason: 'Re-hired' }).expect(200);
    expect(await auditFor(trainer.id, 'STAFF_ACTIVATED')).toHaveLength(1);
    expect((await login(trainer)).status).toBe(204);
  });

  it('refuses to deactivate yourself', async () => {
    const res = await post(`/${admin.id}/deactivate`, { reason: 'Oops' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SELF_ACTION_NOT_ALLOWED');
  });

  it('resets a password: old one stops working, sessions end, change is forced', async () => {
    const trainer = await createUser({ role: 'TRAINER' });
    const trainerSession = await signIn(app, trainer);

    const res = await post(`/${trainer.id}/reset-password`, { temporaryPassword: TEMP_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(TEMP_PASSWORD);
    expect((await trainerSession.agent.get('/api/v1/auth/me')).status).toBe(401);

    expect((await login(trainer)).status).toBe(401);
    const fresh = await signIn(app, { email: trainer.email, password: TEMP_PASSWORD });
    expect(fresh.me.user.mustChangePassword).toBe(true);

    const [audit] = await auditFor(trainer.id, 'STAFF_PASSWORD_RESET');
    expect(audit!.after).toEqual({ changeRequiredAtNextSignIn: true, sessionsRevoked: true });
    expect(JSON.stringify(audit)).not.toContain(TEMP_PASSWORD);
  });

  it('refuses to reset your own password here', async () => {
    const res = await post(`/${admin.id}/reset-password`, { temporaryPassword: TEMP_PASSWORD });
    expect(res.body.error.code).toBe('SELF_ACTION_NOT_ALLOWED');
  });
});
