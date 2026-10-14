import { Router } from 'express';
import { requirePermission } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import * as controller from './staff.controller';

export function staffRoutes() {
  const router = Router();
  router.use(...authenticated);
  router.get('/', requirePermission('staff:read'), controller.list);
  router.post('/', requirePermission('staff:manage'), controller.create);
  router.get('/:id', requirePermission('staff:read'), controller.get);
  router.patch('/:id', requirePermission('staff:manage'), controller.update);
  router.patch('/:id/role', requirePermission('staff:assign-role'), controller.changeRole);
  router.post('/:id/activate', requirePermission('staff:manage'), controller.activate);
  router.post('/:id/deactivate', requirePermission('staff:manage'), controller.deactivate);
  router.post('/:id/reset-password', requirePermission('staff:manage'), controller.resetPassword);
  return router;
}
