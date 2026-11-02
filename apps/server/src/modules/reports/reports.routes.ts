import { reportQuerySchema, reportTypeParamSchema } from '@gms/shared';
import { Router } from 'express';
import { requireAuthContext } from '../../lib/request-context';
import { createReportLimiter, type RateLimitOptions } from '../../middleware/rate-limits';
import { requireAnyPermission, requireStaffRole } from '../../middleware/require-permission';
import { authenticated } from '../../middleware/session';
import { parseInput } from '../../middleware/validate';
import * as reports from './reports.service';

/**
 * /reports/:type?from=&to=&interval=&format=json|csv (PLAN §4.9). The route admits anyone with a
 * reports permission; the service checks the one the report type needs, and its scope.
 */
export function reportsRoutes(limits: RateLimitOptions) {
  const router = Router();
  router.use(
    ...authenticated,
    requireStaffRole,
    requireAnyPermission('reports:operational', 'reports:financial'),
    createReportLimiter(limits),
  );
  router.get('/:type', async (req, res) => {
    const { role } = requireAuthContext(req).user;
    const { type } = parseInput(reportTypeParamSchema, req.params);
    reports.assertCanView(role, type);
    const { format, ...period } = parseInput(reportQuerySchema, req.query);
    const report = await reports.runReport(role, type, reports.periodOf(period));
    // Reports hold member names and money: never kept by the browser or a proxy.
    res.setHeader('Cache-Control', 'no-store');
    if (format === 'csv') {
      const csv = reports.reportCsv(report);
      res.attachment(csv.filename);
      res.type('text/csv; charset=utf-8').send(csv.body);
      return;
    }
    res.json(report);
  });
  return router;
}
