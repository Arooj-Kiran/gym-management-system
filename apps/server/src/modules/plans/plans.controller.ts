import {
  archivePlanSchema,
  createPlanSchema,
  idParamSchema,
  permissionScope,
  planListQuerySchema,
  SCOPES,
  updatePlanSchema,
} from '@gms/shared';
import type { Request, Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { parseInput } from '../../middleware/validate';
import * as plansService from './plans.service';

const planId = (req: Request) => parseInput(idParamSchema, req.params).id;

/** `plans:read` is LIMITED for members: active plans only (PLAN §5). */
const activeOnly = (req: Request) =>
  permissionScope(requireAuthContext(req).user.role, 'plans:read') !== SCOPES.ALL;

export async function list(req: Request, res: Response) {
  const query = parseInput(planListQuerySchema, req.query);
  res.json(await plansService.listPlans(query, activeOnly(req)));
}

export async function get(req: Request, res: Response) {
  res.json(await plansService.getPlan(planId(req), activeOnly(req)));
}

export async function create(req: Request, res: Response) {
  const input = parseInput(createPlanSchema, req.body);
  res.status(201).json(await plansService.createPlan(input, requestContext(req)));
}

export async function update(req: Request, res: Response) {
  const id = planId(req);
  const input = parseInput(updatePlanSchema, req.body);
  res.json(await plansService.updatePlan(id, input, requestContext(req)));
}

export async function archive(req: Request, res: Response) {
  const id = planId(req);
  const { reason } = parseInput(archivePlanSchema, req.body);
  res.json(await plansService.setPlanActive(id, false, reason, requestContext(req)));
}

export async function unarchive(req: Request, res: Response) {
  const id = planId(req);
  const { reason } = parseInput(archivePlanSchema, req.body);
  res.json(await plansService.setPlanActive(id, true, reason, requestContext(req)));
}
