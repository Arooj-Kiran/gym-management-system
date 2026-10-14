import { describe, expect, it } from 'vitest';
import { createStaffSchema, loginSchema, updateSettingsSchema, updateStaffSchema } from '../src';

const validStaff = {
  email: '  Sana.Malik@Example.TEST ',
  firstName: 'Sana',
  lastName: 'Malik',
  role: 'RECEPTIONIST',
  temporaryPassword: 'Temp-pass-2026!',
};

describe('shared schemas', () => {
  it('normalizes email and phone on staff creation', () => {
    const parsed = createStaffSchema.parse({ ...validStaff, phone: '0300 1234567' });
    expect(parsed.email).toBe('sana.malik@example.test');
    expect(parsed.phone).toBe('+923001234567');
    expect(parsed.jobTitle).toBeNull();
  });

  it('rejects unknown fields (no mass assignment)', () => {
    const result = createStaffSchema.safeParse({ ...validStaff, isActive: false });
    expect(result.success).toBe(false);
    expect(updateStaffSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
  });

  it('rejects member role and short passwords for staff', () => {
    expect(createStaffSchema.safeParse({ ...validStaff, role: 'MEMBER' }).success).toBe(false);
    expect(createStaffSchema.safeParse({ ...validStaff, temporaryPassword: 'short' }).success).toBe(
      false,
    );
  });

  it('rejects invalid phone numbers', () => {
    expect(createStaffSchema.safeParse({ ...validStaff, phone: '12' }).success).toBe(false);
  });

  it('requires at least one change on partial updates', () => {
    expect(updateStaffSchema.safeParse({}).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ reason: 'only a reason' }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ expiryReminderDays: 0 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ expiryReminderDays: 10 }).success).toBe(true);
  });

  it('accepts a login payload and rejects extra keys', () => {
    expect(loginSchema.safeParse({ email: 'a@b.test', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.test', password: 'x', role: 'ADMIN' }).success).toBe(
      false,
    );
  });
});
