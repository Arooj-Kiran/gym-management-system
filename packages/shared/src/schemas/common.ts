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

/** Optional phone: empty → null, otherwise normalized to E.164. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(32, 'Phone number is too long')
  .nullish()
  .transform((value, ctx) => {
    if (!value) return null;
    const parsed = parsePhoneNumberFromString(value, DEFAULT_PHONE_COUNTRY);
    if (!parsed?.isValid()) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. +92 300 1234567' });
      return z.NEVER;
    }
    return parsed.number;
  });

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

export const reasonSchema = z.string().trim().max(500, 'Must be 500 characters or fewer');

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
