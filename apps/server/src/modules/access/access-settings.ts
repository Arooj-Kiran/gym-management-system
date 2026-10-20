import { config } from '../../config/env';

/** Access-control tunables. Tests override them through `createApp({ access })`. */
export interface AccessSettings {
  /** Statement timeout for the decision transaction (PLAN §6.3). */
  dbTimeoutMs: number;
  duplicateWindowSeconds: number;
  scanRateLimitPerMinute: number;
  simulatorEnabled: boolean;
}

export function accessSettings(overrides: Partial<AccessSettings> = {}): AccessSettings {
  return {
    dbTimeoutMs: config.accessDbTimeoutMs,
    duplicateWindowSeconds: config.accessDuplicateWindowSeconds,
    scanRateLimitPerMinute: config.accessScanRateLimitPerMinute,
    simulatorEnabled: config.biometricSimulatorEnabled,
    ...overrides,
  };
}
