/**
 * Prepares the TEST database for Playwright: reset, migrate, then create the fictional staff
 * accounts, members (with portal logins) and plan listed in apps/web/e2e/users.json. Refuses to run
 * outside NODE_ENV=test (guarded in reset-db).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { addDays, type StaffRole } from '@gms/shared';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';

interface E2eUser {
  email: string;
  firstName: string;
  lastName: string;
}
interface E2eUsers {
  password: string;
  users: Record<StaffRole, E2eUser>;
  forcedChange: E2eUser;
  member: E2eUser & { phone: string };
  accessMember: E2eUser & { phone: string };
  classMember: E2eUser & { phone: string };
  workoutMember: E2eUser & { phone: string };
  notifyMember: E2eUser & { phone: string };
  plan: { name: string; priceMinor: number };
}

const USERS_FILE = path.resolve(import.meta.dirname, '../../../web/e2e/users.json');
const fixtures = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as E2eUsers;

const { resetTestDatabase } = await import('./reset-db');
const { createMember, createMembership, createPlan, createUser } = await import('./factories');
const { gymToday } = await import('../../src/lib/dates');
const { closeDb, db } = await import('../../src/db/client');
const { trainerAssignments } = await import('../../src/db/schema');

try {
  await resetTestDatabase();
  const staff: Partial<Record<StaffRole, { id: string }>> = {};
  for (const [role, user] of Object.entries(fixtures.users) as [StaffRole, E2eUser][]) {
    staff[role] = await createUser({ ...user, role, password: fixtures.password });
  }
  await createUser({
    ...fixtures.forcedChange,
    role: 'RECEPTIONIST',
    password: fixtures.password,
    mustChangePassword: true,
  });
  // Two portal members: one for the membership flow, one for the entrance (access) flow.
  for (const { phone, ...member } of [fixtures.member, fixtures.accessMember]) {
    const login = await createUser({ ...member, role: 'MEMBER', password: fixtures.password });
    await createMember({ ...member, phoneE164: phone, userId: login.id });
  }
  const plan = await createPlan({ ...fixtures.plan, benefits: ['Gym floor access', 'Locker'] });
  // A third member, already active, for class booking: the other two have their memberships
  // cancelled by earlier specs.
  const { phone, ...classMember } = fixtures.classMember;
  const classLogin = await createUser({
    ...classMember,
    role: 'MEMBER',
    password: fixtures.password,
  });
  const booker = await createMember({ ...classMember, phoneE164: phone, userId: classLogin.id });
  const today = gymToday();
  await createMembership(booker, plan, { startDate: today, endDate: addDays(today, 29) });

  // A member assigned to the E2E trainer, for the workout plan flow (workouts.spec.ts).
  const { phone: workoutPhone, ...workoutMember } = fixtures.workoutMember;
  const workoutLogin = await createUser({
    ...workoutMember,
    role: 'MEMBER',
    password: fixtures.password,
  });
  const trainee = await createMember({
    ...workoutMember,
    phoneE164: workoutPhone,
    userId: workoutLogin.id,
  });
  await db
    .insert(trainerAssignments)
    .values({ trainerId: staff.TRAINER!.id, memberId: trainee.id, startDate: today });

  // An active member whose membership the notification flow suspends (notifications.spec.ts).
  const { phone: notifyPhone, ...notifyMember } = fixtures.notifyMember;
  const notifyLogin = await createUser({
    ...notifyMember,
    role: 'MEMBER',
    password: fixtures.password,
  });
  const notified = await createMember({
    ...notifyMember,
    phoneE164: notifyPhone,
    userId: notifyLogin.id,
  });
  await createMembership(notified, plan, { startDate: today, endDate: addDays(today, 29) });
  console.warn('E2E database prepared.');
} finally {
  await closeDb();
}
