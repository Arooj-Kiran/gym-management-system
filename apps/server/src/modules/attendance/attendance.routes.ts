import {
  accessAttemptListQuerySchema,
  attendanceCorrectionSchema,
  attendanceListQuerySchema,
  idParamSchema,
  manualCheckInSchema,
} from '@gms/shared';
import { Router, type Request, type Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import { decide } from '../access/access-decision.service';
import type { AccessSettings } from '../access/access-settings';
import { listAttempts } from '../access/access.service';
import { assertCanReadAttendanceOf, attendanceReadScope } from './attendance.policy';
import * as attendanceService from './attendance.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const scopeOf = (req: Request) => attendanceReadScope(requireAuthContext(req));

export function attendanceRoutes(settings: AccessSettings) {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  /** Same decision service as a scan, source MANUAL. Always 200 with the decision body. */
  router.post(
    '/manual-check-in',
    requirePermission('attendance:manual-check-in'),
    async (req, res) => {
      const { memberId, reason } = parseInput(manualCheckInSchema, req.body);
      res.json(await decide({ kind: 'manual', memberId, reason, ctx: requestContext(req) }, settings));
    },
  );

  router.get('/', requirePermission('attendance:read'), async (req, res) => {
    const query = parseInput(attendanceListQuerySchema, req.query);
    const scope = scopeOf(req);
    if (query.memberId) assertCanReadAttendanceOf(scope, query.memberId);
    res.json(await attendanceService.listAttendance(query, scope));
  });

  router.get('/today', requirePermission('attendance:read'), async (req, res) => {
    const query = parseInput(attendanceListQuerySchema, req.query);
    const scope = scopeOf(req);
    if (query.memberId) assertCanReadAttendanceOf(scope, query.memberId);
    res.json(await attendanceService.listToday(query, scope));
  });

  router.post('/:id/check-out', requirePermission('attendance:check-out'), async (req, res) => {
    res.json(await attendanceService.checkOut(idOf(req)));
  });

  router.post('/:id/corrections', requirePermission('attendance:correct'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(attendanceCorrectionSchema, req.body);
    res.json(await attendanceService.correctAttendance(id, input, requestContext(req)));
  });

  router.get('/:id/corrections', requirePermission('attendance:read'), async (req, res) => {
    const id = idOf(req);
    // 404 for an unknown record, 403 when its member is out of scope.
    assertCanReadAttendanceOf(scopeOf(req), await attendanceService.attendanceMemberId(id));
    res.json({ data: await attendanceService.listCorrections(id) });
  });

  return router;
}

/** GET /members/:id/attendance */
export async function listForMember(req: Request, res: Response) {
  const memberId = idOf(req);
  const scope = scopeOf(req);
  assertCanReadAttendanceOf(scope, memberId);
  const query = parseInput(attendanceListQuerySchema, req.query);
  res.json(await attendanceService.listAttendance(query, scope, { memberId }));
}

/** GET /members/:id/access-attempts */
export async function attemptsForMember(req: Request, res: Response) {
  const memberId = idOf(req);
  assertCanReadAttendanceOf(scopeOf(req), memberId);
  const query = parseInput(accessAttemptListQuerySchema, req.query);
  res.json(await listAttempts(query, { memberId }));
}
