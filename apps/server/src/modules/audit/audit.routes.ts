import { Router } from 'express';
import { requirePermission } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import * as controller from './audit.controller';

export function auditRoutes() {
  const router = Router();
  router.use(...authenticated);
  router.get('/', requirePermission('audit:read'), controller.list);
  return router;
}
