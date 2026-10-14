import { auditListQuerySchema } from '@gms/shared';
import type { Request, Response } from 'express';
import { parseInput } from '../../middleware/validate';
import * as auditService from './audit.service';

export async function list(req: Request, res: Response) {
  res.json(await auditService.listAuditLogs(parseInput(auditListQuerySchema, req.query)));
}
