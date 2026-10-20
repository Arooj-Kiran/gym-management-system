import { addDays, BIOMETRIC_CONSENT, computeEndDate, type MembershipStatus } from '@gms/shared';
import { and, asc, eq } from 'drizzle-orm';
import { recordAudit } from '../../lib/audit';
import { randomToken, sha256Hex } from '../../lib/tokens';
import type { RequestContext } from '../../lib/request-context';
import type { DbExecutor } from '../client';
import {
  accessDevices,
  biometricConsents,
  biometricEnrollments,
  members,
  membershipEvents,
  membershipPlans,
  memberships,
  users,
} from '../schema';

export const DEMO_DEVICE_NAME = 'Front entrance (simulated)';

/**
 * Stage 4 demo: one SIMULATED scanner and four fictional members enrolled as SIM-0001…0004,
 * one per outcome the kiosk can show. The device key is thrown away (rotate it on the Devices
 * screen to run the agent). Consents are recorded as the existing Admin; no users are created.
 */
const ACCESS_MEMBERS: {
  firstName: string;
  lastName: string;
  phone: string;
  ref: string;
  status: Extract<MembershipStatus, 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED'>;
  startedDaysAgo: number;
}[] = [
  {
    firstName: 'Ayesha',
    lastName: 'Kamal',
    phone: '+923000000131',
    ref: 'SIM-0001',
    status: 'ACTIVE',
    startedDaysAgo: 10,
  },
  {
    firstName: 'Usman',
    lastName: 'Qureshi',
    phone: '+923000000132',
    ref: 'SIM-0002',
    status: 'EXPIRED',
    startedDaysAgo: 50,
  },
  {
    firstName: 'Sana',
    lastName: 'Mir',
    phone: '+923000000133',
    ref: 'SIM-0003',
    status: 'CANCELLED',
    startedDaysAgo: 6,
  },
  {
    firstName: 'Zeeshan',
    lastName: 'Ali',
    phone: '+923000000134',
    ref: 'SIM-0004',
    status: 'SUSPENDED',
    startedDaysAgo: 12,
  },
];

export async function seedAccessDemo(tx: DbExecutor, ctx: RequestContext, today: string) {
  const [existing] = await tx
    .select({ id: accessDevices.id })
    .from(accessDevices)
    .where(eq(accessDevices.name, DEMO_DEVICE_NAME))
    .limit(1);
  if (existing) {
    console.warn('The simulated demo device already exists; access demo skipped.');
    return;
  }
  const [admin] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!admin) {
    console.warn('No Admin account yet (run db:seed first); access demo skipped.');
    return;
  }
  const [plan] = await tx
    .select()
    .from(membershipPlans)
    .where(eq(membershipPlans.name, 'Monthly Standard'))
    .limit(1);
  if (!plan) {
    console.warn('The Monthly Standard demo plan is missing; access demo skipped.');
    return;
  }

  const [device] = await tx
    .insert(accessDevices)
    .values({
      name: DEMO_DEVICE_NAME,
      location: 'Reception',
      deviceType: 'SIMULATED',
      apiKeyHash: sha256Hex(randomToken(32)),
      createdBy: admin.id,
    })
    .returning();
  await recordAudit(tx, ctx, {
    action: 'DEVICE_CREATED',
    entityType: 'ACCESS_DEVICE',
    entityId: device!.id,
    after: { name: device!.name, deviceType: 'SIMULATED' },
    reason: 'Demo data seed',
  });

  const now = new Date();
  for (const entry of ACCESS_MEMBERS) {
    const [member] = await tx
      .insert(members)
      .values({
        firstName: entry.firstName,
        lastName: entry.lastName,
        email: `${entry.firstName}.${entry.lastName}`.toLowerCase() + '@example.test',
        phoneE164: entry.phone,
        registrationDate: addDays(today, -entry.startedDaysAgo - 1),
        isDemo: true,
      })
      .returning({ id: members.id, memberCode: members.memberCode });
    await recordAudit(tx, ctx, {
      action: 'MEMBER_CREATED',
      entityType: 'MEMBER',
      entityId: member!.id,
      after: {
        memberCode: member!.memberCode,
        firstName: entry.firstName,
        lastName: entry.lastName,
      },
      reason: 'Demo data seed',
    });

    const startDate = addDays(today, -entry.startedDaysAgo);
    const [membership] = await tx
      .insert(memberships)
      .values({
        memberId: member!.id,
        planId: plan.id,
        planNameSnapshot: plan.name,
        priceMinorSnapshot: plan.priceMinor,
        accessDaysSnapshot: plan.accessDays,
        accessStartTimeSnapshot: plan.accessStartTime,
        accessEndTimeSnapshot: plan.accessEndTime,
        startDate,
        endDate: computeEndDate(startDate, 1, 'MONTH'),
        status: entry.status,
        activatedAt: entry.status === 'CANCELLED' ? null : now,
        suspendedAt: entry.status === 'SUSPENDED' ? now : null,
        suspensionReason: entry.status === 'SUSPENDED' ? 'Demo: travelling for work' : null,
        cancelledAt: entry.status === 'CANCELLED' ? now : null,
        cancellationReason: entry.status === 'CANCELLED' ? 'Demo: moved to another city' : null,
      })
      .returning({ id: memberships.id });
    const events: {
      eventType: 'CREATED' | 'ACTIVATED' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
      from: MembershipStatus | null;
      to: MembershipStatus;
    }[] = [{ eventType: 'CREATED', from: null, to: 'PENDING' }];
    if (entry.status === 'CANCELLED') {
      events.push({ eventType: 'CANCELLED', from: 'PENDING', to: 'CANCELLED' });
    } else {
      events.push({ eventType: 'ACTIVATED', from: 'PENDING', to: 'ACTIVE' });
      if (entry.status !== 'ACTIVE') {
        events.push({ eventType: entry.status, from: 'ACTIVE', to: entry.status });
      }
    }
    await tx.insert(membershipEvents).values(
      events.map((event) => ({
        membershipId: membership!.id,
        memberId: member!.id,
        eventType: event.eventType,
        fromStatus: event.from,
        toStatus: event.to,
        reason: 'Demo data seed',
      })),
    );

    const [consent] = await tx
      .insert(biometricConsents)
      .values({
        memberId: member!.id,
        consentVersion: BIOMETRIC_CONSENT.version,
        consentTextSha256: sha256Hex(BIOMETRIC_CONSENT.text),
        recordedBy: admin.id,
      })
      .returning({ id: biometricConsents.id });
    const [enrollment] = await tx
      .insert(biometricEnrollments)
      .values({
        memberId: member!.id,
        deviceId: device!.id,
        provider: 'SIMULATED',
        templateRef: entry.ref,
        consentId: consent!.id,
        enrolledBy: admin.id,
      })
      .returning({ id: biometricEnrollments.id });
    await recordAudit(tx, ctx, {
      action: 'BIOMETRIC_ENROLLED',
      entityType: 'BIOMETRIC_ENROLLMENT',
      entityId: enrollment!.id,
      after: { memberId: member!.id, deviceId: device!.id, simulated: true },
      reason: 'Demo data seed',
    });
  }
  console.warn(
    `Seeded the simulated device "${DEMO_DEVICE_NAME}" and ${ACCESS_MEMBERS.length} enrolled demo members (SIM-0001…SIM-000${ACCESS_MEMBERS.length}).`,
  );
}
