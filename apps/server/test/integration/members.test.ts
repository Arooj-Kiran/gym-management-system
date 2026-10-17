import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, members, userSessions, users } from '../../src/db/schema';
import { gymToday } from '../../src/lib/dates';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createMember, createUser, type TestUser } from '../setup/factories';

const app = testApp();
const TEMP_PASSWORD = 'Temporary-pass-2026';

/** 1×1 PNG and a minimal JFIF header: enough for magic-byte detection. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(64),
]);

let admin: TestUser;
let session: Session;

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
});
afterAll(closeDb);

const as = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1/members${path}`),
  post: (path: string, body: object = {}) =>
    s.agent.post(`/api/v1/members${path}`).set('X-CSRF-Token', s.csrf).send(body),
  patch: (path: string, body: object) =>
    s.agent.patch(`/api/v1/members${path}`).set('X-CSRF-Token', s.csrf).send(body),
  upload: (path: string, data: Buffer, filename: string) =>
    s.agent
      .post(`/api/v1/members${path}`)
      .set('X-CSRF-Token', s.csrf)
      .attach('photo', data, filename),
});
const api = () => as(session);

async function auditFor(entityId: string, action: string) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, action)));
}

async function signInAs(role: TestUser['role']) {
  return signIn(app, await createUser({ role }));
}

const newMember = {
  firstName: 'Sana',
  lastName: 'Iqbal',
  email: 'Sana.Iqbal@Example.test',
  phone: '0300 7654321',
  emergencyContactName: 'Imran Iqbal',
  emergencyContactPhone: '0321 1112223',
  emergencyContactRelation: 'Brother',
  registrationDate: '2026-10-01',
  notes: 'Prefers evening sessions.',
};

describe('register a member (scenario 1)', () => {
  it('creates a member with a GM- code and an audit row', async () => {
    const res = await api().post('', newMember);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      firstName: 'Sana',
      lastName: 'Iqbal',
      email: 'sana.iqbal@example.test',
      phone: '+923007654321',
      emergencyContactPhone: '+923211112223',
      registrationDate: '2026-10-01',
      accountStatus: 'ACTIVE',
      accessBlocked: false,
      hasPortalAccount: false,
      portalAccount: null,
      archivedAt: null,
      isDemo: false,
      photoUrl: null,
    });
    expect(res.body.memberCode).toMatch(/^GM-\d{6}$/);

    const [audit] = await auditFor(res.body.id, 'MEMBER_CREATED');
    expect(audit!.actorUserId).toBe(admin.id);
    expect(audit!.after).toMatchObject({ memberCode: res.body.memberCode, phone: '+923007654321' });
  });

  it("defaults the registration date to today in the gym's time zone and rejects future dates", async () => {
    const { registrationDate: _omit, ...withoutDate } = newMember;
    const res = await api().post('', withoutDate);
    expect(res.status).toBe(201);
    expect(res.body.registrationDate).toBe(gymToday());

    const future = await api().post('', {
      ...newMember,
      email: 'other@example.test',
      phone: '0300 1111111',
      registrationDate: '2099-01-01',
    });
    expect(future.status).toBe(400);
    expect(future.body.error.details).toContainEqual(
      expect.objectContaining({ path: 'registrationDate' }),
    );
  });

  it('returns 400 with field details for invalid input', async () => {
    const res = await api().post('', { firstName: '', lastName: 'X', phone: '12', email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const paths = res.body.error.details.map((detail: { path: string }) => detail.path);
    expect(paths).toEqual(expect.arrayContaining(['firstName', 'phone', 'email']));
    expect(await db.select().from(members)).toHaveLength(0);
  });

  it('rejects unknown fields (no mass assignment)', async () => {
    for (const extra of [
      { memberCode: 'GM-999999' },
      { isDemo: true },
      { archivedAt: '2026-01-01' },
      { accessBlocked: true },
      { userId: admin.id },
    ]) {
      const res = await api().post('', { ...newMember, ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect(await db.select().from(members)).toHaveLength(0);
  });

  it('stores SQL-looking text as plain text', async () => {
    const res = await api().post('', {
      ...newMember,
      lastName: "O'Brien'); drop table members;--",
    });
    expect(res.status).toBe(201);
    expect(res.body.lastName).toBe("O'Brien'); drop table members;--");
    expect(await db.select().from(members)).toHaveLength(1);
  });
});

describe('duplicate email (C2: hard block)', () => {
  it('blocks a duplicate email regardless of case, names the existing member, and offers no override', async () => {
    const first = await api().post('', newMember).expect(201);
    const res = await api().post('', {
      ...newMember,
      email: 'SANA.IQBAL@example.TEST',
      phone: '0300 2223334',
      confirmDuplicatePhone: true,
      duplicatePhoneReason: 'Trying to override',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(res.body.error.existing).toEqual({
      id: first.body.id,
      memberCode: first.body.memberCode,
      firstName: 'Sana',
      lastName: 'Iqbal',
    });
    expect(await db.select().from(members)).toHaveLength(1);
  });

  it('allows an archived member’s email to be re-used, but blocks restoring the old one', async () => {
    const first = await api().post('', newMember).expect(201);
    await api().post(`/${first.body.id}/archive`, { reason: 'Moved away' }).expect(200);

    const second = await api().post('', { ...newMember, phone: '0300 2223334' });
    expect(second.status).toBe(201);

    const restore = await api().post(`/${first.body.id}/restore`, {});
    expect(restore.status).toBe(409);
    expect(restore.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(restore.body.error.existing.id).toBe(second.body.id);
  });

  it('blocks changing an email to one another current member uses', async () => {
    await api().post('', newMember).expect(201);
    const other = await api()
      .post('', { ...newMember, email: 'other@example.test', phone: '0300 2223334' })
      .expect(201);
    const res = await api().patch(`/${other.body.id}`, { email: 'sana.iqbal@example.test' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });
});

describe('duplicate phone (C2: warning with an audited override)', () => {
  const sibling = {
    firstName: 'Hamza',
    lastName: 'Iqbal',
    email: 'hamza.iqbal@example.test',
    phone: '+92 300 7654321',
  };

  it('warns with the matching members and creates nothing', async () => {
    const first = await api().post('', newMember).expect(201);
    const res = await api().post('', sibling);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_PHONE_WARNING');
    expect(res.body.error.matches).toEqual([
      {
        id: first.body.id,
        memberCode: first.body.memberCode,
        firstName: 'Sana',
        lastName: 'Iqbal',
        sameName: false,
      },
    ]);
    expect(await db.select().from(members)).toHaveLength(1);
  });

  it('flags a same-name + same-phone match as a possible duplicate person', async () => {
    await api().post('', newMember).expect(201);
    const res = await api().post('', {
      ...newMember,
      firstName: ' sana ',
      lastName: 'IQBAL',
      email: 'sana.second@example.test',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_PHONE_WARNING');
    expect(res.body.error.matches[0].sameName).toBe(true);
    expect(res.body.error.message).toMatch(/same name and phone/i);
  });

  it('accepts the override with a reason and writes one audit row in the same transaction', async () => {
    const first = await api().post('', newMember).expect(201);
    const res = await api().post('', {
      ...sibling,
      confirmDuplicatePhone: true,
      duplicatePhoneReason: 'Siblings share the family phone',
    });
    expect(res.status).toBe(201);
    expect(res.body.phone).toBe('+923007654321');

    const rows = await auditFor(res.body.id, 'MEMBER_DUPLICATE_PHONE_CONFIRMED');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe('Siblings share the family phone');
    expect(rows[0]!.actorUserId).toBe(admin.id);
    expect(rows[0]!.after).toMatchObject({
      phone: '+923007654321',
      matchedMemberIds: [first.body.id],
      matchedMemberCodes: [first.body.memberCode],
      sameNameMatch: false,
    });
    const [created] = await auditFor(res.body.id, 'MEMBER_CREATED');
    expect(created!.requestId).toBe(rows[0]!.requestId);
  });

  it('rejects a confirmation without a reason (400)', async () => {
    await api().post('', newMember).expect(201);
    for (const reason of [undefined, '', '  ', 'ok']) {
      const res = await api().post('', {
        ...sibling,
        confirmDuplicatePhone: true,
        ...(reason === undefined ? {} : { duplicatePhoneReason: reason }),
      });
      expect(res.status, String(reason)).toBe(400);
      expect(res.body.error.details).toContainEqual(
        expect.objectContaining({ path: 'duplicatePhoneReason' }),
      );
    }
    expect(await db.select().from(members)).toHaveLength(1);
  });

  it('does not write an override audit row when no phone actually matched', async () => {
    const res = await api().post('', {
      ...newMember,
      confirmDuplicatePhone: true,
      duplicatePhoneReason: 'Just in case',
    });
    expect(res.status).toBe(201);
    expect(await auditFor(res.body.id, 'MEMBER_DUPLICATE_PHONE_CONFIRMED')).toHaveLength(0);
  });

  it('ignores archived members when matching phones', async () => {
    const first = await api().post('', newMember).expect(201);
    await api().post(`/${first.body.id}/archive`, { reason: 'Left the gym' }).expect(200);
    await api().post('', sibling).expect(201);
  });

  it('gives the same warning when an update changes the phone', async () => {
    await api().post('', newMember).expect(201);
    const other = await api()
      .post('', { ...sibling, phone: '0300 9998887' })
      .expect(201);

    const warned = await api().patch(`/${other.body.id}`, { phone: '0300 7654321' });
    expect(warned.status).toBe(409);
    expect(warned.body.error.code).toBe('DUPLICATE_PHONE_WARNING');

    const noReason = await api().patch(`/${other.body.id}`, {
      phone: '0300 7654321',
      confirmDuplicatePhone: true,
    });
    expect(noReason.status).toBe(400);

    const confirmed = await api().patch(`/${other.body.id}`, {
      phone: '0300 7654321',
      confirmDuplicatePhone: true,
      duplicatePhoneReason: 'Shared family number',
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.phone).toBe('+923007654321');
    expect(await auditFor(other.body.id, 'MEMBER_DUPLICATE_PHONE_CONFIRMED')).toHaveLength(1);

    // Saving other fields later does not warn again: the phone itself did not change.
    const later = await api().patch(`/${other.body.id}`, { notes: 'Morning slot' });
    expect(later.status).toBe(200);
  });

  it('does not let a Trainer or Member create (or confirm) a member', async () => {
    await api().post('', newMember).expect(201);
    for (const role of ['TRAINER', 'MEMBER'] as const) {
      const res = await as(await signInAs(role)).post('', {
        ...sibling,
        confirmDuplicatePhone: true,
        duplicatePhoneReason: 'Shared family number',
      });
      expect(res.status, role).toBe(403);
    }
    expect(await db.select().from(members)).toHaveLength(1);
  });

  it('pre-checks duplicates for the form without saving anything', async () => {
    const first = await api().post('', newMember).expect(201);
    const res = await api().get(
      `/check-duplicate?email=SANA.IQBAL@example.test&phone=0300%207654321&firstName=Sana&lastName=Iqbal`,
    );
    expect(res.status).toBe(200);
    expect(res.body.emailConflict).toMatchObject({ id: first.body.id });
    expect(res.body.phoneMatches).toEqual([
      expect.objectContaining({ id: first.body.id, sameName: true }),
    ]);

    const self = await api().get(
      `/check-duplicate?email=sana.iqbal@example.test&phone=03007654321&excludeId=${first.body.id}`,
    );
    expect(self.body).toEqual({ emailConflict: null, phoneMatches: [] });

    const partial = await api().get('/check-duplicate?email=not-an-email&phone=03');
    expect(partial.status).toBe(200);
    expect(partial.body).toEqual({ emailConflict: null, phoneMatches: [] });
  });
});

describe('update, archive and restore', () => {
  it('updates fields, audits only the changes, and rejects protected fields', async () => {
    const created = await api().post('', newMember).expect(201);
    const res = await api().patch(`/${created.body.id}`, {
      lastName: 'Iqbal-Khan',
      notes: newMember.notes,
      accountStatus: 'INACTIVE',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lastName: 'Iqbal-Khan', accountStatus: 'INACTIVE' });
    const [audit] = await auditFor(created.body.id, 'MEMBER_UPDATED');
    expect(audit!.before).toEqual({ lastName: 'Iqbal', accountStatus: 'ACTIVE' });
    expect(audit!.after).toEqual({ lastName: 'Iqbal-Khan', accountStatus: 'INACTIVE' });

    for (const body of [
      { memberCode: 'GM-000999' },
      { archivedAt: null },
      { accessBlocked: false },
      { isDemo: true },
      {},
    ]) {
      expect((await api().patch(`/${created.body.id}`, body)).status, JSON.stringify(body)).toBe(
        400,
      );
    }
  });

  it('never lets the member code change, even directly in the database', async () => {
    const member = await createMember();
    await expect(
      db.update(members).set({ memberCode: 'GM-999999' }).where(eq(members.id, member.id)),
    ).rejects.toThrow();
    const [row] = await db.select().from(members).where(eq(members.id, member.id));
    expect(row!.memberCode).toBe(member.memberCode);
  });

  it('issues sequential, unique member codes', async () => {
    const a = await createMember();
    const b = await createMember();
    const number = (code: string) => Number(code.slice(3));
    expect(number(b.memberCode)).toBe(number(a.memberCode) + 1);
  });

  it('archives with a required reason, blocks edits while archived, and restores', async () => {
    const created = await api().post('', newMember).expect(201);
    const id = created.body.id;

    expect((await api().post(`/${id}/archive`, {})).status).toBe(400);

    const archived = await api().post(`/${id}/archive`, { reason: 'Moved to another city' });
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).not.toBeNull();
    const [audit] = await auditFor(id, 'MEMBER_ARCHIVED');
    expect(audit!.reason).toBe('Moved to another city');

    const edit = await api().patch(`/${id}`, { notes: 'x' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('MEMBER_ARCHIVED');
    expect((await api().upload(`/${id}/photo`, PNG, 'me.png')).status).toBe(409);

    // History is kept: the archived member is still readable.
    expect((await api().get(`/${id}`)).status).toBe(200);

    const restored = await api().post(`/${id}/restore`, { reason: 'Came back' });
    expect(restored.status).toBe(200);
    expect(restored.body.archivedAt).toBeNull();
    expect(await auditFor(id, 'MEMBER_RESTORED')).toHaveLength(1);
  });

  it('does not let a Receptionist archive or block access', async () => {
    const member = await createMember();
    const receptionist = as(await signInAs('RECEPTIONIST'));
    expect((await receptionist.post(`/${member.id}/archive`, { reason: 'Test' })).status).toBe(403);
    expect((await receptionist.post(`/${member.id}/access-block`, { reason: 'Test' })).status).toBe(
      403,
    );
    const [row] = await db.select().from(members).where(eq(members.id, member.id));
    expect(row!.archivedAt).toBeNull();
    expect(row!.accessBlocked).toBe(false);
  });

  it('returns 404 for an unknown member and 400 for a malformed id', async () => {
    expect((await api().get('/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await api().get('/not-a-uuid')).status).toBe(400);
  });
});

describe('search, sort, filter and pagination', () => {
  beforeEach(async () => {
    await createMember({
      firstName: 'Ali',
      lastName: 'Raza',
      email: 'ali.raza@example.test',
      phoneE164: '+923001234567',
      registrationDate: '2026-01-10',
    });
    await createMember({
      firstName: 'Bushra',
      lastName: 'Ansari',
      phoneE164: '+923217654321',
      registrationDate: '2026-03-05',
      accountStatus: 'INACTIVE',
    });
    await createMember({
      firstName: 'Danish',
      lastName: 'Qureshi',
      phoneE164: '+923331112222',
      registrationDate: '2026-06-20',
      accessBlocked: true,
      accessBlockReason: 'Unpaid locker damage',
      accessBlockedAt: new Date(),
    });
    await createMember({
      firstName: 'Erum',
      lastName: 'Bukhari',
      phoneE164: '+923451239999',
      registrationDate: '2026-08-01',
      archivedAt: new Date(),
      archivedBy: admin.id,
    });
  });

  const names = (body: { data: { firstName: string }[] }) =>
    body.data.map((member) => member.firstName);

  it('lists current members by default and archived ones on request', async () => {
    const current = await api().get('?sort=name');
    expect(current.status).toBe(200);
    expect(names(current.body)).toEqual(['Bushra', 'Danish', 'Ali']);
    expect(current.body.total).toBe(3);

    expect(names((await api().get('?view=archived')).body)).toEqual(['Erum']);
    expect((await api().get('?view=all')).body.total).toBe(4);
  });

  it('searches by name, email, member code and phone (national or international form)', async () => {
    expect(names((await api().get('?q=raza')).body)).toEqual(['Ali']);
    expect(names((await api().get('?q=ali raza')).body)).toEqual(['Ali']);
    expect(names((await api().get('?q=ALI.RAZA@example')).body)).toEqual(['Ali']);
    expect(names((await api().get('?q=0321 765')).body)).toEqual(['Bushra']);
    expect(names((await api().get('?q=%2B92333111')).body)).toEqual(['Danish']);

    const [danish] = await db.select().from(members).where(eq(members.firstName, 'Danish'));
    expect(names((await api().get(`?q=${danish!.memberCode}`)).body)).toEqual(['Danish']);
    expect((await api().get('?q=%25')).body.total).toBe(0);
  });

  it('filters by status, access block and registration date range (inclusive)', async () => {
    expect(names((await api().get('?accountStatus=INACTIVE')).body)).toEqual(['Bushra']);
    expect(names((await api().get('?accessBlocked=true')).body)).toEqual(['Danish']);
    expect(
      names((await api().get('?registeredFrom=2026-03-05&registeredTo=2026-06-20&sort=name')).body),
    ).toEqual(['Bushra', 'Danish']);
    expect((await api().get('?accountStatus=GONE')).status).toBe(400);
  });

  it('sorts both ways and paginates', async () => {
    expect(names((await api().get('?sort=registrationDate')).body)).toEqual([
      'Danish',
      'Bushra',
      'Ali',
    ]);
    expect(names((await api().get('?sort=registrationDate&order=asc')).body)).toEqual([
      'Ali',
      'Bushra',
      'Danish',
    ]);
    const page2 = await api().get('?sort=registrationDate&order=asc&pageSize=2&page=2');
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(names(page2.body)).toEqual(['Danish']);
    expect((await api().get('?pageSize=101')).status).toBe(400);
    expect((await api().get('?sort=password')).status).toBe(400);
  });
});

describe('profile photo', () => {
  it('accepts PNG and JPEG, serves them privately, and replaces the old file', async () => {
    const member = await createMember();
    const png = await api().upload(`/${member.id}/photo`, PNG, 'face.png');
    expect(png.status).toBe(200);
    expect(png.body.photoUrl).toMatch(new RegExp(`^/api/v1/members/${member.id}/photo\\?v=`));
    const [audit] = await auditFor(member.id, 'MEMBER_PHOTO_UPDATED');
    expect(audit!.after).toMatchObject({ contentType: 'image/png' });

    const served = await api().get(`/${member.id}/photo`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toBe('private, max-age=86400');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);

    const jpeg = await api().upload(`/${member.id}/photo`, JPEG, 'face.jpg');
    expect(jpeg.status).toBe(200);
    expect(jpeg.body.photoUrl).not.toBe(png.body.photoUrl);
    expect((await api().get(`/${member.id}/photo`)).headers['content-type']).toBe('image/jpeg');
  });

  it('rejects a fake extension, a missing file, and an oversized file', async () => {
    const member = await createMember();
    const fake = await api().upload(
      `/${member.id}/photo`,
      Buffer.from('<script>alert(1)</script>'),
      'face.png',
    );
    expect(fake.status).toBe(400);
    expect(fake.body.error.details).toContainEqual(expect.objectContaining({ path: 'photo' }));

    const missing = await api().post(`/${member.id}/photo`, {});
    expect(missing.status).toBe(400);

    // MAX_UPLOAD_MB is 1 in tests.
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 1)]);
    const oversized = await api().upload(`/${member.id}/photo`, big, 'big.png');
    expect(oversized.status).toBe(413);

    const [row] = await db.select().from(members).where(eq(members.id, member.id));
    expect(row!.profilePhotoKey).toBeNull();
    expect((await api().get(`/${member.id}/photo`)).status).toBe(404);
  });

  it('requires a signed-in user with access to the member', async () => {
    const member = await createMember();
    await api().upload(`/${member.id}/photo`, PNG, 'face.png').expect(200);
    const { default: request } = await import('supertest');
    expect((await request(app).get(`/api/v1/members/${member.id}/photo`)).status).toBe(401);
    expect((await as(await signInAs('TRAINER')).get(`/${member.id}/photo`)).status).toBe(403);
    expect((await as(await signInAs('MEMBER')).get(`/${member.id}/photo`)).status).toBe(403);
  });
});

describe('portal account and access block', () => {
  it('creates a MEMBER login with a temporary password that must be changed', async () => {
    const created = await api().post('', newMember).expect(201);
    const res = await api().post(`/${created.body.id}/portal-account`, {
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.body.hasPortalAccount).toBe(true);
    expect(res.body.portalAccount).toMatchObject({
      email: 'sana.iqbal@example.test',
      isActive: true,
      mustChangePassword: true,
    });
    expect(JSON.stringify(res.body)).not.toContain(TEMP_PASSWORD);

    const [audit] = await auditFor(created.body.id, 'MEMBER_PORTAL_ACCOUNT_CREATED');
    expect(JSON.stringify(audit)).not.toContain(TEMP_PASSWORD);

    const portal = await signIn(app, { email: newMember.email, password: TEMP_PASSWORD });
    expect(portal.me.user.role).toBe('MEMBER');
    expect(portal.me.user.mustChangePassword).toBe(true);
    const blocked = await portal.agent.get('/api/v1/me/profile');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const again = await api().post(`/${created.body.id}/portal-account`, {
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PORTAL_ACCOUNT_EXISTS');
  });

  it('requires an email and a strong temporary password', async () => {
    const member = await createMember({ email: null });
    const noEmail = await api().post(`/${member.id}/portal-account`, {
      temporaryPassword: TEMP_PASSWORD,
    });
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error.details).toContainEqual(expect.objectContaining({ path: 'email' }));

    const withEmail = await createMember({ email: 'weak@example.test' });
    const weak = await api().post(`/${withEmail.id}/portal-account`, {
      temporaryPassword: 'short',
    });
    expect(weak.status).toBe(400);
  });

  it('keeps the login in step with the profile, and archiving ends its sessions', async () => {
    const created = await api().post('', newMember).expect(201);
    const id = created.body.id;
    await api().post(`/${id}/portal-account`, { temporaryPassword: TEMP_PASSWORD }).expect(201);
    const [member] = await db.select().from(members).where(eq(members.id, id));

    await api().patch(`/${id}`, { email: 'sana.new@example.test' }).expect(200);
    const [user] = await db.select().from(users).where(eq(users.id, member!.userId!));
    expect(user!.email).toBe('sana.new@example.test');

    const removeEmail = await api().patch(`/${id}`, { email: null });
    expect(removeEmail.status).toBe(400);

    // Taken by a staff login: 409, and nothing changes.
    const staff = await createUser({ role: 'RECEPTIONIST', email: 'desk@example.test' });
    const taken = await api().patch(`/${id}`, { email: staff.email });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('DUPLICATE_EMAIL');

    const portal = await signIn(app, { email: 'sana.new@example.test', password: TEMP_PASSWORD });
    await api().post(`/${id}/archive`, { reason: 'Membership ended' }).expect(200);
    expect((await portal.agent.get('/api/v1/auth/me')).status).toBe(401);
    const live = await db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userId, member!.userId!), sql`revoked_at is null`));
    expect(live).toHaveLength(0);
    const [deactivated] = await db.select().from(users).where(eq(users.id, member!.userId!));
    expect(deactivated!.isActive).toBe(false);

    await api().post(`/${id}/restore`, {}).expect(200);
    const [reactivated] = await db.select().from(users).where(eq(users.id, member!.userId!));
    expect(reactivated!.isActive).toBe(true);
  });

  it('blocks access with a required reason and unblocks it, auditing both', async () => {
    const member = await createMember();
    expect((await api().post(`/${member.id}/access-block`, {})).status).toBe(400);

    const blocked = await api().post(`/${member.id}/access-block`, { reason: 'ID check pending' });
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({
      accessBlocked: true,
      accessBlockReason: 'ID check pending',
    });
    expect(blocked.body.accessBlockedAt).not.toBeNull();

    const unblocked = await api().post(`/${member.id}/access-unblock`, { reason: 'ID verified' });
    expect(unblocked.body).toMatchObject({
      accessBlocked: false,
      accessBlockReason: null,
      accessBlockedAt: null,
    });
    expect((await auditFor(member.id, 'MEMBER_ACCESS_BLOCKED'))[0]!.reason).toBe(
      'ID check pending',
    );
    expect((await auditFor(member.id, 'MEMBER_ACCESS_UNBLOCKED'))[0]!.reason).toBe('ID verified');
  });
});

describe('trainer scope until assignments exist (Stage 6)', () => {
  it('shows a trainer no members and refuses member detail', async () => {
    const member = await createMember();
    const trainer = as(await signInAs('TRAINER'));
    const list = await trainer.get('');
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ data: [], total: 0 });
    expect((await trainer.get(`/${member.id}`)).status).toBe(403);
    expect((await trainer.patch(`/${member.id}`, { notes: 'x' })).status).toBe(403);
  });
});
