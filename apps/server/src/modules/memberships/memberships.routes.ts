import { Router } from 'express';
import { requirePermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import * as controller from './memberships.controller';

/** Staff routes. Members read their own memberships through /me (PLAN §4.10). */
export function membershipsRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole, requirePermission('memberships:read'));
  router.get('/', controller.list);
  router.post('/', requirePermission('memberships:assign'), controller.assign);
  router.get('/:id', controller.get);
  router.get('/:id/events', controller.events);
  router.post('/:id/activate', requirePermission('memberships:activate'), controller.activate);
  router.post('/:id/renew', requirePermission('memberships:renew'), controller.renew);
  router.post('/:id/extend', requirePermission('memberships:change-status'), controller.extend);
  router.post('/:id/suspend', requirePermission('memberships:change-status'), controller.suspend);
  router.post(
    '/:id/reactivate',
    requirePermission('memberships:change-status'),
    controller.reactivate,
  );
  router.post('/:id/cancel', requirePermission('memberships:change-status'), controller.cancel);
  return router;
}
