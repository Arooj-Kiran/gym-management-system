import { Router } from 'express';
import { requirePermission } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import * as controller from './dashboard.controller';

export function dashboardRoutes() {
  const router = Router();
  router.use(...authenticated, requirePermission('dashboard:read'));
  router.get('/summary', controller.summary);
  router.get('/activity', controller.activity);
  return router;
}
