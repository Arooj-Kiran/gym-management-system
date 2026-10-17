import { Router } from 'express';
import { requirePermission } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import * as controller from './plans.controller';

export function plansRoutes() {
  const router = Router();
  router.use(...authenticated);
  router.get('/', requirePermission('plans:read'), controller.list);
  router.post('/', requirePermission('plans:manage'), controller.create);
  router.get('/:id', requirePermission('plans:read'), controller.get);
  router.patch('/:id', requirePermission('plans:manage'), controller.update);
  router.post('/:id/archive', requirePermission('plans:manage'), controller.archive);
  router.post('/:id/unarchive', requirePermission('plans:manage'), controller.unarchive);
  return router;
}
