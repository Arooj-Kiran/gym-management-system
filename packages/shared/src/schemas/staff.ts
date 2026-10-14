import { z } from 'zod';
import { STAFF_ROLES, type StaffRole } from '../roles';
import {
  emailSchema,
  listQueryBase,
  nameSchema,
  optionalIsoDateSchema,
  optionalPhoneSchema,
  optionalTextSchema,
  passwordSchema,
  reasonSchema,
} from './common';

export const staffRoleSchema = z.enum(STAFF_ROLES, { error: 'Choose a staff role' });

const staffProfileFields = {
  email: emailSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  phone: optionalPhoneSchema,
  jobTitle: optionalTextSchema(80),
  hireDate: optionalIsoDateSchema,
  notes: optionalTextSchema(1000),
};

export const createStaffSchema = z.strictObject({
  ...staffProfileFields,
  role: staffRoleSchema,
  temporaryPassword: passwordSchema,
});
export type CreateStaffInput = z.input<typeof createStaffSchema>;

export const updateStaffSchema = z
  .strictObject(staffProfileFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one field');
export type UpdateStaffInput = z.input<typeof updateStaffSchema>;

export const changeRoleSchema = z.strictObject({
  role: staffRoleSchema,
  reason: reasonSchema.optional(),
});
export type ChangeRoleInput = z.input<typeof changeRoleSchema>;

export const activateStaffSchema = z.strictObject({ reason: reasonSchema.optional() });

export const deactivateStaffSchema = z.strictObject({
  reason: reasonSchema.min(3, 'Give a short reason (at least 3 characters)'),
});
export type DeactivateStaffInput = z.input<typeof deactivateStaffSchema>;

export const resetPasswordSchema = z.strictObject({ temporaryPassword: passwordSchema });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const STAFF_SORT_FIELDS = ['name', 'email', 'role', 'createdAt', 'lastLoginAt'] as const;

export const staffListQuerySchema = z.strictObject({
  ...listQueryBase,
  sort: z.enum(STAFF_SORT_FIELDS).default('name'),
  role: staffRoleSchema.optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
export type StaffListQuery = z.input<typeof staffListQuerySchema>;

export interface StaffDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: StaffRole;
  isActive: boolean;
  isLocked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  jobTitle: string | null;
  hireDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
