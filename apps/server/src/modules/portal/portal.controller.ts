import { updateMyProfileSchema } from '@gms/shared';
import type { Request, Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import type { UploadedImage } from '../../middleware/upload';
import { parseInput } from '../../middleware/validate';
import { sendImage } from '../members/members.controller';
import * as portalService from './portal.service';

const userId = (req: Request) => requireAuthContext(req).user.id;

export async function getProfile(req: Request, res: Response) {
  res.json(await portalService.getMyProfile(userId(req)));
}

export async function updateProfile(req: Request, res: Response) {
  const input = parseInput(updateMyProfileSchema, req.body);
  res.json(await portalService.updateMyProfile(userId(req), input, requestContext(req)));
}

export async function uploadPhoto(req: Request, res: Response) {
  const image = res.locals.image as UploadedImage;
  res.json(await portalService.replaceMyPhoto(userId(req), image, requestContext(req)));
}

export async function getPhoto(req: Request, res: Response) {
  sendImage(res, await portalService.readMyPhoto(userId(req)));
}
