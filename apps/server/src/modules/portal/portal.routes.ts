import { Router } from 'express';
import { requireRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { singleImage } from '../../middleware/upload';
import * as billing from '../billing/billing.routes';
import * as workouts from '../workouts/workouts.routes';
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
  router.get('/invoices', billing.myInvoices);
  router.get('/payments', billing.myPayments);
  router.get('/payments/:id/receipt', billing.myReceipt);
  router.get('/trainers', controller.listTrainers);
  router.get('/schedule', controller.getSchedule);
  router.get('/class-sessions', controller.listClassSessions);
  router.post('/bookings', controller.bookClass);
  router.post('/bookings/:id/cancel', controller.cancelBooking);
  router.get('/appointments', controller.listAppointments);
  router.post('/appointments/:id/cancel', controller.cancelAppointment);
  router.get('/workouts', workouts.myWorkouts);
  router.get('/workout-logs', workouts.myWorkoutLogs);
  router.post('/workout-logs', workouts.logMyWorkout);
  router.get('/progress', workouts.myProgress);
  router.post('/progress', workouts.recordMyProgress);
  router.get('/exercises/:id/image', workouts.myExerciseImage);
  return router;
}
