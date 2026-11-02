import {
  appointmentListQuerySchema,
  createAppointmentSchema,
  idParamSchema,
  optionalReasonBodySchema,
  updateAppointmentSchema,
} from '@gms/shared';
import { Router, type Request, type Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as appointments from './appointments.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** /appointments — personal training (PLAN §4.7). Members use /me/appointments. */
export function appointmentsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('appointments:read'), async (req, res) => {
    const query = parseInput(appointmentListQuerySchema, req.query);
    res.json(await appointments.listAppointments(query, requireAuthContext(req)));
  });
  router.get('/:id', requirePermission('appointments:read'), async (req, res) => {
    res.json(await appointments.getAppointment(idOf(req), requireAuthContext(req)));
  });
  router.post('/', requirePermission('appointments:manage'), async (req, res) => {
    const input = parseInput(createAppointmentSchema, req.body);
    res
      .status(201)
      .json(
        await appointments.createAppointment(input, requireAuthContext(req), requestContext(req)),
      );
  });
  router.patch('/:id', requirePermission('appointments:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateAppointmentSchema, req.body);
    res.json(
      await appointments.updateAppointment(id, input, requireAuthContext(req), requestContext(req)),
    );
  });

  const statusAction = (status: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW') =>
    async function (req: Request, res: Response) {
      const id = idOf(req);
      const { reason } = parseInput(optionalReasonBodySchema, req.body ?? {});
      res.json(
        await appointments.setAppointmentStatus(
          id,
          status,
          { kind: 'staff', auth: requireAuthContext(req) },
          reason,
          requestContext(req),
        ),
      );
    };
  router.post('/:id/cancel', requirePermission('appointments:manage'), statusAction('CANCELLED'));
  router.post('/:id/complete', requirePermission('appointments:manage'), statusAction('COMPLETED'));
  router.post('/:id/no-show', requirePermission('appointments:manage'), statusAction('NO_SHOW'));

  return router;
}
