import { z } from 'zod';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from '../enums';
import {
  isoDateTimeSchema,
  listQueryBase,
  optionalIsoDateSchema,
  optionalTextSchema,
} from './common';
import type { MembershipMemberRef } from './memberships';
import { durationMinutesSchema, TRAINER_LIMITS, type PersonRef } from './trainers';

export const createAppointmentSchema = z.strictObject({
  trainerId: z.uuid({ error: 'Choose a trainer' }),
  memberId: z.uuid({ error: 'Choose a member' }),
  startsAt: isoDateTimeSchema,
  durationMinutes: durationMinutesSchema.default(60),
  notes: optionalTextSchema(TRAINER_LIMITS.notesMax),
});
export type CreateAppointmentInput = z.input<typeof createAppointmentSchema>;

/** Reschedule or change the notes; times are re-checked like a new booking. */
export const updateAppointmentSchema = z.strictObject({
  startsAt: isoDateTimeSchema.optional(),
  durationMinutes: durationMinutesSchema.optional(),
  notes: optionalTextSchema(TRAINER_LIMITS.notesMax),
});
export type UpdateAppointmentInput = z.input<typeof updateAppointmentSchema>;

/** `from`/`to` are inclusive gym-time dates. */
export const appointmentListQuerySchema = z.strictObject({
  ...listQueryBase,
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
  trainerId: z.uuid({ error: 'Invalid trainer' }).optional(),
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});
export type AppointmentListQuery = z.input<typeof appointmentListQuerySchema>;

export interface AppointmentDto {
  id: string;
  trainer: PersonRef;
  member: MembershipMemberRef;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Portal view: no staff notes. */
export interface MyAppointmentDto {
  id: string;
  trainer: PersonRef;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
}

/** One line on the member's upcoming schedule. */
export interface MyScheduleItemDto {
  kind: 'CLASS' | 'APPOINTMENT';
  /** The booking id for a class, the appointment id otherwise. */
  id: string;
  title: string;
  trainerName: string;
  startsAt: string;
  endsAt: string;
  room: string | null;
  status: string;
  waitlistPosition: number | null;
}
