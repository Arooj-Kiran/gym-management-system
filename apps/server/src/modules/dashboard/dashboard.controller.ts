import type { Request, Response } from 'express';
import { requireAuthContext } from '../../lib/request-context';
import * as dashboardService from './dashboard.service';

const roleOf = (req: Request) => requireAuthContext(req).user.role;

export async function summary(req: Request, res: Response) {
  res.json(await dashboardService.getSummary(roleOf(req)));
}

export async function activity(req: Request, res: Response) {
  res.json(await dashboardService.getActivity(roleOf(req)));
}
