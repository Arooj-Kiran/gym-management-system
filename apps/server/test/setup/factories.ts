import { BIOMETRIC_CONSENT, type Role } from '@gms/shared';
import { db } from '../../src/db/client';
import {
  accessDevices,
  biometricConsents,
  biometricEnrollments,
  members,
  membershipPlans,
  memberships,
  staffProfiles,
  users,
} from '../../src/db/schema';
import { hashPassword } from '../../src/lib/passwords';
import { randomToken, sha256Hex } from '../../src/lib/tokens';

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

/**
 * Inserts a membership row directly (no overlap pre-check, no events): for setting up state.
 * Use the API to test the transitions themselves.
 */
export async function createMembership(
  member: { id: string },
  plan: typeof membershipPlans.$inferSelect,
  overrides: Partial<typeof memberships.$inferInsert> & { startDate: string; endDate: string },
) {
  const status = overrides.status ?? 'ACTIVE';
  const [membership] = await db
    .insert(memberships)
    .values({
      memberId: member.id,
      planId: plan.id,
      planNameSnapshot: plan.name,
      priceMinorSnapshot: plan.priceMinor,
      status,
      activatedAt: status === 'PENDING' || status === 'CANCELLED' ? null : new Date(),
      suspendedAt: status === 'SUSPENDED' ? new Date() : null,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
      ...overrides,
    })
    .returning();
  return membership!;
}

let deviceSequence = 0;

/** A device plus its key, ready for `Authorization: Device <id>.<key>`. */
export async function createDevice(overrides: Partial<typeof accessDevices.$inferInsert> = {}) {
  deviceSequence += 1;
  const key = randomToken(32);
  const [device] = await db
    .insert(accessDevices)
    .values({
      name: `Test Scanner ${deviceSequence}`,
      location: 'Front desk',
      deviceType: 'SIMULATED',
      apiKeyHash: sha256Hex(key),
      ...overrides,
    })
    .returning();
  return { device: device!, key, authorization: `Device ${device!.id}.${key}` };
}

/** Consent in force, recorded by `recordedBy` (any staff user). */
export async function createConsent(member: { id: string }, recordedBy: { id: string }) {
  const [consent] = await db
    .insert(biometricConsents)
    .values({
      memberId: member.id,
      consentVersion: BIOMETRIC_CONSENT.version,
      consentTextSha256: sha256Hex(BIOMETRIC_CONSENT.text),
      recordedBy: recordedBy.id,
    })
    .returning();
  return consent!;
}

/** Consent + ACTIVE enrollment of `templateRef` on `device`. */
export async function enrollMember(
  member: { id: string },
  device: { id: string; deviceType: 'SIMULATED' | 'REAL' },
  templateRef: string,
  staff: { id: string },
) {
  const consent = await createConsent(member, staff);
  const [enrollment] = await db
    .insert(biometricEnrollments)
    .values({
      memberId: member.id,
      deviceId: device.id,
      provider: device.deviceType === 'SIMULATED' ? 'SIMULATED' : 'TESTVENDOR',
      templateRef,
      consentId: consent.id,
      enrolledBy: staff.id,
    })
    .returning();
  return enrollment!;
}
