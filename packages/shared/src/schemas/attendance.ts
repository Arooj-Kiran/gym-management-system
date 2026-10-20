import { z } from 'zod';
import {
  ACCESS_SOURCES,
  ATTENDANCE_STATUSES,
  type AccessSource,
  type AttendanceStatus,
  type CorrectionField,
} from '../enums';
import { listQueryBase, optionalIsoDateSchema, requiredReasonSchema } from './common';

export const manualCheckInSchema = z.strictObject({
  memberId: z.uuid({ error: 'Choose a member' }),
  /** Why staff verified the member by hand (no consent, scanner down, …). Audit-logged. */
  reason: requiredReasonSchema,
});
export type ManualCheckInInput = z.input<typeof manualCheckInSchema>;

export const attendanceListQuerySchema = z.strictObject({
  ...listQueryBase,
  /** One calendar day in gym time; `from`/`to` give an inclusive range instead. */
  date: optionalIsoDateSchema,
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  source: z.enum(ACCESS_SOURCES).optional(),
  status: z.enum(ATTENDANCE_STATUSES).optional(),
});
export type AttendanceListQuery = z.input<typeof attendanceListQuerySchema>;

const timestampSchema = z.iso.datetime({ offset: true, error: 'Enter a valid date and time' });

export const attendanceCorrectionSchema = z
  .strictObject({
    checkInAt: timestampSchema.optional(),
    /** null clears a check-out recorded by mistake. */
    checkOutAt: timestampSchema.nullable().optional(),
    status: z.enum(ATTENDANCE_STATUSES).optional(),
    reason: requiredReasonSchema,
  })
  .refine(
    (input) =>
      input.checkInAt !== undefined || input.checkOutAt !== undefined || input.status !== undefined,
    { message: 'Change at least one field' },
  );
export type AttendanceCorrectionInput = z.input<typeof attendanceCorrectionSchema>;

export interface AttendanceMemberRef {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

export interface AttendanceDto {
  id: string;
  member: AttendanceMemberRef;
  membershipId: string;
  planName: string;
  checkInAt: string;
  checkOutAt: string | null;
  source: AccessSource;
  status: AttendanceStatus;
  accessAttemptId: string;
  createdByName: string | null;
  correctionCount: number;
}

export interface AttendanceCorrectionDto {
  id: string;
  field: CorrectionField;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  correctedByName: string | null;
  createdAt: string;
}

/** Portal view: the member's own check-ins. */
export interface MyAttendanceDto {
  id: string;
  checkInAt: string;
  checkOutAt: string | null;
  source: AccessSource;
}

export const myAttendanceQuerySchema = z.strictObject({
  page: listQueryBase.page,
  pageSize: listQueryBase.pageSize,
});
