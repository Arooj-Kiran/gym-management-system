import {
  type Permission,
  assignmentListQuerySchema,
  availableSlotsQuerySchema,
  createAssignmentSchema,
  createTimeOffSchema,
  idParamSchema,
  optionalReasonBodySchema,
  scheduleQuerySchema,
  setAvailabilitySchema,
  updateTrainerProfileSchema,
} from '@gms/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as trainers from './trainers.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const reasonOf = (req: Request) => parseInput(optionalReasonBodySchema, req.body ?? {}).reason;

/** A trainer (OWN scope) is refused another trainer's record before the body is even read. */
const selfWhenOwn =
  (permission: Permission) => (req: Request, _res: Response, next: NextFunction) => {
    trainers.assertSelfWhenOwn(requireAuthContext(req), permission, idOf(req));
    next();
  };

/** Staff routes (PLAN §4.7). Members see trainers through /me/trainers. */
export function trainersRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('trainers:read'), async (_req, res) => {
    res.json({ data: await trainers.listTrainers() });
  });

  router.get('/:id', requirePermission('trainers:read'), async (req, res) => {
    res.json(await trainers.getTrainer(idOf(req)));
  });

  router.patch(
    '/:id',
    requirePermission('trainers:manage'),
    selfWhenOwn('trainers:manage'),
    async (req, res) => {
      const id = idOf(req);
      const input = parseInput(updateTrainerProfileSchema, req.body);
      res.json(
        await trainers.updateProfile(id, input, requireAuthContext(req), requestContext(req)),
      );
    },
  );

  router.get('/:id/availability', requirePermission('trainers:read'), async (req, res) => {
    res.json(await trainers.getAvailability(idOf(req)));
  });

  router.put(
    '/:id/availability',
    requirePermission('trainers:manage-availability'),
    selfWhenOwn('trainers:manage-availability'),
    async (req, res) => {
      const id = idOf(req);
      const input = parseInput(setAvailabilitySchema, req.body);
      res.json(
        await trainers.setAvailability(id, input, requireAuthContext(req), requestContext(req)),
      );
    },
  );

  router.post(
    '/:id/time-off',
    requirePermission('trainers:manage-availability'),
    selfWhenOwn('trainers:manage-availability'),
    async (req, res) => {
      const id = idOf(req);
      const input = parseInput(createTimeOffSchema, req.body);
      res
        .status(201)
        .json(await trainers.addTimeOff(id, input, requireAuthContext(req), requestContext(req)));
    },
  );

  router.get('/:id/schedule', requirePermission('trainers:read'), async (req, res) => {
    const id = idOf(req);
    const query = parseInput(scheduleQuerySchema, req.query);
    res.json({ data: await trainers.getSchedule(id, query, requireAuthContext(req)) });
  });

  router.get(
    '/:id/available-slots',
    requirePermission('appointments:read'),
    selfWhenOwn('appointments:read'),
    async (req, res) => {
      const id = idOf(req);
      const query = parseInput(availableSlotsQuerySchema, req.query);
      res.json({ data: await trainers.availableSlots(id, query, requireAuthContext(req)) });
    },
  );

  router.get(
    '/:id/members',
    requirePermission('trainer-assignments:read'),
    selfWhenOwn('trainer-assignments:read'),
    async (req, res) => {
      res.json({ data: await trainers.listTrainerMembers(idOf(req), requireAuthContext(req)) });
    },
  );

  return router;
}

/** /time-off/:id/cancel */
export function timeOffRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole, requirePermission('trainers:manage-availability'));
  router.post('/:id/cancel', async (req, res) => {
    const id = idOf(req);
    res.json(
      await trainers.cancelTimeOff(id, reasonOf(req), requireAuthContext(req), requestContext(req)),
    );
  });
  return router;
}

/** /trainer-assignments */
export function trainerAssignmentRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);
  router.get('/', requirePermission('trainer-assignments:read'), async (req, res) => {
    const query = parseInput(assignmentListQuerySchema, req.query);
    res.json({ data: await trainers.listAssignments(query, requireAuthContext(req)) });
  });
  router.post('/', requirePermission('trainer-assignments:manage'), async (req, res) => {
    const input = parseInput(createAssignmentSchema, req.body);
    res.status(201).json(await trainers.createAssignment(input, requestContext(req)));
  });
  router.post('/:id/end', requirePermission('trainer-assignments:manage'), async (req, res) => {
    res.json(await trainers.endAssignment(idOf(req), reasonOf(req), requestContext(req)));
  });
  return router;
}
