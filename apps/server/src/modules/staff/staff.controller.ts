import {
  activateStaffSchema,
  changeRoleSchema,
  createStaffSchema,
  deactivateStaffSchema,
  idParamSchema,
  resetPasswordSchema,
  staffListQuerySchema,
  updateStaffSchema,
} from '@gms/shared';
import type { Request, Response } from 'express';
import { requestContext } from '../../lib/request-context';
import { parseInput } from '../../middleware/validate';
import * as staffService from './staff.service';

const staffId = (req: Request) => parseInput(idParamSchema, req.params).id;

export async function list(req: Request, res: Response) {
  res.json(await staffService.listStaff(parseInput(staffListQuerySchema, req.query)));
}

export async function get(req: Request, res: Response) {
  res.json(await staffService.getStaff(staffId(req)));
}

export async function create(req: Request, res: Response) {
  const input = parseInput(createStaffSchema, req.body);
  res.status(201).json(await staffService.createStaff(input, requestContext(req)));
}

export async function update(req: Request, res: Response) {
  const id = staffId(req);
  const input = parseInput(updateStaffSchema, req.body);
  res.json(await staffService.updateStaff(id, input, requestContext(req)));
}

export async function changeRole(req: Request, res: Response) {
  const id = staffId(req);
  const { role, reason } = parseInput(changeRoleSchema, req.body);
  res.json(await staffService.changeRole(id, role, reason, requestContext(req)));
}

export async function activate(req: Request, res: Response) {
  const id = staffId(req);
  const { reason } = parseInput(activateStaffSchema, req.body);
  res.json(await staffService.setActive(id, true, reason, requestContext(req)));
}

export async function deactivate(req: Request, res: Response) {
  const id = staffId(req);
  const { reason } = parseInput(deactivateStaffSchema, req.body);
  res.json(await staffService.setActive(id, false, reason, requestContext(req)));
}

export async function resetPassword(req: Request, res: Response) {
  const id = staffId(req);
  const { temporaryPassword } = parseInput(resetPasswordSchema, req.body);
  res.json(await staffService.resetPassword(id, temporaryPassword, requestContext(req)));
}
