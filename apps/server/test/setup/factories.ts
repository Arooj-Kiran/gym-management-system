import type { Role } from '@gms/shared';
import { db } from '../../src/db/client';
import { members, membershipPlans, staffProfiles, users } from '../../src/db/schema';
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

let memberSequence = 0;

/** Inserts a member directly (no duplicate checks); fictional data only. */
export async function createMember(overrides: Partial<typeof members.$inferInsert> = {}) {
  memberSequence += 1;
  const [member] = await db
    .insert(members)
    .values({
      firstName: 'Test',
      lastName: `Member ${memberSequence}`,
      phoneE164: `+92301${String(5_000_000 + memberSequence).padStart(7, '0')}`,
      registrationDate: '2026-09-01',
      ...overrides,
    })
    .returning();
  return member!;
}

let planSequence = 0;

export async function createPlan(overrides: Partial<typeof membershipPlans.$inferInsert> = {}) {
  planSequence += 1;
  const [plan] = await db
    .insert(membershipPlans)
    .values({
      name: `Test Plan ${planSequence}`,
      planType: 'MONTHLY',
      durationValue: 1,
      durationUnit: 'MONTH',
      priceMinor: 500_000,
      ...overrides,
    })
    .returning();
  return plan!;
}
