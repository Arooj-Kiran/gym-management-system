import {
  createShiftSchema,
  idParamSchema,
  optionalReasonBodySchema,
  shiftListQuerySchema,
  updateShiftSchema,
} from '@gms/shared';
import { Router, type Request } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as shifts from './schedules.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** /shifts — staff shift schedules (PLAN §4.7). */
export function shiftsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('schedules:read'), async (req, res) => {
    const query = parseInput(shiftListQuerySchema, req.query);
    res.json({ data: await shifts.listShifts(query, requireAuthContext(req)) });
  });

  router.post('/', requirePermission('schedules:manage'), async (req, res) => {
    const input = parseInput(createShiftSchema, req.body);
    res.status(201).json(await shifts.createShift(input, requestContext(req)));
  });

  router.patch('/:id', requirePermission('schedules:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateShiftSchema, req.body);
    res.json(await shifts.updateShift(id, input, requestContext(req)));
  });

  router.post('/:id/cancel', requirePermission('schedules:manage'), async (req, res) => {
    const id = idOf(req);
    const { reason } = parseInput(optionalReasonBodySchema, req.body ?? {});
    res.json(await shifts.cancelShift(id, reason, requestContext(req)));
  });

  return router;
}
