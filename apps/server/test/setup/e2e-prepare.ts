/**
 * Prepares the TEST database for Playwright: reset, migrate, then create fictional staff accounts
 * listed in apps/web/e2e/users.json. Refuses to run outside NODE_ENV=test (guarded in reset-db).
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
}

const USERS_FILE = path.resolve(import.meta.dirname, '../../../web/e2e/users.json');
const fixtures = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as E2eUsers;

const { resetTestDatabase } = await import('./reset-db');
const { createUser } = await import('./factories');
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
  console.warn('E2E database prepared.');
} finally {
  await closeDb();
}
