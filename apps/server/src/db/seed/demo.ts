import type { CreatePlanInput } from '@gms/shared';
import { createPlanSchema } from '@gms/shared';
import { eq } from 'drizzle-orm';
import { config, databaseName } from '../../config/env';
import { recordAudit } from '../../lib/audit';
import { gymToday } from '../../lib/dates';
import type { RequestContext } from '../../lib/request-context';
import { closeDb, db } from '../client';
import { members, membershipPlans } from '../schema';
import { seedAccessDemo } from './demo-access';

/**
 * Fictional demo data (RULES: never real people). Members are flagged is_demo, which turns on
 * the DEMO DATA banner. No portal logins and no passwords are created. Safe to run repeatedly.
 */
const SEED_CTX: RequestContext = {
  actorUserId: null,
  actorRole: null,
  ip: null,
  userAgent: 'seed',
  requestId: null,
};

const PLANS: CreatePlanInput[] = [
  {
    name: 'Monthly Standard',
    planType: 'MONTHLY',
    priceMinor: 6_000_00,
    description: 'Full gym floor access during opening hours.',
    benefits: ['Gym floor and free weights', 'Locker room access', 'One fitness assessment'],
  },
  {
    name: 'Quarterly Saver',
    planType: 'QUARTERLY',
    priceMinor: 16_500_00,
    allowPartialPayment: true,
    benefits: ['Everything in Monthly Standard', 'Two group classes a week'],
  },
  {
    name: 'Six-Month Commit',
    planType: 'SIX_MONTH',
    priceMinor: 30_000_00,
    allowPartialPayment: true,
    benefits: ['Unlimited group classes', 'Monthly progress check-in'],
  },
  {
    name: 'Annual Premium',
    planType: 'ANNUAL',
    priceMinor: 54_000_00,
    allowPartialPayment: true,
    benefits: [
      'Unlimited group classes',
      'Four personal training sessions',
      'Guest pass each month',
    ],
  },
  {
    name: 'Off-Peak Weekdays (30 days)',
    planType: 'CUSTOM',
    durationValue: 30,
    durationUnit: 'DAY',
    priceMinor: 4_000_00,
    description: 'Weekday mornings only, for flexible schedules.',
    benefits: ['Gym floor access, 06:00–12:00'],
    accessDays: [1, 2, 3, 4, 5],
    accessStartTime: '06:00',
    accessEndTime: '12:00',
  },
];

/** [first, last, phone suffix, days since registration, extra] — every name is invented. */
const MEMBERS: [string, string, string, number, Partial<typeof members.$inferInsert>?][] = [
  ['Zainab', 'Rauf', '0000101', 0],
  ['Faraz', 'Haider', '0000102', 0],
  ['Mahnoor', 'Siddiqui', '0000103', 2],
  ['Daniyal', 'Chaudhry', '0000104', 3],
  ['Hira', 'Nadeem', '0000105', 5],
  ['Omer', 'Farooq', '0000106', 8, { accountStatus: 'INACTIVE' }],
  ['Sadia', 'Javed', '0000107', 11],
  ['Kamran', 'Aslam', '0000108', 14],
  ['Areeba', 'Khalid', '0000109', 17],
  ['Hassan', 'Mirza', '0000110', 21],
  ['Iqra', 'Shafiq', '0000111', 26],
  ['Taimoor', 'Baig', '0000112', 30],
  ['Noor', 'Ul Ain', '0000113', 34],
  ['Saad', 'Rehman', '0000114', 39],
  ['Maham', 'Tariq', '0000115', 45],
  ['Waleed', 'Akhtar', '0000116', 52],
  ['Rabia', 'Anwar', '0000117', 58],
  ['Junaid', 'Latif', '0000118', 64],
  ['Fatima', 'Zubair', '0000119', 71],
  ['Ahmed', 'Zubair', '0000119', 71],
  ['Mehwish', 'Kazmi', '0000121', 80],
  ['Shayan', 'Abbasi', '0000122', 92],
  ['Laiba', 'Hameed', '0000123', 105],
  ['Bilal', 'Usmani', '0000124', 118],
];

function daysAgo(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function seedDemo() {
  if (config.isProduction) throw new Error('Refusing to seed demo data in production.');

  const [existing] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.isDemo, true))
    .limit(1);
  const today = gymToday();
  if (existing) {
    console.warn('Demo members already exist; member and plan demo skipped.');
    // Databases seeded before Stage 4 still get the access demo.
    await db.transaction((tx) => seedAccessDemo(tx, SEED_CTX, today));
    return;
  }

  await db.transaction(async (tx) => {
    for (const input of PLANS) {
      const plan = createPlanSchema.parse(input);
      const [row] = await tx
        .insert(membershipPlans)
        .values(plan)
        .onConflictDoNothing()
        .returning({ id: membershipPlans.id });
      if (row) {
        await recordAudit(tx, SEED_CTX, {
          action: 'PLAN_CREATED',
          entityType: 'MEMBERSHIP_PLAN',
          entityId: row.id,
          after: plan,
          reason: 'Demo data seed',
        });
      }
    }

    const seenPhones = new Map<string, string>();
    for (const [firstName, lastName, suffix, age, extra] of MEMBERS) {
      const phone = `+92300${suffix}`;
      const [row] = await tx
        .insert(members)
        .values({
          firstName,
          lastName,
          email: `${firstName}.${lastName}`.toLowerCase().replace(/\s+/g, '') + '@example.test',
          phoneE164: phone,
          registrationDate: daysAgo(today, age),
          emergencyContactName: age % 3 === 0 ? 'Family contact (demo)' : null,
          isDemo: true,
          ...extra,
        })
        .returning({ id: members.id, memberCode: members.memberCode });
      await recordAudit(tx, SEED_CTX, {
        action: 'MEMBER_CREATED',
        entityType: 'MEMBER',
        entityId: row!.id,
        after: { memberCode: row!.memberCode, firstName, lastName },
        reason: 'Demo data seed',
      });
      const sharedWith = seenPhones.get(phone);
      if (sharedWith) {
        await recordAudit(tx, SEED_CTX, {
          action: 'MEMBER_DUPLICATE_PHONE_CONFIRMED',
          entityType: 'MEMBER',
          entityId: row!.id,
          after: { phone, matchedMemberIds: [sharedWith], sameNameMatch: false },
          reason: 'Demo data: shared family number',
        });
      }
      seenPhones.set(phone, row!.id);
    }
    await seedAccessDemo(tx, SEED_CTX, today);
  });
  console.warn(
    `Seeded ${PLANS.length} plans and ${MEMBERS.length} fictional demo members in "${databaseName(config.databaseUrl)}".`,
  );
}

if (import.meta.main) {
  try {
    await seedDemo();
  } finally {
    await closeDb();
  }
}
