import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { seedDemo } from '../../src/db/seed/demo';
import {
  accessDevices,
  auditLogs,
  biometricConsents,
  biometricEnrollments,
  members,
  membershipPlans,
  users,
} from '../../src/db/schema';
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
    // 24 Stage 2–3 members plus the 4 enrolled Stage 4 access demo members.
    expect(seeded).toHaveLength(28);
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


    // Stage 4: one SIMULATED device, SIM-0001…0004 enrolled with consent recorded by the Admin.
    const devices = await db.select().from(accessDevices);
    expect(devices).toHaveLength(1);
    expect(devices[0]!.deviceType).toBe('SIMULATED');
    const enrollments = await db.select().from(biometricEnrollments);
    expect(enrollments.map((e) => e.templateRef).sort()).toEqual([
      'SIM-0001',
      'SIM-0002',
      'SIM-0003',
      'SIM-0004',
    ]);
    expect(enrollments.every((e) => e.provider === 'SIMULATED' && e.enrolledBy === admin.id)).toBe(
      true,
    );
    expect(await db.select().from(biometricConsents)).toHaveLength(4);
    expect(await db.select().from(users)).toHaveLength(1);

    await seedDemo();
    expect(await db.select().from(members)).toHaveLength(28);
    expect(await db.select().from(accessDevices)).toHaveLength(1);

    const after = await before.agent.get('/api/v1/auth/me');
    expect(after.body.gym.hasDemoData).toBe(true);
  });
});
