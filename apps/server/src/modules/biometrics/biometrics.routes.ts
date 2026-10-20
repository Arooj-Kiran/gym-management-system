import {
  enrollSchema,
  giveConsentSchema,
  idParamSchema,
  revokeEnrollmentSchema,
  withdrawConsentSchema,
} from '@gms/shared';
import { Router, type Request, type Response } from 'express';
import { requestContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import { requireDevice } from '../access/device-auth';
import * as biometricsService from './biometrics.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** /biometric/enrollments/:id/… */
export function biometricRoutes() {
  const router = Router();

  // The agent confirms a deletion with its device key, not a session.
  router.post('/enrollments/:id/confirm-deletion', requireDevice, async (req, res) => {
    const id = idOf(req);
    res.json(await biometricsService.confirmDeletion(req.device!, id, requestContext(req)));
  });

  router.use(...authenticated, requireStaffRole, requirePermission('biometrics:manage'));
  router.post('/enrollments/:id/revoke', async (req, res) => {
    const id = idOf(req);
    const { reason } = parseInput(revokeEnrollmentSchema, req.body);
    res.json(await biometricsService.revokeEnrollment(id, reason, requestContext(req)));
  });
  return router;
}

// --- /members/:id/biometric… (mounted on the members router) ---------------------------------

export async function statusForMember(req: Request, res: Response) {
  res.json(await biometricsService.getMemberBiometricStatus(idOf(req)));
}

export async function giveConsent(req: Request, res: Response) {
  const memberId = idOf(req);
  parseInput(giveConsentSchema, req.body);
  res.status(201).json(await biometricsService.giveConsent(memberId, requestContext(req)));
}

export async function withdrawConsent(req: Request, res: Response) {
  const memberId = idOf(req);
  const { reason } = parseInput(withdrawConsentSchema, req.body);
  res.json(await biometricsService.withdrawConsent(memberId, reason, requestContext(req)));
}

export async function enroll(req: Request, res: Response) {
  const memberId = idOf(req);
  const input = parseInput(enrollSchema, req.body);
  res.status(201).json(await biometricsService.enroll(memberId, input, requestContext(req)));
}
