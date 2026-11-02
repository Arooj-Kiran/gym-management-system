import { Router } from 'express';
import {
  requireAnyPermission,
  requirePermission,
  requireStaffRole,
} from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { singleImage } from '../../middleware/upload';
import * as attendance from '../attendance/attendance.routes';
import * as billing from '../billing/billing.routes';
import * as biometrics from '../biometrics/biometrics.routes';
import * as membershipsController from '../memberships/memberships.controller';
import * as workouts from '../workouts/workouts.routes';
import * as controller from './members.controller';

/** Staff routes. Members read themselves through /me and get 403 here (PLAN §4.10). */
export function membersRoutes() {
  const router = Router();
  router.use(...authenticated, requireStaffRole, requirePermission('members:read'));
  router.get('/', controller.list);
  router.get(
    '/check-duplicate',
    requireAnyPermission('members:create', 'members:update'),
    controller.checkDuplicate,
  );
  router.post('/', requirePermission('members:create'), controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', requirePermission('members:update'), controller.update);
  router.post('/:id/archive', requirePermission('members:archive'), controller.archive);
  router.post('/:id/restore', requirePermission('members:archive'), controller.restore);
  router.post(
    '/:id/photo',
    requirePermission('members:update'),
    ...singleImage('photo'),
    controller.uploadPhoto,
  );
  router.get('/:id/photo', controller.getPhoto);
  router.get(
    '/:id/memberships',
    requirePermission('memberships:read'),
    membershipsController.listForMember,
  );
  router.get(
    '/:id/membership-events',
    requirePermission('memberships:read'),
    membershipsController.eventsForMember,
  );
  router.post(
    '/:id/portal-account',
    requirePermission('members:update'),
    controller.createPortalAccount,
  );
  router.post('/:id/access-block', requirePermission('access:restrict'), controller.blockAccess);
  router.post(
    '/:id/access-unblock',
    requirePermission('access:restrict'),
    controller.unblockAccess,
  );
  router.get('/:id/invoices', requirePermission('payments:read'), billing.invoicesForMember);
  router.get('/:id/payments', requirePermission('payments:read'), billing.paymentsForMember);
  router.get('/:id/attendance', requirePermission('attendance:read'), attendance.listForMember);
  router.get(
    '/:id/access-attempts',
    requirePermission('attendance:read'),
    attendance.attemptsForMember,
  );
  router.get(
    '/:id/biometric',
    requirePermission('biometrics:read-status'),
    biometrics.statusForMember,
  );
  router.post(
    '/:id/biometric/consent',
    requirePermission('biometrics:manage'),
    biometrics.giveConsent,
  );
  router.post(
    '/:id/biometric/consent/withdraw',
    requirePermission('biometrics:manage'),
    biometrics.withdrawConsent,
  );
  router.post(
    '/:id/biometric/enrollments',
    requirePermission('biometrics:manage'),
    biometrics.enroll,
  );
  router.get('/:id/progress', requirePermission('progress:read'), workouts.progressForMember);
  router.post(
    '/:id/progress',
    requirePermission('progress:record'),
    workouts.recordProgressForMember,
  );
  return router;
}
