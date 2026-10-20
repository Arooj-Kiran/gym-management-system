import type { DeviceHealth, DeviceType, MatchResult } from '@gms/shared';

/**
 * PLAN §6.2. One adapter per scanner family. The adapter only reports what the scanner saw;
 * it never decides access. Templates stay on the scanner (or in the vendor SDK), never here.
 */

export interface ScanEvent {
  /** Idempotency key; a retry of the same event reuses it. */
  eventId: string;
  occurredAt: string;
  matchResult: MatchResult;
  /** The device-side user ID on a match. Never an image or a template. */
  templateRef?: string;
  errorCode?: string;
}

export interface ScannerHealth {
  health: DeviceHealth;
  errorCode?: string;
}

export interface ScannerAdapter {
  /** SIMULATED adapters must only ever run against SIMULATED devices. */
  readonly kind: DeviceType;
  start(onEvent: (event: ScanEvent) => void): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<ScannerHealth>;
  /** Enrolls a finger on the scanner and returns the device-side user ID. */
  enroll(memberLabel: string): Promise<string>;
  /** Removes a template from the scanner. Must succeed (or be a no-op) if it is already gone. */
  deleteTemplate(templateRef: string): Promise<void>;
}
