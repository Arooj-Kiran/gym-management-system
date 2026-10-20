import { Router } from 'express';
import { requireRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { singleImage } from '../../middleware/upload';
import * as controller from './portal.controller';

/** Member portal, /me/*. Scoped to the signed-in member by the session alone. */
export function portalRoutes() {
  const router = Router();
  router.use(...authenticated, requireRole('MEMBER'));
  router.get('/profile', controller.getProfile);
  router.patch('/profile', controller.updateProfile);
  router.post('/profile/photo', ...singleImage('photo'), controller.uploadPhoto);
  router.get('/profile/photo', controller.getPhoto);
  router.get('/membership', controller.getMembership);
  router.get('/memberships', controller.listMemberships);
  router.get('/attendance', controller.listAttendance);
  return router;
}
