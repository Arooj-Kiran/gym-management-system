import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';

/** Phone numbers without a country prefix are read as Pakistani numbers (single-gym deployment, D5/D6). */
export const DEFAULT_PHONE_COUNTRY = 'PK';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email is too long')
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const nameSchema = z
  .string({ error: 'Required' })
  .trim()
  .min(1, 'Required')
  .max(80, 'Must be 80 characters or fewer');

export const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

const INVALID_PHONE = 'Enter a valid phone number, e.g. +92 300 1234567';

/** Normalize to E.164 so the same number always compares equal (duplicate detection). */
export function normalizePhone(value: string): string | null {
  const parsed = parsePhoneNumberFromString(value, DEFAULT_PHONE_COUNTRY);
  return parsed?.isValid() ? parsed.number : null;
}

/** Optional phone: empty → null, otherwise normalized to E.164. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(32, 'Phone number is too long')
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: INVALID_PHONE });
      return z.NEVER;
    }
    return normalized;
  });

/** Required phone, normalized to E.164. */
export const phoneSchema = z
  .string({ error: 'Phone number is required' })
  .trim()
  .min(1, 'Phone number is required')
  .max(32, 'Phone number is too long')
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: INVALID_PHONE });
      return z.NEVER;
    }
    return normalized;
  });

/** Optional email: empty → null, otherwise validated and lower-cased. */
export const optionalEmailSchema = z
  .union([z.literal(''), emailSchema])
  .nullish()
  .transform((value) => value || null);

export const optionalTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .nullish()
    .transform((value) => value || null);

export const isoDateSchema = z.iso.date({ error: 'Use the format YYYY-MM-DD' });

export const optionalIsoDateSchema = z
  .union([z.literal(''), isoDateSchema])
  .nullish()
  .transform((value) => value || null);

/** A moment in time with an explicit offset (the server stores UTC). */
export const isoDateTimeSchema = z.iso.datetime({
  offset: true,
  error: 'Enter a valid date and time',
});

/** 24-hour wall-clock time in gym time, e.g. 06:30. */
export const timeOfDaySchema = z
  .string({ error: 'Enter a time' })
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 06:00');

export const reasonSchema = z.string().trim().max(500, 'Must be 500 characters or fewer');

export const requiredReasonSchema = reasonSchema.min(
  3,
  'Give a short reason (at least 3 characters)',
);

/** Query-string booleans arrive as text. */
export const queryBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const idParamSchema = z.strictObject({ id: z.uuid({ error: 'Invalid id' }) });

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const listQueryBase = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  order: z.enum(SORT_ORDERS).optional(),
};

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}
