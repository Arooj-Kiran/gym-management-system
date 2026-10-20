import { z } from 'zod';
import { BIOMETRIC_CONSENT } from '../access';
import type { DeviceType, EnrollmentStatus } from '../enums';
import { requiredReasonSchema } from './common';
import { templateRefSchema } from './access';

/** Staff confirm which consent text the member agreed to; only the current version is accepted. */
export const giveConsentSchema = z.strictObject({
  consentVersion: z.literal(BIOMETRIC_CONSENT.version, {
    error: 'The consent text has changed. Reload the page and read it again.',
  }),
});
export type GiveConsentInput = z.input<typeof giveConsentSchema>;

export const withdrawConsentSchema = z.strictObject({ reason: requiredReasonSchema });
export type WithdrawConsentInput = z.input<typeof withdrawConsentSchema>;

export const enrollSchema = z.strictObject({
  deviceId: z.uuid({ error: 'Choose a device' }),
  /** Required for real scanners; a simulated device generates a SIM- ID when omitted. */
  templateRef: templateRefSchema.optional(),
});
export type EnrollInput = z.input<typeof enrollSchema>;

export const revokeEnrollmentSchema = z.strictObject({ reason: requiredReasonSchema });
export type RevokeEnrollmentInput = z.input<typeof revokeEnrollmentSchema>;

export interface BiometricConsentDto {
  id: string;
  consentVersion: string;
  givenAt: string;
  recordedByName: string | null;
  withdrawnAt: string | null;
  withdrawnByName: string | null;
}

export interface BiometricEnrollmentDto {
  id: string;
  device: { id: string; name: string; deviceType: DeviceType };
  provider: string;
  /** Always masked, e.g. SIM-••01 (PLAN §6.6). null once the device confirmed deletion. */
  templateRefMasked: string | null;
  status: EnrollmentStatus;
  enrolledAt: string;
  enrolledByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  revokeReason: string | null;
  deletedAt: string | null;
}

export interface MemberBiometricStatus {
  /** The consent in force, if any. */
  consent: BiometricConsentDto | null;
  consentHistory: BiometricConsentDto[];
  enrollments: BiometricEnrollmentDto[];
  currentConsentVersion: string;
}
