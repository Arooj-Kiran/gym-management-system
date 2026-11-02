import { z } from 'zod';
import { CLASS_ATTENDANCE_STATUSES, type BookingStatus, type ClassSessionStatus } from '../enums';
import {
  isoDateTimeSchema,
  nameSchema,
  optionalIsoDateSchema,
  optionalTextSchema,
  queryBooleanSchema,
  requiredReasonSchema,
} from './common';
import type { MembershipMemberRef } from './memberships';
import { checkDateRange, dateRangeShape, durationMinutesSchema, type PersonRef } from './trainers';

export const CLASS_LIMITS = {
  descriptionMax: 1000,
  roomMax: 60,
  minCapacity: 1,
  maxCapacity: 200,
  /** A weekly series creates at most this many sessions. */
  maxOccurrences: 52,
} as const;

const capacitySchema = z.coerce
  .number({ error: 'Enter a capacity' })
  .int('Enter a whole number')
  .min(CLASS_LIMITS.minCapacity, `At least ${CLASS_LIMITS.minCapacity}`)
  .max(CLASS_LIMITS.maxCapacity, `At most ${CLASS_LIMITS.maxCapacity}`);

export const createClassSchema = z.strictObject({
  name: nameSchema,
  description: optionalTextSchema(CLASS_LIMITS.descriptionMax),
  defaultDurationMinutes: durationMinutesSchema,
  defaultCapacity: capacitySchema,
  defaultTrainerId: z.uuid({ error: 'Choose a trainer' }).nullish(),
});
export type CreateClassInput = z.input<typeof createClassSchema>;

export const updateClassSchema = createClassSchema.partial();
export type UpdateClassInput = z.input<typeof updateClassSchema>;

export const classListQuerySchema = z.strictObject({
  includeArchived: queryBooleanSchema.optional(),
});

export const createClassSessionSchema = z.strictObject({
  classId: z.uuid({ error: 'Choose a class' }),
  /** Defaults to the class's default trainer. */
  trainerId: z.uuid({ error: 'Choose a trainer' }).optional(),
  startsAt: isoDateTimeSchema,
  durationMinutes: durationMinutesSchema.optional(),
  capacity: capacitySchema.optional(),
  room: optionalTextSchema(CLASS_LIMITS.roomMax),
  /** Repeat every week at the same gym time up to and including this date. */
  repeatWeeklyUntil: optionalIsoDateSchema,
});
export type CreateClassSessionInput = z.input<typeof createClassSessionSchema>;

export const updateClassSessionSchema = z.strictObject({
  trainerId: z.uuid({ error: 'Choose a trainer' }).optional(),
  startsAt: isoDateTimeSchema.optional(),
  durationMinutes: durationMinutesSchema.optional(),
  capacity: capacitySchema.optional(),
  room: optionalTextSchema(CLASS_LIMITS.roomMax),
});
export type UpdateClassSessionInput = z.input<typeof updateClassSessionSchema>;

export const cancelClassSessionSchema = z.strictObject({ reason: requiredReasonSchema });
export type CancelClassSessionInput = z.input<typeof cancelClassSessionSchema>;

export const classSessionListQuerySchema = z
  .strictObject({
    ...dateRangeShape,
    trainerId: z.uuid({ error: 'Invalid trainer' }).optional(),
    classId: z.uuid({ error: 'Invalid class' }).optional(),
    includeCancelled: queryBooleanSchema.optional(),
  })
  .superRefine(checkDateRange);
export type ClassSessionListQuery = z.input<typeof classSessionListQuerySchema>;

export const createBookingSchema = z.strictObject({
  memberId: z.uuid({ error: 'Choose a member' }),
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;

export const myBookingSchema = z.strictObject({
  sessionId: z.uuid({ error: 'Choose a class' }),
});
export type MyBookingInput = z.input<typeof myBookingSchema>;

export const markClassAttendanceSchema = z.strictObject({
  status: z.enum(CLASS_ATTENDANCE_STATUSES, { error: 'Choose attended or no-show' }),
});
export type MarkClassAttendanceInput = z.input<typeof markClassAttendanceSchema>;

export interface FitnessClassDto {
  id: string;
  name: string;
  description: string | null;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  defaultTrainer: PersonRef | null;
  isActive: boolean;
  /** Scheduled sessions that have not started yet. */
  upcomingSessions: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassSessionDto {
  id: string;
  classId: string;
  className: string;
  description: string | null;
  trainer: PersonRef;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  capacity: number;
  room: string | null;
  status: ClassSessionStatus;
  /** A scheduled session that has ended reads as COMPLETED. */
  effectiveStatus: ClassSessionStatus;
  cancelReason: string | null;
  /** Places taken (booked, attended or no-show). */
  bookedCount: number;
  waitlistCount: number;
  spotsLeft: number;
}

export interface ClassBookingDto {
  id: string;
  sessionId: string;
  status: BookingStatus;
  /** 1 = next in line; null unless waitlisted. */
  waitlistPosition: number | null;
  bookedAt: string;
  cancelledAt: string | null;
  member: MembershipMemberRef;
  bookedByName: string | null;
}

export interface MyBookingBrief {
  id: string;
  status: BookingStatus;
  waitlistPosition: number | null;
}

/** Portal view of a session with the member's own booking and whether they can book it. */
export interface MyClassSessionDto extends Omit<ClassSessionDto, 'cancelReason'> {
  myBooking: MyBookingBrief | null;
  bookable: boolean;
  /** Why the member cannot book, in plain words; null when bookable or already booked. */
  notBookableReason: string | null;
}
