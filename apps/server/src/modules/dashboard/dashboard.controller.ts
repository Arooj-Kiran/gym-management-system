import { dashboardRangeQuerySchema, type DashboardChartDto } from '@gms/shared';
import type { Request, Response } from 'express';
import { requireAuthContext } from '../../lib/request-context';
import { parseInput } from '../../middleware/validate';
import { revenueByBucket } from '../reports/financial-reports';
import { attendanceByBucket } from '../reports/operational-reports';
import { periodOf } from '../reports/reports.service';
import * as dashboardService from './dashboard.service';

const roleOf = (req: Request) => requireAuthContext(req).user.role;
const rangeOf = (req: Request) => periodOf(parseInput(dashboardRangeQuerySchema, req.query));

export async function summary(req: Request, res: Response) {
  const { user } = requireAuthContext(req);
  res.json(await dashboardService.getSummary(user.role, user.id, rangeOf(req)));
}

export async function activity(req: Request, res: Response) {
  res.json(await dashboardService.getActivity(roleOf(req)));
}

export async function revenueChart(req: Request, res: Response) {
  const range = rangeOf(req);
  const { series } = await revenueByBucket(range);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...range, series } satisfies DashboardChartDto);
}

export async function attendanceChart(req: Request, res: Response) {
  const range = rangeOf(req);
  const series = await attendanceByBucket(range);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...range, series } satisfies DashboardChartDto);
}
