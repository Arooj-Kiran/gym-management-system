import { BIOMETRIC_CONSENT } from '@gms/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, biometricConsents, biometricEnrollments, members } from '../../src/db/schema';
import { sha256Hex } from '../../src/lib/tokens';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createDevice, createMember, createUser, type TestUser } from '../setup/factories';

const app = testApp();

let admin: TestUser;
let session: Session;
let member: Awaited<ReturnType<typeof createMember>>;
let scanner: Awaited<ReturnType<typeof createDevice>>;

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
  member = await createMember({ firstName: 'Hamza', lastName: 'Qureshi' });
  scanner = await createDevice({ name: 'Front entrance' });
});
afterAll(closeDb);

const as = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1${path}`).set('X-CSRF-Token', s.csrf).send(body),
});
const api = () => as(session);
const consent = (memberId = member.id) =>
  api().post(`/members/${memberId}/biometric/consent`, {
    consentVersion: BIOMETRIC_CONSENT.version,
  });
const enroll = (body: object, memberId = member.id) =>
  api().post(`/members/${memberId}/biometric/enrollments`, body);

describe('consent', () => {
  it('records the current consent version and the hash of its text, once', async () => {
    const response = await consent();
    expect(response.status).toBe(201);
    expect(response.body.consent).toMatchObject({
      consentVersion: BIOMETRIC_CONSENT.version,
      recordedByName: 'Ayesha Malik',
      withdrawnAt: null,
    });
    const [row] = await db.select().from(biometricConsents);
    expect(row!.consentTextSha256).toBe(sha256Hex(BIOMETRIC_CONSENT.text));

    const again = await consent();
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONSENT_ALREADY_GIVEN');
  });

  it('rejects an outdated consent version and an archived member', async () => {
    const stale = await api().post(`/members/${member.id}/biometric/consent`, {
      consentVersion: '2020-01-v0',
    });
    expect(stale.status).toBe(400);
    await db
      .update(members)
      .set({ archivedAt: new Date(), archivedBy: admin.id })
      .where(eq(members.id, member.id));
    const archived = await consent();
    expect(archived.status).toBe(409);
    expect(archived.body.error.code).toBe('MEMBER_ARCHIVED');
  });

  it('withdrawal revokes every active enrollment and is audited', async () => {
    await consent();
    const enrolled = await enroll({ deviceId: scanner.device.id });
    expect(enrolled.status).toBe(201);

    const withdrawn = await api().post(`/members/${member.id}/biometric/consent/withdraw`, {
      reason: 'Member prefers the desk',
    });
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.consent).toBeNull();
    expect(withdrawn.body.consentHistory[0].withdrawnAt).not.toBeNull();
    expect(withdrawn.body.enrollments[0]).toMatchObject({
      status: 'REVOKED',
      revokeReason: 'Consent withdrawn',
    });
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs)).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining(['BIOMETRIC_CONSENT_WITHDRAWN', 'BIOMETRIC_ENROLLMENT_REVOKED']),
    );

    const again = await api().post(`/members/${member.id}/biometric/consent/withdraw`, {
      reason: 'Twice',
    });
    expect(again.body.error.code).toBe('CONSENT_REQUIRED');
    // A new consent can be given after a withdrawal.
    expect((await consent()).status).toBe(201);
  });
});

describe('enrollment', () => {
  it('requires consent first', async () => {
    const response = await enroll({ deviceId: scanner.device.id });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CONSENT_REQUIRED');
  });

  it('generates the next free SIM- ID on a simulated device and only ever shows it masked', async () => {
    await consent();
    const first = await enroll({ deviceId: scanner.device.id });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      provider: 'SIMULATED',
      status: 'ACTIVE',
      templateRefMasked: 'SIM-••01',
      device: { id: scanner.device.id, deviceType: 'SIMULATED' },
    });
    expect(JSON.stringify(first.body)).not.toContain('SIM-0001');

    const other = await createMember({ firstName: 'Sana', lastName: 'Mir' });
    await consent(other.id);
    const second = await enroll({ deviceId: scanner.device.id }, other.id);
    expect(second.body.templateRefMasked).toBe('SIM-••02');

    const status = await api().get(`/members/${member.id}/biometric`);
    expect(status.status).toBe(200);
    expect(JSON.stringify(status.body)).not.toContain('SIM-0001');
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'BIOMETRIC_ENROLLED'));
    expect(JSON.stringify(audit)).not.toContain('SIM-0001');
  });

  it('rejects a second enrollment on the same device and a ref already in use', async () => {
    await consent();
    await enroll({ deviceId: scanner.device.id, templateRef: 'SIM-0005' });
    const twice = await enroll({ deviceId: scanner.device.id });
    expect(twice.body.error.code).toBe('ALREADY_ENROLLED');

    const other = await createMember();
    await consent(other.id);
    const taken = await enroll({ deviceId: scanner.device.id, templateRef: 'SIM-0005' }, other.id);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('TEMPLATE_REF_IN_USE');
  });

  it('checks ref formats: SIM- only on simulated devices, never SIM-9999, required on real ones', async () => {
    await consent();
    const reserved = await enroll({ deviceId: scanner.device.id, templateRef: 'SIM-9999' });
    expect(reserved.status).toBe(400);
    const wrongFormat = await enroll({ deviceId: scanner.device.id, templateRef: '1042' });
    expect(wrongFormat.status).toBe(400);

    const real = await createDevice({ deviceType: 'REAL', vendor: 'ZKTeco' });
    const simOnReal = await enroll({ deviceId: real.device.id, templateRef: 'SIM-0001' });
    expect(simOnReal.status).toBe(400);
    const missing = await enroll({ deviceId: real.device.id });
    expect(missing.status).toBe(400);
    const ok = await enroll({ deviceId: real.device.id, templateRef: '1042' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ provider: 'ZKTECO', templateRefMasked: '••42' });
  });

  it('refuses a disabled device and an unknown one', async () => {
    await consent();
    const disabled = await createDevice({ status: 'DISABLED' });
    const response = await enroll({ deviceId: disabled.device.id });
    expect(response.body.error.code).toBe('DEVICE_DISABLED');
    const unknown = await enroll({ deviceId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.status).toBe(404);
  });
});

describe('revoke and device-confirmed deletion', () => {
  it('revoke → REVOKED; only the owning device can confirm deletion; confirming is idempotent', async () => {
    await consent();
    const enrolled = await enroll({ deviceId: scanner.device.id });
    const id = enrolled.body.id as string;

    const revoked = await api().post(`/biometric/enrollments/${id}/revoke`, {
      reason: 'Finger injury',
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ status: 'REVOKED', revokeReason: 'Finger injury' });
    const twice = await api().post(`/biometric/enrollments/${id}/revoke`, { reason: 'Again' });
    expect(twice.body.error.code).toBe('INVALID_STATUS_TRANSITION');

    const otherDevice = await createDevice();
    const confirmBy = (authorization: string) =>
      request(app)
        .post(`/api/v1/biometric/enrollments/${id}/confirm-deletion`)
        .set('Authorization', authorization);
    expect((await confirmBy(otherDevice.authorization)).status).toBe(404);
    expect((await confirmBy('Device nope')).status).toBe(401);

    const confirmed = await confirmBy(scanner.authorization);
    expect(confirmed.status).toBe(200);
    expect((await confirmBy(scanner.authorization)).body).toEqual({
      enrollmentId: id,
      status: 'DELETED',
    });
    const [row] = await db
      .select()
      .from(biometricEnrollments)
      .where(eq(biometricEnrollments.id, id));
    expect(row).toMatchObject({ status: 'DELETED', templateRef: null });
    expect(row!.deletedAt).not.toBeNull();
    const deletions = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'BIOMETRIC_TEMPLATE_DELETED'));
    expect(deletions).toHaveLength(1);

    // The member can be enrolled again on the same device afterwards.
    expect((await enroll({ deviceId: scanner.device.id })).status).toBe(201);
  });

  it('an active enrollment cannot be confirmed deleted', async () => {
    await consent();
    const enrolled = await enroll({ deviceId: scanner.device.id });
    const response = await request(app)
      .post(`/api/v1/biometric/enrollments/${enrolled.body.id}/confirm-deletion`)
      .set('Authorization', scanner.authorization);
    expect(response.status).toBe(409);
  });
});

describe('roles', () => {
  it('a Manager manages consent and enrollment; a Receptionist reads status only; a Trainer neither', async () => {
    const manager = as(await signIn(app, await createUser({ role: 'MANAGER' })));
    expect(
      (
        await manager.post(`/members/${member.id}/biometric/consent`, {
          consentVersion: BIOMETRIC_CONSENT.version,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await manager.post(`/members/${member.id}/biometric/enrollments`, {
          deviceId: scanner.device.id,
        })
      ).status,
    ).toBe(201);

    const desk = as(await signIn(app, await createUser({ role: 'RECEPTIONIST' })));
    const status = await desk.get(`/members/${member.id}/biometric`);
    expect(status.status).toBe(200);
    expect(status.body.enrollments).toHaveLength(1);
    expect(
      (await desk.post(`/members/${member.id}/biometric/consent/withdraw`, { reason: 'x' })).status,
    ).toBe(403);
    expect(
      (
        await desk.post(`/biometric/enrollments/${status.body.enrollments[0].id}/revoke`, {
          reason: 'x',
        })
      ).status,
    ).toBe(403);

    const trainer = as(await signIn(app, await createUser({ role: 'TRAINER' })));
    expect((await trainer.get(`/members/${member.id}/biometric`)).status).toBe(403);
    expect(
      (await trainer.post(`/members/${member.id}/biometric/consent/withdraw`, { reason: 'x' })).status,
    ).toBe(403);
  });
});
