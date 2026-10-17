import { describe, expect, it } from 'vitest';
import {
  checkDuplicateQuerySchema,
  createMemberSchema,
  createPlanSchema,
  memberListQuerySchema,
  resolvePlanRules,
  updateMemberSchema,
  updateMyProfileSchema,
  updatePlanSchema,
} from '../src';

const validMember = { firstName: ' Bilal ', lastName: 'Ahmed', phone: '0321 7654321' };

describe('member schemas', () => {
  it('normalizes the phone and treats an empty email as none', () => {
    const parsed = createMemberSchema.parse({ ...validMember, email: '' });
    expect(parsed.firstName).toBe('Bilal');
    expect(parsed.phone).toBe('+923217654321');
    expect(parsed.email).toBeNull();
    expect(parsed.registrationDate).toBeNull();
  });

  it('requires a valid phone number', () => {
    expect(createMemberSchema.safeParse({ ...validMember, phone: '' }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...validMember, phone: '123' }).success).toBe(false);
  });

  it('requires a reason when a shared phone is confirmed', () => {
    const missing = createMemberSchema.safeParse({ ...validMember, confirmDuplicatePhone: true });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(['duplicatePhoneReason']);
    const given = createMemberSchema.safeParse({
      ...validMember,
      confirmDuplicatePhone: true,
      duplicatePhoneReason: 'Shared family number',
    });
    expect(given.success).toBe(true);
  });

  it('rejects mass-assigned server fields', () => {
    for (const extra of [
      { memberCode: 'GM-999999' },
      { isDemo: true },
      { accessBlocked: true },
      { userId: '00000000-0000-4000-8000-000000000000' },
      { archivedAt: '2026-01-01' },
    ]) {
      expect(createMemberSchema.safeParse({ ...validMember, ...extra }).success).toBe(false);
      expect(updateMemberSchema.safeParse(extra).success).toBe(false);
    }
  });

  it('needs a real change on update, not only the override flags', () => {
    expect(updateMemberSchema.safeParse({}).success).toBe(false);
    expect(
      updateMemberSchema.safeParse({ confirmDuplicatePhone: true, duplicatePhoneReason: 'Family' })
        .success,
    ).toBe(false);
    expect(updateMemberSchema.safeParse({ accountStatus: 'INACTIVE' }).success).toBe(true);
    expect(updateMemberSchema.safeParse({ registrationDate: null }).success).toBe(false);
  });

  it('treats unparseable duplicate-check values as no match', () => {
    expect(checkDuplicateQuerySchema.parse({ email: 'not-an-email', phone: '12' })).toMatchObject({
      email: null,
      phone: null,
    });
  });

  it('parses list filters from the query string', () => {
    const parsed = memberListQuerySchema.parse({ accessBlocked: 'true', view: 'archived' });
    expect(parsed).toMatchObject({ accessBlocked: true, view: 'archived', sort: 'createdAt' });
  });

  it('lets a member change only their emergency contact', () => {
    expect(updateMyProfileSchema.safeParse({ emergencyContactName: 'Amna' }).success).toBe(true);
    expect(updateMyProfileSchema.safeParse({ phone: '03001234567' }).success).toBe(false);
    expect(updateMyProfileSchema.safeParse({ firstName: 'X' }).success).toBe(false);
  });
});

describe('plan schemas', () => {
  const base = { name: 'Monthly Standard', priceMinor: 500000 };

  it('fills in the fixed duration for fixed plan types', () => {
    const parsed = createPlanSchema.parse({ ...base, planType: 'QUARTERLY' });
    expect(parsed).toMatchObject({ durationValue: 3, durationUnit: 'MONTH', benefits: [] });
  });

  it('rejects a duration that contradicts the plan type', () => {
    const result = createPlanSchema.safeParse({
      ...base,
      planType: 'ANNUAL',
      durationValue: 6,
      durationUnit: 'MONTH',
    });
    expect(result.success).toBe(false);
  });

  it('requires a duration for custom plans', () => {
    expect(createPlanSchema.safeParse({ ...base, planType: 'CUSTOM' }).success).toBe(false);
    const parsed = createPlanSchema.parse({
      ...base,
      planType: 'CUSTOM',
      durationValue: 10,
      durationUnit: 'DAY',
    });
    expect(parsed.durationValue).toBe(10);
    expect(
      createPlanSchema.safeParse({
        ...base,
        planType: 'CUSTOM',
        durationValue: 5000,
        durationUnit: 'DAY',
      }).success,
    ).toBe(false);
  });

  it('rejects negative prices and fractional minor units', () => {
    expect(
      createPlanSchema.safeParse({ ...base, planType: 'MONTHLY', priceMinor: -1 }).success,
    ).toBe(false);
    expect(
      createPlanSchema.safeParse({ ...base, planType: 'MONTHLY', priceMinor: 10.5 }).success,
    ).toBe(false);
  });

  it('requires both access times, in order', () => {
    const plan = { ...base, planType: 'MONTHLY' as const };
    expect(createPlanSchema.safeParse({ ...plan, accessStartTime: '06:00' }).success).toBe(false);
    expect(
      createPlanSchema.safeParse({ ...plan, accessStartTime: '18:00', accessEndTime: '06:00' })
        .success,
    ).toBe(false);
    expect(
      createPlanSchema.safeParse({ ...plan, accessStartTime: '06:00', accessEndTime: '12:00' })
        .success,
    ).toBe(true);
  });

  it('normalizes access days and treats all seven as every day', () => {
    const plan = { ...base, planType: 'MONTHLY' as const };
    expect(createPlanSchema.parse({ ...plan, accessDays: [5, 1, 1, 3] }).accessDays).toEqual([
      1, 3, 5,
    ]);
    expect(createPlanSchema.parse({ ...plan, accessDays: [1, 2, 3, 4, 5, 6, 7] }).accessDays).toBe(
      null,
    );
    expect(createPlanSchema.safeParse({ ...plan, accessDays: [] }).success).toBe(false);
    expect(createPlanSchema.safeParse({ ...plan, accessDays: [8] }).success).toBe(false);
  });

  it('limits benefits', () => {
    const plan = { ...base, planType: 'MONTHLY' as const };
    expect(createPlanSchema.safeParse({ ...plan, benefits: ['x'.repeat(121)] }).success).toBe(
      false,
    );
    expect(createPlanSchema.safeParse({ ...plan, benefits: Array(21).fill('Sauna') }).success).toBe(
      false,
    );
  });

  it('checks merged rules for updates', () => {
    expect(updatePlanSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(
      resolvePlanRules({ planType: 'MONTHLY', durationValue: 30, durationUnit: 'DAY' }).issues,
    ).not.toHaveLength(0);
    expect(resolvePlanRules({ planType: 'SIX_MONTH' }).plan.durationValue).toBe(6);
  });
});
