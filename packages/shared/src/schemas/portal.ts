import { z } from 'zod';
import type { MemberAccountStatus } from '../enums';
import { optionalPhoneSchema, optionalTextSchema } from './common';

/** A member may change only their emergency contact (and photo, via its own route). */
export const updateMyProfileSchema = z
  .strictObject({
    emergencyContactName: optionalTextSchema(80),
    emergencyContactPhone: optionalPhoneSchema,
    emergencyContactRelation: optionalTextSchema(40),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');
export type UpdateMyProfileInput = z.input<typeof updateMyProfileSchema>;

export interface MyProfileDto {
  memberCode: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  photoUrl: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  registrationDate: string;
  accountStatus: MemberAccountStatus;
  accessBlocked: boolean;
}
