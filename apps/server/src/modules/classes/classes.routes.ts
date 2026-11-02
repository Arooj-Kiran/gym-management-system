import {
  cancelClassSessionSchema,
  classListQuerySchema,
  classSessionListQuerySchema,
  createBookingSchema,
  createClassSchema,
  createClassSessionSchema,
  idParamSchema,
  markClassAttendanceSchema,
  updateClassSchema,
  updateClassSessionSchema,
} from '@gms/shared';
import { Router, type Request } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as bookings from './bookings.service';
import * as classes from './classes.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;

/** /classes — class templates (PLAN §4.7). */
export function classesRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('classes:read'), async (req, res) => {
    const query = parseInput(classListQuerySchema, req.query);
    res.json({ data: await classes.listClasses(query) });
  });
  router.get('/:id', requirePermission('classes:read'), async (req, res) => {
    res.json(await classes.getClass(idOf(req)));
  });
  router.post('/', requirePermission('classes:manage'), async (req, res) => {
    const input = parseInput(createClassSchema, req.body);
    res.status(201).json(await classes.createClass(input, requestContext(req)));
  });
  router.patch('/:id', requirePermission('classes:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateClassSchema, req.body);
    res.json(await classes.updateClass(id, input, requestContext(req)));
  });
  router.post('/:id/archive', requirePermission('classes:manage'), async (req, res) => {
    res.json(await classes.archiveClass(idOf(req), requestContext(req)));
  });

  return router;
}

/** /class-sessions — scheduled occurrences and their rosters. */
export function classSessionsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.get('/', requirePermission('classes:read'), async (req, res) => {
    const query = parseInput(classSessionListQuerySchema, req.query);
    res.json({ data: await classes.listSessions(query) });
  });
  router.get('/:id', requirePermission('classes:read'), async (req, res) => {
    res.json(await classes.getSession(idOf(req)));
  });
  router.post('/', requirePermission('classes:manage'), async (req, res) => {
    const input = parseInput(createClassSessionSchema, req.body);
    res.status(201).json({ data: await classes.createSessions(input, requestContext(req)) });
  });
  router.patch('/:id', requirePermission('classes:manage'), async (req, res) => {
    const id = idOf(req);
    const input = parseInput(updateClassSessionSchema, req.body);
    res.json(await classes.updateSession(id, input, requestContext(req)));
  });
  router.post('/:id/cancel', requirePermission('classes:manage'), async (req, res) => {
    const id = idOf(req);
    const { reason } = parseInput(cancelClassSessionSchema, req.body ?? {});
    res.json(await classes.cancelSession(id, reason, requestContext(req)));
  });
  router.get('/:id/bookings', requirePermission('bookings:read'), async (req, res) => {
    res.json({ data: await bookings.listSessionBookings(idOf(req), requireAuthContext(req)) });
  });
  router.post('/:id/bookings', requirePermission('bookings:manage'), async (req, res) => {
    const id = idOf(req);
    const { memberId } = parseInput(createBookingSchema, req.body);
    res
      .status(201)
      .json(await bookings.bookSession(id, memberId, { kind: 'staff' }, requestContext(req)));
  });

  return router;
}

/** /bookings — cancel a place or mark class attendance. */
export function bookingsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole);

  router.post('/:id/cancel', requirePermission('bookings:manage'), async (req, res) => {
    res.json(await bookings.cancelBooking(idOf(req), { kind: 'staff' }, requestContext(req)));
  });
  router.post('/:id/attendance', requirePermission('classes:mark-attendance'), async (req, res) => {
    const id = idOf(req);
    const { status } = parseInput(markClassAttendanceSchema, req.body);
    res.json(
      await bookings.markAttendance(id, status, requireAuthContext(req), requestContext(req)),
    );
  });

  return router;
}
