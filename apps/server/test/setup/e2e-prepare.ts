/**
 * Prepares the TEST database for Playwright: reset, migrate, then create the fictional staff
 * accounts, member (with portal login) and plan listed in apps/web/e2e/users.json. Refuses to run
 * outside NODE_ENV=test (guarded in reset-db).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { StaffRole } from '@gms/shared';

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
  plan: { name: string; priceMinor: number };
}

const USERS_FILE = path.resolve(import.meta.dirname, '../../../web/e2e/users.json');
const fixtures = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as E2eUsers;

const { resetTestDatabase } = await import('./reset-db');
const { createMember, createPlan, createUser } = await import('./factories');
const { closeDb } = await import('../../src/db/client');

try {
  await resetTestDatabase();
  for (const [role, user] of Object.entries(fixtures.users) as [StaffRole, E2eUser][]) {
    await createUser({ ...user, role, password: fixtures.password });
  }
  await createUser({
    ...fixtures.forcedChange,
    role: 'RECEPTIONIST',
    password: fixtures.password,
    mustChangePassword: true,
  });
  const { phone, ...member } = fixtures.member;
  const login = await createUser({ ...member, role: 'MEMBER', password: fixtures.password });
  await createMember({ ...member, phoneE164: phone, userId: login.id });
  await createPlan({ ...fixtures.plan, benefits: ['Gym floor access', 'Locker'] });
  console.warn('E2E database prepared.');
} finally {
  await closeDb();
}
