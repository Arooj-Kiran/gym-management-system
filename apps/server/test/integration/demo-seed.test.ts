import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { seedDemo } from '../../src/db/seed/demo';
import { auditLogs, members, membershipPlans, users } from '../../src/db/schema';
import { signIn, testApp } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser } from '../setup/factories';

const app = testApp();

beforeEach(resetTables);
afterAll(closeDb);

describe('demo seed', () => {
  it('adds fictional, flagged data once, with no portal logins, and turns on the banner flag', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const before = await signIn(app, admin);
    expect(before.me.gym.hasDemoData).toBe(false);

    await seedDemo();
    const seeded = await db.select().from(members);
    expect(seeded).toHaveLength(24);
    expect(seeded.every((member) => member.isDemo)).toBe(true);
    expect(seeded.every((member) => member.email?.endsWith('@example.test'))).toBe(true);
    expect(seeded.every((member) => member.userId === null)).toBe(true);
    expect(await db.select().from(membershipPlans)).toHaveLength(5);
    expect(await db.select().from(users).where(eq(users.role, 'MEMBER'))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'MEMBER_DUPLICATE_PHONE_CONFIRMED')),
    ).toHaveLength(1);

    await seedDemo();
    expect(await db.select().from(members)).toHaveLength(24);

    const after = await before.agent.get('/api/v1/auth/me');
    expect(after.body.gym.hasDemoData).toBe(true);
  });
});
