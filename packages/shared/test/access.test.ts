import { describe, expect, it } from 'vitest';
import {
  ACCESS_REASONS,
  accessDecisionSchema,
  attendanceCorrectionSchema,
  BIOMETRIC_CONSENT,
  createDeviceSchema,
  deviceScanSchema,
  enrollSchema,
  giveConsentSchema,
  kioskMessage,
  maskTemplateRef,
  simulateScanSchema,
} from '../src';

const EVENT_ID = '0b9f3c55-3f3e-4f55-9a43-3c1c2b8d6f10';
const DEVICE_ID = '7d1e8f8c-2b7a-4a51-9c38-5f2a9e3d4b21';

describe('maskTemplateRef', () => {
  it('keeps the SIM- prefix and the last two characters only', () => {
    expect(maskTemplateRef('SIM-0001')).toBe('SIM-••01');
    expect(maskTemplateRef('1042')).toBe('••42');
    expect(maskTemplateRef('ZK-USER-778812')).toBe('••12');
  });

  it('reveals nothing of very short refs', () => {
    expect(maskTemplateRef('12')).toBe('••');
    expect(maskTemplateRef('SIM-7')).toBe('SIM-••');
    expect(maskTemplateRef(null)).toBeNull();
  });
});

describe('kioskMessage (PLAN §6.4)', () => {
  it('welcomes a granted member with the end date', () => {
    expect(kioskMessage('GRANTED', { firstName: 'Ayesha', endDate: '2026-11-17' })).toEqual({
      title: 'Access Granted',
      message: 'Welcome, Ayesha. Valid until 17 Nov 2026.',
    });
  });

  it('uses the agreed wording for each denial', () => {
    expect(kioskMessage('MEMBERSHIP_CANCELLED').message).toBe(
      'Membership cancelled. Please see reception.',
    );
    expect(kioskMessage('MEMBERSHIP_EXPIRED', { endDate: '2026-10-01' }).message).toBe(
      'Membership expired on 1 Oct 2026.',
    );
    expect(kioskMessage('MEMBERSHIP_SUSPENDED').message).toBe('Membership suspended.');
    for (const reason of ['MEMBERSHIP_NOT_ACTIVATED', 'MEMBERSHIP_NOT_STARTED', 'NO_MEMBERSHIP'] as const) {
      expect(kioskMessage(reason).message).toBe('No active membership for today.');
    }
    expect(kioskMessage('MEMBER_NOT_RECOGNIZED')).toEqual({
      title: 'Member Not Recognized',
      message: 'Please try again or see reception.',
    });
    expect(kioskMessage('AUTHORIZATION_UNAVAILABLE').message).toBe(
      'Membership could not be verified. Please see reception.',
    );
    expect(kioskMessage('DEVICE_NOT_AUTHORIZED').message).toBe('Device not authorized.');
  });

  it('has a message for every reason, and only GRANTED says granted', () => {
    for (const reason of ACCESS_REASONS) {
      const { title, message } = kioskMessage(reason, { firstName: 'Ali', endDate: '2026-12-31' });
      expect(message.length).toBeGreaterThan(0);
      expect(title === 'Access Granted').toBe(reason === 'GRANTED');
    }
  });
});

describe('deviceScanSchema', () => {
  const scan = {
    eventId: EVENT_ID,
    matchResult: 'MATCH',
    templateRef: 'SIM-0001',
    occurredAt: '2026-10-18T09:15:00+05:00',
  };

  it('accepts a match with a ref', () => {
    expect(deviceScanSchema.safeParse(scan).success).toBe(true);
  });

  it('requires a ref for a match, but not for NO_MATCH or DEVICE_ERROR', () => {
    expect(deviceScanSchema.safeParse({ ...scan, templateRef: undefined }).success).toBe(false);
    expect(
      deviceScanSchema.safeParse({ ...scan, matchResult: 'NO_MATCH', templateRef: undefined })
        .success,
    ).toBe(true);
    expect(
      deviceScanSchema.safeParse({ ...scan, matchResult: 'DEVICE_ERROR', templateRef: undefined })
        .success,
    ).toBe(true);
  });

  it('rejects unknown fields, non-UUID event IDs and odd refs', () => {
    expect(deviceScanSchema.safeParse({ ...scan, memberId: DEVICE_ID }).success).toBe(false);
    expect(deviceScanSchema.safeParse({ ...scan, eventId: 'abc' }).success).toBe(false);
    expect(deviceScanSchema.safeParse({ ...scan, templateRef: "1'; drop" }).success).toBe(false);
  });
});

describe('simulateScanSchema', () => {
  it('needs a fake ID unless the scenario has no finger to match', () => {
    expect(simulateScanSchema.safeParse({ deviceId: DEVICE_ID }).success).toBe(false);
    expect(
      simulateScanSchema.safeParse({ deviceId: DEVICE_ID, scenario: 'NO_MATCH' }).success,
    ).toBe(true);
    expect(
      simulateScanSchema.safeParse({ deviceId: DEVICE_ID, scenario: 'AUTHORIZATION_UNAVAILABLE' })
        .success,
    ).toBe(false);
    expect(
      simulateScanSchema.safeParse({ deviceId: DEVICE_ID, templateRef: 'SIM-0001' }).success,
    ).toBe(true);
  });
});

describe('accessDecisionSchema', () => {
  it('rejects a body without a decision', () => {
    expect(accessDecisionSchema.safeParse({ reason: 'GRANTED' }).success).toBe(false);
    expect(accessDecisionSchema.safeParse({ decision: 'MAYBE' }).success).toBe(false);
  });
});

describe('device, consent, enrollment and correction schemas', () => {
  it('keeps vendor details for real scanners only', () => {
    const base = { name: 'Front door', location: 'Main entrance' };
    expect(createDeviceSchema.safeParse({ ...base, deviceType: 'SIMULATED' }).success).toBe(true);
    expect(
      createDeviceSchema.safeParse({ ...base, deviceType: 'SIMULATED', vendor: 'ZKTeco' }).success,
    ).toBe(false);
    expect(
      createDeviceSchema.safeParse({ ...base, deviceType: 'REAL', vendor: 'ZKTeco' }).success,
    ).toBe(true);
  });

  it('accepts only the current consent version', () => {
    expect(giveConsentSchema.safeParse({ consentVersion: BIOMETRIC_CONSENT.version }).success).toBe(
      true,
    );
    expect(giveConsentSchema.safeParse({ consentVersion: '2025-01-v0' }).success).toBe(false);
  });

  it('lets an enrollment omit the ref (simulated devices generate one)', () => {
    expect(enrollSchema.safeParse({ deviceId: DEVICE_ID }).success).toBe(true);
  });

  it('needs a reason and at least one change for a correction', () => {
    expect(attendanceCorrectionSchema.safeParse({ reason: 'Typo fix' }).success).toBe(false);
    expect(attendanceCorrectionSchema.safeParse({ status: 'VOIDED' }).success).toBe(false);
    expect(
      attendanceCorrectionSchema.safeParse({ status: 'VOIDED', reason: 'Scanned twice' }).success,
    ).toBe(true);
    expect(
      attendanceCorrectionSchema.safeParse({ checkOutAt: null, reason: 'Wrong check-out' })
        .success,
    ).toBe(true);
  });
});
