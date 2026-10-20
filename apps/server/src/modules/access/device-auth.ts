import { ERROR_CODES } from '@gms/shared';
import { eq } from 'drizzle-orm';
import type { Request, RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { db } from '../../db/client';
import { accessDevices } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { safeEqual, sha256Hex } from '../../lib/tokens';

export type AccessDevice = typeof accessDevices.$inferSelect;

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireDevice` on routes the biometric agent calls. */
      device?: AccessDevice;
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `Authorization: Device <deviceId>.<secret>` (PLAN §6.2). */
export function parseDeviceAuthorization(
  header: string | undefined,
): { deviceId: string; secret: string } | null {
  const match = /^Device ([^.\s]+)\.(\S+)$/.exec(header?.trim() ?? '');
  if (!match || !UUID.test(match[1]!)) return null;
  return { deviceId: match[1]!.toLowerCase(), secret: match[2]! };
}

export type DeviceAuthResult =
  | { ok: true; device: AccessDevice }
  /** `device` is set when the claimed device exists (bad key or disabled), so the attempt can name it. */
  | { ok: false; device: AccessDevice | null };

export async function authenticateDevice(header: string | undefined): Promise<DeviceAuthResult> {
  const credentials = parseDeviceAuthorization(header);
  if (!credentials) return { ok: false, device: null };
  const [device] = await db
    .select()
    .from(accessDevices)
    .where(eq(accessDevices.id, credentials.deviceId))
    .limit(1);
  if (!device) return { ok: false, device: null };
  const keyMatches = safeEqual(sha256Hex(credentials.secret), device.apiKeyHash);
  if (!keyMatches || device.status !== 'ACTIVE') return { ok: false, device };
  return { ok: true, device };
}

export const deviceNotAuthorized = () =>
  new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Device not authorized.');

/** For the agent's non-scan calls (heartbeat, outbox upload, deletion confirmation). */
export const requireDevice: RequestHandler = async (req, _res, next) => {
  const result = await authenticateDevice(req.get('authorization'));
  if (!result.ok) throw deviceNotAuthorized();
  req.device = result.device;
  next();
};

/** Per claimed device (falling back to the caller's IP), so one noisy scanner cannot starve others. */
function deviceKey(req: Request) {
  const claimed = parseDeviceAuthorization(req.get('authorization'));
  return claimed ? `device:${claimed.deviceId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

export function createDeviceRateLimiter(perMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: deviceKey,
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests from this device.' },
      });
    },
  });
}
