import { z } from 'zod';
import type { ShiftStatus } from '../enums';
import type { StaffRole } from '../roles';
import { isoDateTimeSchema, optionalTextSchema, queryBooleanSchema } from './common';
import { checkDateRange, dateRangeShape } from './trainers';

export const SHIFT_LIMITS = { maxHours: 16, roleNoteMax: 120 } as const;

const HOUR_MS = 3_600_000;

function checkShiftSpan(input: { startsAt?: string; endsAt?: string }, ctx: z.RefinementCtx) {
  if (!input.startsAt || !input.endsAt) return;
  const span = Date.parse(input.endsAt) - Date.parse(input.startsAt);
  if (span <= 0) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must be after the start' });
  } else if (span > SHIFT_LIMITS.maxHours * HOUR_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: `A shift can last at most ${SHIFT_LIMITS.maxHours} hours`,
    });
  }
}

export const createShiftSchema = z
  .strictObject({
    userId: z.uuid({ error: 'Choose a staff member' }),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    roleNote: optionalTextSchema(SHIFT_LIMITS.roleNoteMax),
  })
  .superRefine(checkShiftSpan);
export type CreateShiftInput = z.input<typeof createShiftSchema>;

/** Times are re-checked against the merged row by the server. */
export const updateShiftSchema = z
  .strictObject({
    startsAt: isoDateTimeSchema.optional(),
    endsAt: isoDateTimeSchema.optional(),
    roleNote: optionalTextSchema(SHIFT_LIMITS.roleNoteMax),
  })
  .superRefine(checkShiftSpan);
export type UpdateShiftInput = z.input<typeof updateShiftSchema>;

export const shiftListQuerySchema = z
  .strictObject({
    ...dateRangeShape,
    userId: z.uuid({ error: 'Invalid staff member' }).optional(),
    includeCancelled: queryBooleanSchema.optional(),
  })
  .superRefine(checkDateRange);
export type ShiftListQuery = z.input<typeof shiftListQuerySchema>;

export interface ShiftDto {
  id: string;
  userId: string;
  staffName: string;
  role: StaffRole;
  startsAt: string;
  endsAt: string;
  roleNote: string | null;
  status: ShiftStatus;
  createdAt: string;
}
