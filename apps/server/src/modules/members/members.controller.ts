import {
  accessBlockSchema,
  accessUnblockSchema,
  archiveMemberSchema,
  checkDuplicateQuerySchema,
  createMemberSchema,
  createPortalAccountSchema,
  idParamSchema,
  memberListQuerySchema,
  restoreMemberSchema,
  updateMemberSchema,
} from '@gms/shared';
import type { Request, Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import type { UploadedImage } from '../../middleware/upload';
import { parseInput } from '../../middleware/validate';
import { assertCanReadMember, memberReadScope } from './members.policy';
import * as membersService from './members.service';

const memberId = (req: Request) => parseInput(idParamSchema, req.params).id;
const scopeOf = (req: Request) => memberReadScope(requireAuthContext(req));

export async function list(req: Request, res: Response) {
  const query = parseInput(memberListQuerySchema, req.query);
  res.json(await membersService.listMembers(query, scopeOf(req)));
}

export async function checkDuplicate(req: Request, res: Response) {
  const query = parseInput(checkDuplicateQuerySchema, req.query);
  res.json(await membersService.checkDuplicates(query));
}

export async function get(req: Request, res: Response) {
  res.json(await membersService.getMember(memberId(req), scopeOf(req)));
}

export async function create(req: Request, res: Response) {
  const input = parseInput(createMemberSchema, req.body);
  res.status(201).json(await membersService.createMember(input, requestContext(req)));
}

export async function update(req: Request, res: Response) {
  const id = memberId(req);
  const input = parseInput(updateMemberSchema, req.body);
  res.json(await membersService.updateMember(id, input, requestContext(req)));
}

export async function archive(req: Request, res: Response) {
  const id = memberId(req);
  const { reason } = parseInput(archiveMemberSchema, req.body);
  res.json(await membersService.archiveMember(id, reason, requestContext(req)));
}

export async function restore(req: Request, res: Response) {
  const id = memberId(req);
  const { reason } = parseInput(restoreMemberSchema, req.body);
  res.json(await membersService.restoreMember(id, reason, requestContext(req)));
}

export async function uploadPhoto(req: Request, res: Response) {
  const id = memberId(req);
  const image = res.locals.image as UploadedImage;
  res.json(await membersService.replacePhoto(id, image, requestContext(req)));
}

export async function getPhoto(req: Request, res: Response) {
  const id = memberId(req);
  assertCanReadMember(scopeOf(req), id);
  sendImage(res, await membersService.readPhoto(id));
}

export function sendImage(res: Response, image: { data: Buffer; mime: string }) {
  // Private: photos are personal data and must not sit in shared caches.
  res.set('Cache-Control', 'private, max-age=86400');
  res.type(image.mime).send(image.data);
}

export async function createPortalAccount(req: Request, res: Response) {
  const id = memberId(req);
  const { temporaryPassword } = parseInput(createPortalAccountSchema, req.body);
  res
    .status(201)
    .json(await membersService.createPortalAccount(id, temporaryPassword, requestContext(req)));
}

export async function blockAccess(req: Request, res: Response) {
  const id = memberId(req);
  const { reason } = parseInput(accessBlockSchema, req.body);
  res.json(await membersService.setAccessBlocked(id, true, reason, requestContext(req)));
}

export async function unblockAccess(req: Request, res: Response) {
  const id = memberId(req);
  const { reason } = parseInput(accessUnblockSchema, req.body);
  res.json(await membersService.setAccessBlocked(id, false, reason, requestContext(req)));
}
