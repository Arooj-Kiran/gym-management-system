import { Router } from 'express';
import { requirePermission } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import * as controller from './settings.controller';

export function settingsRoutes() {
  const router = Router();
  router.use(...authenticated);
  router.get('/', requirePermission('settings:read'), controller.get);
  router.patch('/', requirePermission('settings:manage'), controller.update);
  return router;
}
