import {
  ERROR_CODES,
  SETTINGS_KEYS,
  type GymSettingsDto,
  type updateSettingsSchema,
} from '@gms/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { config } from '../../config/env';
import { db, type DbExecutor } from '../../db/client';
import { gymSettings } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';

type SettingsRow = typeof gymSettings.$inferSelect;
type SettingsUpdate = z.output<typeof updateSettingsSchema>;
type SettingsValues = Pick<SettingsRow, (typeof SETTINGS_KEYS)[number]>;

async function loadRow(executor: DbExecutor, forUpdate = false): Promise<SettingsRow> {
  const query = executor.select().from(gymSettings).limit(1);
  const [row] = forUpdate ? await query.for('update') : await query;
  // The migration inserts the single row; its absence means the database was not migrated.
  if (!row) {
    throw new AppError(503, ERROR_CODES.SERVICE_UNAVAILABLE, 'Gym settings are not initialised.');
  }
  return row;
}

function toDto(row: SettingsRow): GymSettingsDto {
  return {
    gymName: row.gymName,
    expiryReminderDays: row.expiryReminderDays,
    paymentDueReminderDays: row.paymentDueReminderDays,
    invoiceDueDays: row.invoiceDueDays,
    biometricRetentionDays: row.biometricRetentionDays,
    classBookingCutoffMinutes: row.classBookingCutoffMinutes,
    timezone: config.gymTimezone,
    currencyCode: config.currencyCode,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSettings(): Promise<GymSettingsDto> {
  return toDto(await loadRow(db));
}

export async function getGymName(): Promise<string> {
  return (await loadRow(db)).gymName;
}

/** Admin-only (settings:manage). Every effective change writes SETTINGS_CHANGED with old and new values. */
export async function updateSettings(
  input: SettingsUpdate,
  ctx: RequestContext,
): Promise<GymSettingsDto> {
  return db.transaction(async (tx) => {
    const row = await loadRow(tx, true);
    const current: SettingsValues = row;
    const requested: Partial<SettingsValues> = {};
    for (const key of SETTINGS_KEYS) {
      if (input[key] !== undefined) Object.assign(requested, { [key]: input[key] });
    }
    const diff = diffFields(current, requested);
    if (!diff.changed) return toDto(row);

    const [updated] = await tx
      .update(gymSettings)
      .set(diff.after as Partial<SettingsValues>)
      .where(eq(gymSettings.id, row.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: 'SETTINGS_CHANGED',
      entityType: 'GYM_SETTINGS',
      entityId: row.id,
      before: diff.before,
      after: diff.after,
      reason: input.reason ?? null,
    });
    return toDto(updated!);
  });
}
