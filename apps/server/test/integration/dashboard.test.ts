import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { gymToday } from '../../src/lib/dates';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createMember, createUser, type TestUser } from '../setup/factories';

const app = testApp();

let admin: TestUser;
let session: Session;

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
});
afterAll(closeDb);

const get = (s: Session, path: string) => s.agent.get(`/api/v1/dashboard${path}`);

describe('dashboard member cards (scenario 16, Stage 2 cards)', () => {
  it('matches raw SQL counts: current members and registrations today in gym time', async () => {
    const today = gymToday();
    await createMember({ registrationDate: today });
    await createMember({ registrationDate: today });
    await createMember({ registrationDate: '2026-01-15' });
    await createMember({ registrationDate: today, archivedAt: new Date(), archivedBy: admin.id });

    const res = await get(session, '/summary');
    expect(res.status).toBe(200);
    // Hand-computed: 3 current members, 2 of them registered today (the archived one is excluded).
    expect(res.body).toEqual({ members: { total: 3, registeredToday: 2 } });

    const raw = await db.execute<{ total: number; today: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where registration_date = ${today})::int as today
      from members where archived_at is null
    `);
    expect(raw.rows[0]).toEqual({ total: 3, today: 2 });
  });

  it('shows recent member activity without any personal field values', async () => {
    const created = await session.agent
      .post('/api/v1/members')
      .set('X-CSRF-Token', session.csrf)
      .send({
        firstName: 'Sana',
        lastName: 'Iqbal',
        email: 'sana.iqbal@example.test',
        phone: '0300 7654321',
      })
      .expect(201);

    const res = await get(session, '/activity');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        action: 'MEMBER_CREATED',
        createdAt: expect.any(String),
        actorName: 'Ayesha Malik',
        member: {
          id: created.body.id,
          memberCode: created.body.memberCode,
          firstName: 'Sana',
          lastName: 'Iqbal',
        },
      },
    ]);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('example.test');
    expect(body).not.toContain('7654321');
  });

  it('caps activity at the 8 newest entries', async () => {
    for (let i = 0; i < 10; i += 1) {
      await session.agent
        .post('/api/v1/members')
        .set('X-CSRF-Token', session.csrf)
        .send({ firstName: 'Bulk', lastName: `Member ${i}`, phone: `0300 12300${10 + i}` })
        .expect(201);
    }
    const res = await get(session, '/activity');
    expect(res.body).toHaveLength(8);
    expect(res.body[0].member.lastName).toBe('Member 9');
  });

  it('gives the member cards to Admin, Manager and Receptionist, and not to a Trainer', async () => {
    await createMember();
    for (const role of ['MANAGER', 'RECEPTIONIST'] as const) {
      const staff = await signIn(app, await createUser({ role }));
      expect((await get(staff, '/summary')).body.members.total, role).toBe(1);
    }
    const trainer = await signIn(app, await createUser({ role: 'TRAINER' }));
    expect((await get(trainer, '/summary')).body).toEqual({ members: null });
    expect((await get(trainer, '/activity')).body).toEqual([]);

    const member = await signIn(app, await createUser({ role: 'MEMBER' }));
    expect((await get(member, '/summary')).status).toBe(403);
  });
});
