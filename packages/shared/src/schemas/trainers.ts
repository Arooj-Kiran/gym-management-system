import { z } from 'zod';
import { WEEKDAYS, type MemberAccountStatus, type ScheduleItemKind } from '../enums';
import {
  isoDateSchema,
  isoDateTimeSchema,
  optionalIsoDateSchema,
  optionalTextSchema,
  reasonSchema,
  timeOfDaySchema,
} from './common';
import { daysBetween } from '../memberships';
import type { MembershipBrief } from './memberships';

export const TRAINER_LIMITS = {
  bioMax: 1000,
  tagMax: 60,
  tagsMax: 12,
  notesMax: 500,
  slotsMax: 28,
  /** Longest single time-off block. */
  timeOffMaxDays: 60,
  /** Longest window a schedule or class list returns at once. */
  rangeMaxDays: 62,
  /** Appointment and class-session lengths, in minutes. */
  minDurationMinutes: 15,
  maxDurationMinutes: 240,
  /** Appointment start times are offered on this grid. */
  slotStepMinutes: 30,
} as const;

const DAY_MS = 86_400_000;

/** "06:30" → 390. */
export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const tagListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Remove the empty entry')
      .max(
        TRAINER_LIMITS.tagMax,
        `Each entry must be ${TRAINER_LIMITS.tagMax} characters or fewer`,
      ),
  )
  .max(TRAINER_LIMITS.tagsMax, `Add at most ${TRAINER_LIMITS.tagsMax}`)
  .transform((tags) => [...new Set(tags)]);

/** A trainer may change bio and specializations on their own profile; the rest is Admin/Manager. */
export const updateTrainerProfileSchema = z.strictObject({
  bio: optionalTextSchema(TRAINER_LIMITS.bioMax),
  specializations: tagListSchema.optional(),
  certifications: tagListSchema.optional(),
  isBookable: z.boolean().optional(),
});
export type UpdateTrainerProfileInput = z.input<typeof updateTrainerProfileSchema>;
export const TRAINER_SELF_EDITABLE_FIELDS = ['bio', 'specializations'] as const;

export const availabilitySlotSchema = z
  .strictObject({
    weekday: z.number({ error: 'Choose a day' }).int().min(1).max(7),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
  })
  .refine((slot) => timeToMinutes(slot.endTime) > timeToMinutes(slot.startTime), {
    path: ['endTime'],
    message: 'End time must be after the start time',
  });
export type AvailabilitySlotInput = z.input<typeof availabilitySlotSchema>;

/** Replaces the weekly hours from `effectiveFrom` (default: today) onwards. */
export const setAvailabilitySchema = z
  .strictObject({
    slots: z.array(availabilitySlotSchema).max(TRAINER_LIMITS.slotsMax, 'Too many time slots'),
    effectiveFrom: optionalIsoDateSchema,
  })
  .superRefine((input, ctx) => {
    for (const day of WEEKDAYS) {
      const slots = input.slots
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => slot.weekday === day)
        .sort((a, b) => timeToMinutes(a.slot.startTime) - timeToMinutes(b.slot.startTime));
      for (let i = 1; i < slots.length; i += 1) {
        const prev = slots[i - 1]!;
        const next = slots[i]!;
        if (timeToMinutes(next.slot.startTime) < timeToMinutes(prev.slot.endTime)) {
          ctx.addIssue({
            code: 'custom',
            path: ['slots', next.index, 'startTime'],
            message: 'Overlaps another slot on the same day',
          });
        }
      }
    }
  });
export type SetAvailabilityInput = z.input<typeof setAvailabilitySchema>;

export const createTimeOffSchema = z
  .strictObject({
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    reason: optionalTextSchema(TRAINER_LIMITS.notesMax),
  })
  .superRefine((input, ctx) => {
    const span = Date.parse(input.endsAt) - Date.parse(input.startsAt);
    if (span <= 0) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Must be after the start' });
    } else if (span > TRAINER_LIMITS.timeOffMaxDays * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: `Time off can last at most ${TRAINER_LIMITS.timeOffMaxDays} days`,
      });
    }
  });
export type CreateTimeOffInput = z.input<typeof createTimeOffSchema>;

export const optionalReasonBodySchema = z.strictObject({ reason: reasonSchema.optional() });
export type OptionalReasonInput = z.input<typeof optionalReasonBodySchema>;

/** Inclusive gym-time dates, at most TRAINER_LIMITS.rangeMaxDays apart. */
export const dateRangeShape = { from: isoDateSchema, to: isoDateSchema };
export function checkDateRange(input: { from: string; to: string }, ctx: z.RefinementCtx) {
  const days = daysBetween(input.from, input.to);
  if (days < 0) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Must be on or after the start date' });
  } else if (days >= TRAINER_LIMITS.rangeMaxDays) {
    ctx.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Choose at most ${TRAINER_LIMITS.rangeMaxDays} days`,
    });
  }
}

export const scheduleQuerySchema = z.strictObject(dateRangeShape).superRefine(checkDateRange);
export type ScheduleQuery = z.input<typeof scheduleQuerySchema>;

export const durationMinutesSchema = z.coerce
  .number({ error: 'Enter a length in minutes' })
  .int('Enter whole minutes')
  .min(TRAINER_LIMITS.minDurationMinutes, `At least ${TRAINER_LIMITS.minDurationMinutes} minutes`)
  .max(TRAINER_LIMITS.maxDurationMinutes, `At most ${TRAINER_LIMITS.maxDurationMinutes} minutes`);

export const availableSlotsQuerySchema = z.strictObject({
  date: isoDateSchema,
  durationMinutes: durationMinutesSchema.default(60),
});
export type AvailableSlotsQuery = z.input<typeof availableSlotsQuerySchema>;

export const createAssignmentSchema = z.strictObject({
  trainerId: z.uuid({ error: 'Choose a trainer' }),
  memberId: z.uuid({ error: 'Choose a member' }),
  /** Defaults to today in gym time; never in the future. */
  startDate: optionalIsoDateSchema,
  notes: optionalTextSchema(TRAINER_LIMITS.notesMax),
});
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;

export const assignmentListQuerySchema = z.strictObject({
  trainerId: z.uuid({ error: 'Invalid trainer' }).optional(),
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
});
export type AssignmentListQuery = z.input<typeof assignmentListQuerySchema>;

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
}

/** Staff view of a trainer. `id` is the trainer's user id. */
export interface TrainerDto extends PersonRef {
  email: string;
  isActive: boolean;
  bio: string | null;
  specializations: string[];
  certifications: string[];
  isBookable: boolean;
  /** Members currently assigned. */
  activeMemberCount: number;
  /** Has weekly hours in force today or later; without them no appointment can be booked. */
  hasWeeklyHours: boolean;
}

/** Portal view: public profile fields only. */
export interface PublicTrainerDto extends PersonRef {
  bio: string | null;
  specializations: string[];
  certifications: string[];
  isBookable: boolean;
  /** The signed-in member is currently assigned to this trainer. */
  assignedToMe: boolean;
}

export interface AvailabilitySlotDto {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface TrainerAvailabilityDto {
  /** The weekly hours in force today. */
  current: AvailabilitySlotDto[];
  /** A change already saved for a later date, if any. */
  upcoming: { effectiveFrom: string; slots: AvailabilitySlotDto[] } | null;
  timeOff: TimeOffDto[];
}

export interface TimeOffDto {
  id: string;
  trainerId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  status: 'ACTIVE' | 'CANCELLED';
  createdAt: string;
}

export interface ScheduleItemDto {
  kind: ScheduleItemKind;
  /** The session, appointment, time-off or shift id. */
  id: string;
  startsAt: string;
  endsAt: string;
  title: string;
  /** Room, member name or shift note. */
  detail: string | null;
  status: string;
  /** Classes: places taken and capacity. */
  booked?: number;
  capacity?: number;
}

export interface AvailableSlotDto {
  startsAt: string;
  endsAt: string;
}

/** Trainer-safe member fields (§5): no contact details, notes or billing. */
export interface TrainerSafeMemberDto {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  accountStatus: MemberAccountStatus;
  archivedAt: string | null;
  currentMembership: MembershipBrief | null;
}

export interface TrainerAssignmentDto {
  id: string;
  trainer: PersonRef;
  member: TrainerSafeMemberDto;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  assignedByName: string | null;
  createdAt: string;
}

/** A row on a trainer's member list. */
export interface TrainerMemberDto {
  assignmentId: string;
  startDate: string;
  notes: string | null;
  member: TrainerSafeMemberDto;
  lastCheckInAt: string | null;
}
