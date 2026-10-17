import { z } from 'zod';
import {
  DURATION_UNITS,
  FIXED_PLAN_MONTHS,
  PLAN_TYPES,
  type DurationUnit,
  type PlanType,
} from '../enums';
import { listQueryBase, optionalTextSchema, reasonSchema } from './common';

export const PLAN_MAX_BENEFITS = 20;
/** Upper bounds keep custom plans sane; the database CHECKs only require positive values. */
export const CUSTOM_PLAN_MAX: Record<DurationUnit, number> = { DAY: 3650, MONTH: 120 };
/** 100 million in major units — far above any real price, well inside a safe integer. */
export const PLAN_MAX_PRICE_MINOR = 10_000_000_000;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalTimeSchema = z
  .union([z.literal(''), z.string().regex(TIME_PATTERN, 'Use 24-hour time, e.g. 06:00')])
  .nullish()
  .transform((value) => value || null);

/** null = every day. Sorted and de-duplicated so equal sets compare equal. */
const accessDaysSchema = z
  .array(z.int().min(1, 'Unknown weekday').max(7, 'Unknown weekday'))
  .min(1, 'Pick at least one day, or allow every day')
  .max(7)
  .nullish()
  .transform((days) => (days ? [...new Set(days)].sort((a, b) => a - b) : null))
  .transform((days) => (days?.length === 7 ? null : days));

const planFields = {
  name: z
    .string({ error: 'Plan name is required' })
    .trim()
    .min(2, 'Use at least 2 characters')
    .max(80, 'Must be 80 characters or fewer'),
  planType: z.enum(PLAN_TYPES, { error: 'Choose a plan type' }),
  durationValue: z.int('Enter a whole number').positive('Must be at least 1').optional(),
  durationUnit: z.enum(DURATION_UNITS, { error: 'Choose days or months' }).optional(),
  priceMinor: z
    .int('Enter a valid price')
    .min(0, 'Price cannot be negative')
    .max(PLAN_MAX_PRICE_MINOR, 'Price is too high'),
  description: optionalTextSchema(2000),
  benefits: z
    .array(
      z
        .string()
        .trim()
        .min(1, 'Benefit cannot be empty')
        .max(120, 'Each benefit must be 120 characters or fewer'),
    )
    .max(PLAN_MAX_BENEFITS, `List at most ${PLAN_MAX_BENEFITS} benefits`),
  allowPartialPayment: z.boolean(),
  accessDays: accessDaysSchema,
  accessStartTime: optionalTimeSchema,
  accessEndTime: optionalTimeSchema,
};

export interface PlanRuleInput {
  planType: PlanType;
  durationValue?: number | null;
  durationUnit?: DurationUnit | null;
  accessStartTime?: string | null;
  accessEndTime?: string | null;
}

export interface PlanIssue {
  path: string;
  message: string;
}

/**
 * Cross-field plan rules (PLAN §3.3). Shared by create and by the server, which re-checks the
 * merged row on update. Fixed types get their duration filled in when it is omitted.
 */
export function resolvePlanRules<T extends PlanRuleInput>(
  plan: T,
): { plan: T & { durationValue: number; durationUnit: DurationUnit }; issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  let durationValue = plan.durationValue ?? null;
  let durationUnit = plan.durationUnit ?? null;

  if (plan.planType === 'CUSTOM') {
    if (durationValue === null) issues.push({ path: 'durationValue', message: 'Enter a duration' });
    if (durationUnit === null)
      issues.push({ path: 'durationUnit', message: 'Choose days or months' });
    if (
      durationValue !== null &&
      durationUnit !== null &&
      durationValue > CUSTOM_PLAN_MAX[durationUnit]
    ) {
      issues.push({
        path: 'durationValue',
        message: `A custom plan can run at most ${CUSTOM_PLAN_MAX[durationUnit]} ${durationUnit === 'DAY' ? 'days' : 'months'}`,
      });
    }
  } else {
    const months = FIXED_PLAN_MONTHS[plan.planType];
    if (
      (durationValue !== null && durationValue !== months) ||
      (durationUnit !== null && durationUnit !== 'MONTH')
    ) {
      issues.push({
        path: 'durationValue',
        message: `This plan type always runs ${months} month${months === 1 ? '' : 's'}`,
      });
    }
    durationValue = months;
    durationUnit = 'MONTH';
  }

  const start = plan.accessStartTime ?? null;
  const end = plan.accessEndTime ?? null;
  if ((start === null) !== (end === null)) {
    issues.push({
      path: start === null ? 'accessStartTime' : 'accessEndTime',
      message: 'Set both opening and closing times, or neither',
    });
  } else if (start !== null && end !== null && start >= end) {
    issues.push({ path: 'accessEndTime', message: 'Closing time must be after opening time' });
  }

  return {
    plan: { ...plan, durationValue: durationValue ?? 0, durationUnit: durationUnit ?? 'DAY' },
    issues,
  };
}

function addPlanIssues(plan: PlanRuleInput, ctx: z.RefinementCtx) {
  for (const issue of resolvePlanRules(plan).issues) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
}

export const createPlanSchema = z
  .strictObject({
    ...planFields,
    benefits: planFields.benefits.default([]),
    allowPartialPayment: planFields.allowPartialPayment.default(false),
  })
  .superRefine(addPlanIssues)
  .transform((plan) => resolvePlanRules(plan).plan);
export type CreatePlanInput = z.input<typeof createPlanSchema>;

/** Cross-field rules are checked by the server against the merged plan. */
export const updatePlanSchema = z
  .strictObject(planFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');
export type UpdatePlanInput = z.input<typeof updatePlanSchema>;

export const archivePlanSchema = z.strictObject({ reason: reasonSchema.optional() });

export const PLAN_SORT_FIELDS = ['name', 'price', 'createdAt'] as const;

export const planListQuerySchema = z.strictObject({
  ...listQueryBase,
  sort: z.enum(PLAN_SORT_FIELDS).default('price'),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  planType: z.enum(PLAN_TYPES).optional(),
});
export type PlanListQuery = z.input<typeof planListQuerySchema>;

export interface PlanDto {
  id: string;
  name: string;
  planType: PlanType;
  durationValue: number;
  durationUnit: DurationUnit;
  priceMinor: number;
  description: string | null;
  benefits: string[];
  allowPartialPayment: boolean;
  /** ISO weekdays; null = every day. */
  accessDays: number[] | null;
  /** HH:MM, gym time; both null = all opening hours. */
  accessStartTime: string | null;
  accessEndTime: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
