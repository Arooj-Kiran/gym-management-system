import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config/env';
import { closeDb, db } from '../../src/db/client';
import { auditLogs } from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser } from '../setup/factories';

const app = testApp();
let admin: Session;

beforeEach(async () => {
  await resetTables();
  admin = await signIn(
    app,
    await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' }),
  );
});
afterAll(closeDb);

const updateSettings = (body: object) =>
  admin.agent.patch('/api/v1/settings').set('X-CSRF-Token', admin.csrf).send(body);

describe('gym settings', () => {
  it('returns defaults with the configured timezone and currency', async () => {
    const res = await admin.agent.get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      gymName: 'My Gym',
      expiryReminderDays: expect.any(Number),
      timezone: 'Asia/Karachi',
      currencyCode: 'PKR',
    });
  });

  it('updates settings and audits only the changed values with the reason', async () => {
    const before = (await admin.agent.get('/api/v1/settings')).body;
    const res = await updateSettings({
      gymName: 'Iron Works Gym',
      expiryReminderDays: before.expiryReminderDays,
      invoiceDueDays: 14,
      reason: 'Opening configuration',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gymName: 'Iron Works Gym', invoiceDueDays: 14 });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, 'SETTINGS_CHANGED'));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.before).toEqual({ gymName: 'My Gym', invoiceDueDays: before.invoiceDueDays });
    expect(rows[0]!.after).toEqual({ gymName: 'Iron Works Gym', invoiceDueDays: 14 });
    expect(rows[0]!.reason).toBe('Opening configuration');

    expect((await admin.agent.get('/api/v1/auth/me')).body.gym.name).toBe('Iron Works Gym');
  });

  it('skips the audit when nothing changed', async () => {
    await updateSettings({ gymName: 'My Gym' }).expect(200);
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.action, 'SETTINGS_CHANGED')),
    ).toHaveLength(0);
  });

  it('validates ranges, empty updates and unknown keys', async () => {
    expect((await updateSettings({ expiryReminderDays: 0 })).status).toBe(400);
    expect((await updateSettings({ biometricRetentionDays: 366 })).status).toBe(400);
    expect((await updateSettings({ invoiceDueDays: 2.5 })).status).toBe(400);
    expect((await updateSettings({ gymName: '   ' })).status).toBe(400);
    expect((await updateSettings({ reason: 'only a reason' })).status).toBe(400);
    expect((await updateSettings({ currencyCode: 'USD' })).status).toBe(400);
  });
});

describe('audit log', () => {
  it('is append-only: UPDATE and DELETE are rejected by the database', async () => {
    const [row] = await db.select({ id: auditLogs.id }).from(auditLogs).limit(1);
    expect(row).toBeDefined(); // the sign-in above wrote LOGIN_SUCCEEDED
    await expect(
      db.execute(sql`update audit_logs set reason = 'tampered' where id = ${row!.id}`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_logs where id = ${row!.id}`)).rejects.toThrow();
    const [still] = await db.select().from(auditLogs).where(eq(auditLogs.id, row!.id));
    expect(still!.reason).toBeNull();
  });

  it('is viewable with actor details and filters', async () => {
    await updateSettings({ gymName: 'Iron Works Gym', reason: 'Rebrand' }).expect(200);

    const all = await admin.agent.get('/api/v1/audit-logs');
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    const newestFirst = all.body.data[0];
    expect(newestFirst.action).toBe('SETTINGS_CHANGED');
    expect(newestFirst.actor).toMatchObject({ name: 'Ayesha Malik' });
    expect(newestFirst.actorRole).toBe('ADMIN');
    expect(newestFirst.requestId).toBeTruthy();

    const filtered = await admin.agent.get('/api/v1/audit-logs?action=LOGIN_SUCCEEDED');
    expect(
      filtered.body.data.every((r: { action: string }) => r.action === 'LOGIN_SUCCEEDED'),
    ).toBe(true);

    const search = await admin.agent.get('/api/v1/audit-logs?q=rebrand');
    expect(search.body.data).toHaveLength(1);

    // Date filters are gym-local calendar days.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.gymTimezone }).format(
      new Date(),
    );
    const past = await admin.agent.get('/api/v1/audit-logs?from=2020-01-01&to=2020-01-02');
    expect(past.body.total).toBe(0);
    const recent = await admin.agent.get(`/api/v1/audit-logs?from=2020-01-01&to=${today}`);
    expect(recent.body.total).toBeGreaterThanOrEqual(1);

    const badRange = await admin.agent.get('/api/v1/audit-logs?from=2026-02-01&to=2026-01-01');
    expect(badRange.status).toBe(400);
  });

  it('never stores secrets in audit rows', async () => {
    const rows = await db.select().from(auditLogs);
    expect(JSON.stringify(rows)).not.toMatch(/argon2|Test-password/);
  });
});
