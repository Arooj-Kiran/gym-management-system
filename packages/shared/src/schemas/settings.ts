import { z } from 'zod';
import { reasonSchema } from './common';

const wholeNumber = (min: number, max: number) =>
  z.coerce
    .number({ error: 'Enter a number' })
    .int('Use a whole number')
    .min(min, `Minimum is ${min}`)
    .max(max, `Maximum is ${max}`);

export const SETTINGS_LIMITS = {
  expiryReminderDays: [1, 60],
  paymentDueReminderDays: [0, 30],
  invoiceDueDays: [0, 60],
  biometricRetentionDays: [1, 365],
  classBookingCutoffMinutes: [0, 1440],
} as const;

const settingsFields = {
  gymName: z
    .string({ error: 'Gym name is required' })
    .trim()
    .min(1, 'Gym name is required')
    .max(120, 'Must be 120 characters or fewer'),
  expiryReminderDays: wholeNumber(...SETTINGS_LIMITS.expiryReminderDays),
  paymentDueReminderDays: wholeNumber(...SETTINGS_LIMITS.paymentDueReminderDays),
  invoiceDueDays: wholeNumber(...SETTINGS_LIMITS.invoiceDueDays),
  biometricRetentionDays: wholeNumber(...SETTINGS_LIMITS.biometricRetentionDays),
  classBookingCutoffMinutes: wholeNumber(...SETTINGS_LIMITS.classBookingCutoffMinutes),
};

export const SETTINGS_KEYS = Object.keys(settingsFields) as (keyof typeof settingsFields)[];

export const updateSettingsSchema = z
  .strictObject({ ...settingsFields, reason: reasonSchema.optional() })
  .partial()
  .refine(
    (value) => SETTINGS_KEYS.some((key) => value[key] !== undefined),
    'Change at least one setting',
  );
export type UpdateSettingsInput = z.input<typeof updateSettingsSchema>;

export interface GymSettingsDto {
  gymName: string;
  expiryReminderDays: number;
  paymentDueReminderDays: number;
  invoiceDueDays: number;
  biometricRetentionDays: number;
  classBookingCutoffMinutes: number;
  timezone: string;
  currencyCode: string;
  updatedAt: string;
}
