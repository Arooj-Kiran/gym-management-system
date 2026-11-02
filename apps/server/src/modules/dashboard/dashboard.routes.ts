import { Router } from 'express';
import { createReportLimiter, type RateLimitOptions } from '../../middleware/rate-limits';
import { requirePermission } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import * as controller from './dashboard.controller';

export function dashboardRoutes(limits: RateLimitOptions) {
  const router = Router();
  router.use(...authenticated, requirePermission('dashboard:read'));
  router.get('/summary', controller.summary);
  router.get('/activity', controller.activity);
  // The charts run the same grouped queries as the reports, so they share its rate limit.
  const charts = createReportLimiter(limits);
  router.get(
    '/charts/revenue',
    requirePermission('reports:financial'),
    charts,
    controller.revenueChart,
  );
  router.get(
    '/charts/attendance',
    requirePermission('reports:operational'),
    charts,
    controller.attendanceChart,
  );
  return router;
}
