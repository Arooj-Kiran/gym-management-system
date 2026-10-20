import {
  accessAttemptListQuerySchema,
  accessStreamQuerySchema,
  deviceScanSchema,
  offlineDenialsSchema,
  simulateScanSchema,
} from '@gms/shared';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Router, type Request, type Response } from 'express';
import { db } from '../../db/client';
import { accessDevices } from '../../db/schema';
import { notFound } from '../../lib/errors';
import {
  requireAnyPermission,
  requirePermission,
  requireStaffRole,
} from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import {
  decide,
  recordDeviceNotAuthorized,
  recordOfflineDenials,
  sanitizeOccurredAt,
} from './access-decision.service';
import type { AccessSettings } from './access-settings';
import { accessStream } from './access-stream';
import * as accessService from './access.service';
import { authenticateDevice, createDeviceRateLimiter, requireDevice } from './device-auth';

/** Simulator routes do not exist unless BIOMETRIC_SIMULATOR_ENABLED=true (PLAN §6.5). */
const simulatorOnly =
  (settings: AccessSettings) => (_req: Request, _res: Response, next: () => void) => {
    if (!settings.simulatorEnabled) throw notFound('Route');
    next();
  };

export function accessRoutes(settings: AccessSettings) {
  const router = Router();
  const deviceLimiter = createDeviceRateLimiter(settings.scanRateLimitPerMinute);

  // --- Device-key routes (the biometric agent); no session ---------------------------------

  /**
   * 200 for a decision, 503 when membership could not be verified, 401 for an unauthorized
   * device. The body is always a decision, so the agent has one thing to parse.
   */
  router.post('/scan', deviceLimiter, async (req, res) => {
    const auth = await authenticateDevice(req.get('authorization'));
    if (!auth.ok) {
      res.status(401).json(await recordDeviceNotAuthorized(auth.device));
      return;
    }
    const scan = parseInput(deviceScanSchema, req.body);
    const decision = await decide(
      {
        kind: 'device',
        device: auth.device,
        eventId: scan.eventId,
        matchResult: scan.matchResult,
        templateRef: scan.templateRef,
        errorCode: scan.errorCode,
        occurredAt: sanitizeOccurredAt(scan.occurredAt),
      },
      settings,
    );
    res.status(decision.reason === 'AUTHORIZATION_UNAVAILABLE' ? 503 : 200).json(decision);
  });

  router.post('/offline-denials', deviceLimiter, requireDevice, async (req, res) => {
    const { denials } = parseInput(offlineDenialsSchema, req.body);
    res.json(await recordOfflineDenials(req.device!, denials));
  });

  // --- Staff routes --------------------------------------------------------------------------

  router.use(...authenticated, requireStaffRole);

  router.get(
    '/devices',
    requireAnyPermission('access:monitor', 'access:read-log', 'access:simulate'),
    async (_req, res) => {
      res.json({ data: await accessService.listDeviceBriefs() });
    },
  );

  router.get('/attempts', requirePermission('access:read-log'), async (req, res) => {
    const query = parseInput(accessAttemptListQuerySchema, req.query);
    res.json(await accessService.listAttempts(query));
  });

  router.get('/stream', requirePermission('access:monitor'), async (req, res) => {
    const { deviceId } = parseInput(accessStreamQuerySchema, req.query);
    const [device] = await db
      .select({ id: accessDevices.id })
      .from(accessDevices)
      .where(eq(accessDevices.id, deviceId))
      .limit(1);
    if (!device) throw notFound('Device');
    accessStream.open(deviceId, res);
  });

  router.get(
    '/simulator/fixtures',
    requirePermission('access:simulate'),
    simulatorOnly(settings),
    async (_req, res) => {
      res.json(await accessService.simulatorFixtures());
    },
  );

  /**
   * SIMULATED only: the staff panel stands in for the agent of a simulated device and goes through
   * the same decision service. Always 200 with the decision body.
   */
  router.post(
    '/simulate',
    requirePermission('access:simulate'),
    simulatorOnly(settings),
    async (req, res) => {
      const input = parseInput(simulateScanSchema, req.body);
      const [device] = await db
        .select()
        .from(accessDevices)
        .where(eq(accessDevices.id, input.deviceId))
        .limit(1);
      if (!device || device.deviceType !== 'SIMULATED') throw notFound('Simulated device');
      if (device.status !== 'ACTIVE') {
        res.json(await recordDeviceNotAuthorized(device));
        return;
      }
      const decision = await decide(
        {
          kind: 'device',
          device,
          eventId: randomUUID(),
          matchResult:
            input.scenario === 'NO_MATCH'
              ? 'NO_MATCH'
              : input.scenario === 'SCANNER_UNAVAILABLE'
                ? 'DEVICE_ERROR'
                : 'MATCH',
          templateRef: input.scenario === 'NO_MATCH' ? undefined : input.templateRef,
          errorCode: input.scenario === 'SCANNER_UNAVAILABLE' ? 'SIMULATED_SCANNER_ERROR' : undefined,
          occurredAt: new Date(),
          failEligibility: input.scenario === 'AUTHORIZATION_UNAVAILABLE',
        },
        settings,
      );
      res.json(decision);
    },
  );

  return router;
}
