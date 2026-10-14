import type { Role } from '@gms/shared';
import { db } from '../../src/db/client';
import { staffProfiles, users } from '../../src/db/schema';
import { hashPassword } from '../../src/lib/passwords';

/** Fictional test password; only ever used against the throwaway test database. */
export const TEST_PASSWORD = 'Test-password-2026!';

let sequence = 0;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
}

let cachedHash: Promise<string> | undefined;

export async function createUser(
  overrides: Partial<{
    role: Role;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    mustChangePassword: boolean;
  }> = {},
): Promise<TestUser> {
  sequence += 1;
  const role = overrides.role ?? 'ADMIN';
  const password = overrides.password ?? TEST_PASSWORD;
  const email = overrides.email ?? `${role.toLowerCase()}.${sequence}@example.test`;
  const passwordHash =
    password === TEST_PASSWORD
      ? await (cachedHash ??= hashPassword(TEST_PASSWORD))
      : await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      role,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? `${role[0]}${role.slice(1).toLowerCase()} ${sequence}`,
      isActive: overrides.isActive ?? true,
      mustChangePassword: overrides.mustChangePassword ?? false,
    })
    .returning({ id: users.id });
  if (role !== 'MEMBER') await db.insert(staffProfiles).values({ userId: user!.id });
  return { id: user!.id, email, password, role };
}
