import { z } from 'zod';
import {
  ACCESS_REASONS,
  ACCESS_RESULTS,
  ACCESS_SOURCES,
  DEVICE_HEALTH,
  DEVICE_STATUSES,
  DEVICE_TYPES,
  MATCH_RESULTS,
  SIMULATOR_SCENARIOS,
  type AccessReason,
  type AccessResult,
  type AccessSource,
  type DeviceHealth,
  type DeviceStatus,
  type DeviceType,
} from '../enums';
import { listQueryBase, nameSchema, optionalIsoDateSchema, optionalTextSchema, reasonSchema } from './common';

/** A device-side user or template ID. Never an image or template (PLAN §3.6). */
export const templateRefSchema = z
  .string({ error: 'Enter the device user ID' })
  .trim()
  .min(1, 'Enter the device user ID')
  .max(64, 'Must be 64 characters or fewer')
  .regex(/^[A-Za-z0-9._:-]+$/, 'Use letters, digits and . _ : - only');

const timestampSchema = z.iso.datetime({ offset: true, error: 'Use an ISO 8601 timestamp' });

// --- Device-key routes (the biometric agent) --------------------------------------------------

export const deviceScanSchema = z
  .strictObject({
    /** Idempotency key: a retry reuses it and gets the same decision back. */
    eventId: z.uuid({ error: 'eventId must be a UUID' }),
    matchResult: z.enum(MATCH_RESULTS, { error: 'Unknown match result' }),
    templateRef: templateRefSchema.optional(),
    errorCode: z.string().trim().max(64).optional(),
    /** Device clock; sanity-checked by the server, which also stores its own receive time. */
    occurredAt: timestampSchema,
    /**
     * Informational only. The stored source always comes from the device type on the server,
     * so a simulated device claiming REAL is still recorded as SIMULATED (PLAN §6.5).
     */
    source: z.enum(DEVICE_TYPES).optional(),
  })
  .refine((scan) => scan.matchResult !== 'MATCH' || scan.templateRef !== undefined, {
    path: ['templateRef'],
    message: 'A match must name the device user ID',
  });
export type DeviceScanInput = z.input<typeof deviceScanSchema>;

export const OFFLINE_DENIALS_MAX = 500;

/** Denial facts only (time and event ID); the agent never stores decision data (PLAN §6.2). */
export const offlineDenialsSchema = z.strictObject({
  denials: z
    .array(z.strictObject({ eventId: z.uuid(), occurredAt: timestampSchema }))
    .min(1)
    .max(OFFLINE_DENIALS_MAX),
});
export type OfflineDenialsInput = z.input<typeof offlineDenialsSchema>;

export const deviceHeartbeatSchema = z.strictObject({
  health: z.enum(DEVICE_HEALTH),
  errorCode: z.string().trim().max(64).optional(),
});
export type DeviceHeartbeatInput = z.input<typeof deviceHeartbeatSchema>;

export interface DeviceHeartbeatResponse {
  serverTime: string;
  /** Revoked enrollments the device must delete, then confirm (PLAN §6.6). */
  pendingDeletions: { enrollmentId: string; templateRef: string }[];
}

// --- Decisions ------------------------------------------------------------------------------

/**
 * PLAN §6.3 response contract. On denials the member block holds the first name only, and
 * membership details are never included.
 */
export const accessDecisionSchema = z.object({
  decision: z.enum(ACCESS_RESULTS),
  reason: z.enum(ACCESS_REASONS),
  title: z.string(),
  message: z.string(),
  source: z.enum(ACCESS_SOURCES),
  /** null only when even the denial could not be recorded (database unreachable). */
  attemptId: z.uuid().nullable(),
  duplicate: z.boolean(),
  occurredAt: z.string(),
  deviceId: z.uuid().nullable(),
  member: z
    .object({
      firstName: z.string(),
      memberCode: z.string().optional(),
      photoUrl: z.string().nullable().optional(),
    })
    .optional(),
  membership: z.object({ planName: z.string(), endDate: z.string() }).optional(),
});
export type AccessDecision = z.infer<typeof accessDecisionSchema>;

// --- Simulator, monitor and log (staff session routes) --------------------------------------

export const simulateScanSchema = z
  .strictObject({
    deviceId: z.uuid({ error: 'Choose a simulated device' }),
    templateRef: templateRefSchema.optional(),
    scenario: z.enum(SIMULATOR_SCENARIOS).optional(),
  })
  .refine(
    (input) =>
      input.templateRef !== undefined ||
      input.scenario === 'NO_MATCH' ||
      input.scenario === 'SCANNER_UNAVAILABLE',
    { path: ['templateRef'], message: 'Choose a fake fingerprint ID' },
  );
export type SimulateScanInput = z.input<typeof simulateScanSchema>;

export interface SimulatorFixture {
  deviceId: string;
  /** Fake SIM- IDs are not sensitive, so the simulator shows them in full. */
  templateRef: string;
  label: string;
  memberFirstName: string | null;
  /** What a scan would give right now (MEMBER_NOT_RECOGNIZED for the unenrolled fixture). */
  expected: AccessReason;
}

export interface SimulatorFixturesDto {
  devices: AccessDeviceBrief[];
  fixtures: SimulatorFixture[];
}

export const accessStreamQuerySchema = z.strictObject({
  deviceId: z.uuid({ error: 'Choose a device' }),
});

export const accessAttemptListQuerySchema = z.strictObject({
  ...listQueryBase,
  result: z.enum(ACCESS_RESULTS).optional(),
  reason: z.enum(ACCESS_REASONS).optional(),
  source: z.enum(ACCESS_SOURCES).optional(),
  deviceId: z.uuid({ error: 'Invalid device' }).optional(),
  memberId: z.uuid({ error: 'Invalid member' }).optional(),
  /** Inclusive calendar days in gym time. */
  from: optionalIsoDateSchema,
  to: optionalIsoDateSchema,
});
export type AccessAttemptListQuery = z.input<typeof accessAttemptListQuerySchema>;

export interface AccessAttemptDto {
  id: string;
  occurredAt: string;
  receivedAt: string;
  result: AccessResult;
  reason: AccessReason;
  source: AccessSource;
  duplicate: boolean;
  uploadedFromOutbox: boolean;
  device: { id: string; name: string } | null;
  member: { id: string; memberCode: string; firstName: string; lastName: string } | null;
  membershipId: string | null;
  attendanceId: string | null;
  verifiedByName: string | null;
}

// --- Devices --------------------------------------------------------------------------------

export interface AccessDeviceBrief {
  id: string;
  name: string;
  location: string;
  deviceType: DeviceType;
  status: DeviceStatus;
}

export interface AccessDeviceDto extends AccessDeviceBrief {
  vendor: string | null;
  model: string | null;
  serialNumber: string | null;
  lastSeenAt: string | null;
  lastHealth: DeviceHealth | null;
  lastErrorCode: string | null;
  keyRotatedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Returned once, at creation or key rotation. Only the hash is stored. */
export interface AccessDeviceWithKey {
  device: AccessDeviceDto;
  deviceKey: string;
}

const deviceDetails = {
  name: nameSchema,
  location: nameSchema,
  vendor: optionalTextSchema(40),
  model: optionalTextSchema(60),
  serialNumber: optionalTextSchema(60),
};

export const createDeviceSchema = z
  .strictObject({ ...deviceDetails, deviceType: z.enum(DEVICE_TYPES, { error: 'Choose a type' }) })
  .refine(
    (input) =>
      input.deviceType === 'REAL' || (!input.vendor && !input.model && !input.serialNumber),
    { path: ['vendor'], message: 'Vendor, model and serial number apply to real scanners only' },
  );
export type CreateDeviceInput = z.input<typeof createDeviceSchema>;

/** The type is fixed at creation: it decides the source of every attempt and the ref format. */
export const updateDeviceSchema = z
  .strictObject({
    name: deviceDetails.name.optional(),
    location: deviceDetails.location.optional(),
    vendor: deviceDetails.vendor.optional(),
    model: deviceDetails.model.optional(),
    serialNumber: deviceDetails.serialNumber.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'Change at least one field' });
export type UpdateDeviceInput = z.input<typeof updateDeviceSchema>;

export const deviceActionSchema = z.strictObject({ reason: reasonSchema.optional() });
export type DeviceActionInput = z.input<typeof deviceActionSchema>;
