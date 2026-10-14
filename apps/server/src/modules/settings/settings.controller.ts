import { updateSettingsSchema } from '@gms/shared';
import type { Request, Response } from 'express';
import { requestContext } from '../../lib/request-context';
import { parseInput } from '../../middleware/validate';
import * as settingsService from './settings.service';

export async function get(_req: Request, res: Response) {
  res.json(await settingsService.getSettings());
}

export async function update(req: Request, res: Response) {
  const input = parseInput(updateSettingsSchema, req.body);
  res.json(await settingsService.updateSettings(input, requestContext(req)));
}
