import { z } from 'zod';
import type { Permission } from '../permissions';
import type { Role } from '../roles';
import { PASSWORD_MAX_LENGTH, passwordSchema } from './common';

export const loginSchema = z.strictObject({
  email: z
    .string({ error: 'Email is required' })
    .trim()
    .toLowerCase()
    .min(1, 'Email is required')
    .max(254, 'Email is too long'),
  password: z
    .string({ error: 'Password is required' })
    .min(1, 'Password is required')
    .max(PASSWORD_MAX_LENGTH, 'Password is too long'),
});
export type LoginInput = z.input<typeof loginSchema>;

export const changePasswordSchema = z.strictObject({
  currentPassword: z
    .string({ error: 'Current password is required' })
    .min(1, 'Current password is required')
    .max(PASSWORD_MAX_LENGTH, 'Password is too long'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface MeResponse {
  user: SessionUser;
  permissions: Permission[];
  csrfToken: string;
  gym: {
    name: string;
    currencyCode: string;
    /** True while fictional demo records exist; the app shows a DEMO DATA banner. */
    hasDemoData: boolean;
  };
}
