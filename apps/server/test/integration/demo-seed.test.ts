import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import { seedDemo } from '../../src/db/seed/demo';
import { DEMO_TRAINER_EMAILS } from '../../src/db/seed/demo-schedule';
import {
  accessDevices,
  appointments,
  auditLogs,
  biometricConsents,
  biometricEnrollments,
  classBookings,
  classSessions,
  fitnessClasses,
  invoices,
  members,
  membershipPlans,
  payments,
  trainerAssignments,
  trainerProfiles,
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

    // Stage 6: two demo trainers (the only users added), with no usable password.
    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(3);
    const trainers = allUsers.filter((user) => user.role === 'TRAINER');
    expect(trainers.map((t) => t.email).sort()).toEqual([...DEMO_TRAINER_EMAILS].sort());
    expect(trainers.every((t) => t.isDemo && !t.passwordHash.startsWith('$argon2'))).toBe(true);
    for (const email of DEMO_TRAINER_EMAILS) {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password: 'any-guess-at-all-1' });
      expect(login.status).toBe(401);
    }
    expect(await db.select().from(trainerProfiles)).toHaveLength(2);
    expect(await db.select().from(fitnessClasses)).toHaveLength(3);
    const sessions = await db.select().from(classSessions);
    // Two weeks: 6 strength, 6 spin, 2 mobility, plus one past strength class.
    expect(sessions).toHaveLength(15);
    const bookings = await db.select().from(classBookings);
    expect(bookings.map((b) => b.status).sort()).toEqual(['ATTENDED', 'BOOKED', 'BOOKED']);
    expect(await db.select().from(trainerAssignments)).toHaveLength(3);
    expect(await db.select().from(appointments)).toHaveLength(1);

    // Stage 5: counter payments only (no ONLINE), one paid, one overdue, one part-paid charge.
    const demoInvoices = await db.select().from(invoices);
    expect(demoInvoices.map((invoice) => invoice.status).sort()).toEqual([
      'OVERDUE',
      'PAID',
      'PARTIALLY_PAID',
    ]);
    const demoPayments = await db.select().from(payments);
    expect(demoPayments).toHaveLength(2);
    expect(demoPayments.every((payment) => payment.method !== 'ONLINE')).toBe(true);

    await seedDemo();
    expect(await db.select().from(invoices)).toHaveLength(3);
    expect(await db.select().from(payments)).toHaveLength(2);
    expect(await db.select().from(members)).toHaveLength(28);
    expect(await db.select().from(accessDevices)).toHaveLength(1);
    expect(await db.select().from(users)).toHaveLength(3);
    expect(await db.select().from(classSessions)).toHaveLength(15);
    expect(await db.select().from(appointments)).toHaveLength(1);

    const after = await before.agent.get('/api/v1/auth/me');
    expect(after.body.gym.hasDemoData).toBe(true);
  });
});
