import { emailSchema, passwordSchema } from '@gms/shared';
import { eq } from 'drizzle-orm';
import { config, databaseName } from '../../config/env';
import { recordAudit } from '../../lib/audit';
import { hashPassword } from '../../lib/passwords';
import { closeDb, db } from '../client';
import { staffProfiles, users } from '../schema';

/** Creates the first Admin (must change password at first sign-in). Safe to run repeatedly. */
export async function seedBase() {
  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'))
    .limit(1);
  if (existingAdmin) {
    console.warn('An Admin account already exists; nothing to seed.');
    return;
  }

  const email = emailSchema.safeParse(process.env.SEED_ADMIN_EMAIL);
  const password = passwordSchema.safeParse(process.env.SEED_ADMIN_PASSWORD);
  if (!email.success) throw new Error('SEED_ADMIN_EMAIL is missing or not a valid email.');
  if (!password.success || password.data.includes('CHANGE_ME')) {
    throw new Error(
      'SEED_ADMIN_PASSWORD must be set in .env to a real password of at least 12 characters.',
    );
  }

  const passwordHash = await hashPassword(password.data);
  await db.transaction(async (tx) => {
    const [admin] = await tx
      .insert(users)
      .values({
        email: email.data,
        passwordHash,
        role: 'ADMIN',
        firstName: 'Gym',
        lastName: 'Administrator',
        mustChangePassword: true,
      })
      .returning({ id: users.id });
    await tx.insert(staffProfiles).values({ userId: admin!.id, jobTitle: 'Administrator' });
    await recordAudit(
      tx,
      { actorUserId: null, actorRole: null, ip: null, userAgent: 'seed', requestId: null },
      {
        action: 'STAFF_CREATED',
        entityType: 'USER',
        entityId: admin!.id,
        after: { email: email.data, role: 'ADMIN' },
        reason: 'Initial Admin created by seed',
      },
    );
  });
  console.warn(
    `Created the first Admin (${email.data}) in "${databaseName(config.databaseUrl)}". Change the password at first sign-in.`,
  );
}

if (import.meta.main) {
  try {
    await seedBase();
  } finally {
    await closeDb();
  }
}
