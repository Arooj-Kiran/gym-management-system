import { addDays } from '@gms/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { auditLogs, members } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { gymToday } from '../../src/lib/dates';
import {
  createMember,
  createMembership,
  createPlan,
  createUser,
  type TestUser,
} from '../setup/factories';

const app = testApp();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let admin: TestUser;
let memberA: Awaited<ReturnType<typeof createMember>>;
let memberB: Awaited<ReturnType<typeof createMember>>;
let sessionA: Session;

async function portalMember(firstName: string, email: string) {
  const user = await createUser({ role: 'MEMBER', email, firstName, lastName: 'Portal' });
  const member = await createMember({ userId: user.id, email, firstName, lastName: 'Portal' });
  return { user, member };
}

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN' });
  const a = await portalMember('Amna', 'amna@example.test');
  const b = await portalMember('Bilal', 'bilal@example.test');
  memberA = a.member;
  memberB = b.member;
  sessionA = await signIn(app, a.user);
  // B has a photo, so the photo route has something to leak if it were not guarded.
  const adminSession = await signIn(app, admin);
  await adminSession.agent
    .post(`/api/v1/members/${memberB.id}/photo`)
    .set('X-CSRF-Token', adminSession.csrf)
    .attach('photo', PNG, 'b.png')
    .expect(200);
});
afterAll(closeDb);

const me = (s: Session) => ({
  get: (path: string) => s.agent.get(`/api/v1/me${path}`),
  patch: (path: string, body: object) =>
    s.agent.patch(`/api/v1/me${path}`).set('X-CSRF-Token', s.csrf).send(body),
  upload: (path: string, data: Buffer, filename: string) =>
    s.agent.post(`/api/v1/me${path}`).set('X-CSRF-Token', s.csrf).attach('photo', data, filename),
});

describe("members cannot reach other members' records (scenario 12, members part)", () => {
  it("returns 403 for B's staff routes, whatever the id", async () => {
    for (const path of [
      `/members/${memberB.id}`,
      `/members/${memberB.id}/photo`,
      `/members/${memberA.id}`,
      '/members',
      `/members/check-duplicate?email=bilal@example.test`,
    ]) {
      const res = await sessionA.agent.get(`/api/v1${path}`);
      expect(res.status, path).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('bilal@example.test');
    }
    const patch = await sessionA.agent
      .patch(`/api/v1/members/${memberB.id}`)
      .set('X-CSRF-Token', sessionA.csrf)
      .send({ notes: 'hijack' });
    expect(patch.status).toBe(403);
  });

  it("returns only the signed-in member's own profile from /me", async () => {
    const res = await me(sessionA).get('/profile');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      memberCode: memberA.memberCode,
      firstName: 'Amna',
      email: 'amna@example.test',
      photoUrl: null,
    });
    expect(JSON.stringify(res.body)).not.toContain(memberB.memberCode);
    // Staff-only fields are not part of the portal shape.
    expect(res.body).not.toHaveProperty('notes');
    expect(res.body).not.toHaveProperty('id');
    expect(res.body).not.toHaveProperty('accessBlockReason');

    expect((await me(sessionA).get('/profile/photo')).status).toBe(404);
  });

  it('ignores any member id in the request', async () => {
    const res = await me(sessionA).get(`/profile?memberId=${memberB.id}`);
    expect(res.status).toBe(200);
    expect(res.body.memberCode).toBe(memberA.memberCode);
  });
});

describe('/me/profile updates', () => {
  it('lets a member edit their emergency contact only, with an audit row', async () => {
    const res = await me(sessionA).patch('/profile', {
      emergencyContactName: 'Rashid Portal',
      emergencyContactPhone: '0333 4445556',
      emergencyContactRelation: 'Father',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      emergencyContactName: 'Rashid Portal',
      emergencyContactPhone: '+923334445556',
    });
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, memberA.id),
          eq(auditLogs.action, 'MEMBER_PROFILE_SELF_UPDATED'),
        ),
      );
    expect(audit!.after).toMatchObject({ emergencyContactName: 'Rashid Portal' });
  });

  it('cannot change name, phone, email, status or anything else', async () => {
    for (const body of [
      { firstName: 'Changed' },
      { phone: '0300 0000000' },
      { email: 'new@example.test' },
      { accountStatus: 'ACTIVE' },
      { accessBlocked: false },
      { notes: 'x' },
      {},
    ]) {
      const res = await me(sessionA).patch('/profile', body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const [row] = await db.select().from(members).where(eq(members.id, memberA.id));
    expect(row!.firstName).toBe('Amna');
    expect(row!.phoneE164).toBe(memberA.phoneE164);
  });

  it('lets a member replace and view their own photo', async () => {
    const upload = await me(sessionA).upload('/profile/photo', PNG, 'me.png');
    expect(upload.status).toBe(200);
    expect(upload.body.photoUrl).toMatch(/^\/api\/v1\/me\/profile\/photo\?v=/);
    const photo = await me(sessionA).get('/profile/photo');
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');

    const fake = await me(sessionA).upload('/profile/photo', Buffer.from('GIF89a'), 'me.png');
    expect(fake.status).toBe(400);
  });
});

describe('/me is for members only', () => {
  it('returns 403 to staff', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TRAINER'] as const) {
      const staff = await signIn(app, await createUser({ role }));
      expect((await me(staff).get('/profile')).status, role).toBe(403);
    }
  });

  it('returns 404 when the login has no current member profile', async () => {
    const orphan = await createUser({ role: 'MEMBER' });
    expect((await me(await signIn(app, orphan)).get('/profile')).status).toBe(404);
  });
});

describe('/me/membership (scenario 12, memberships part)', () => {
  it("shows only the signed-in member's membership, with days left and the renewal after it", async () => {
    const today = gymToday();
    const plan = await createPlan({ name: 'Monthly Standard', priceMinor: 450_000 });
    const current = await createMembership(memberA, plan, {
      startDate: addDays(today, -25),
      endDate: addDays(today, 4),
    });
    await createMembership(memberB, plan, {
      startDate: addDays(today, -1),
      endDate: addDays(today, 28),
    });

    const overview = await me(sessionA).get('/membership');
    expect(overview.status).toBe(200);
    expect(overview.body).toEqual({
      current: {
        id: current.id,
        planName: 'Monthly Standard',
        priceMinor: 450_000,
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        startDate: current.startDate,
        endDate: current.endDate,
        accessDays: null,
        accessStartTime: null,
        accessEndTime: null,
      },
      next: null,
      daysLeft: 5,
      expiringSoon: true,
    });

    const next = await createMembership(memberA, plan, {
      status: 'PENDING',
      startDate: addDays(today, 5),
      endDate: addDays(today, 34),
    });
    const renewed = await me(sessionA).get('/membership');
    expect(renewed.body).toMatchObject({
      current: { id: current.id },
      next: { id: next.id, status: 'PENDING' },
      expiringSoon: false,
    });

    const history = await me(sessionA).get('/memberships');
    expect(history.body.data.map((m: { id: string }) => m.id)).toEqual([next.id, current.id]);
    // No staff-only fields (reasons, staff, links) and nothing of member B's.
    const body = JSON.stringify(history.body);
    expect(body).not.toContain('Reason');
    expect(body).not.toContain(memberB.id);
  });

  it('returns an empty overview to a member who has never had a membership', async () => {
    const res = await me(sessionA).get('/membership');
    expect(res.body).toEqual({ current: null, next: null, daysLeft: null, expiringSoon: false });
    expect((await me(sessionA).get('/memberships')).body).toEqual({ data: [] });
  });

  it('is closed to staff', async () => {
    const staff = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
    expect((await me(staff).get('/membership')).status).toBe(403);
  });
});
