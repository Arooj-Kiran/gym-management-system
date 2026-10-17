import {
  activateMembershipSchema,
  assignMembershipSchema,
  cancelMembershipSchema,
  extendMembershipSchema,
  idParamSchema,
  membershipListQuerySchema,
  reactivateMembershipSchema,
  renewMembershipSchema,
  suspendMembershipSchema,
} from '@gms/shared';
import type { Request, Response } from 'express';
import { requestContext, requireAuthContext } from '../../lib/request-context';
import { parseInput } from '../../middleware/validate';
import { assertCanReadMembershipsOf, membershipReadScope } from './memberships.policy';
import * as membershipsService from './memberships.service';

const idOf = (req: Request) => parseInput(idParamSchema, req.params).id;
const scopeOf = (req: Request) => membershipReadScope(requireAuthContext(req));

/** Object-level check for a single membership: the caller must be able to see its member. */
async function readableId(req: Request) {
  const id = idOf(req);
  const scope = scopeOf(req);
  if (scope.kind !== 'all') {
    assertCanReadMembershipsOf(scope, await membershipsService.membershipMemberId(id));
  }
  return id;
}

export async function list(req: Request, res: Response) {
  const query = parseInput(membershipListQuerySchema, req.query);
  res.json(await membershipsService.listMemberships(query, scopeOf(req)));
}

export async function get(req: Request, res: Response) {
  res.json(await membershipsService.getMembership(await readableId(req)));
}

export async function events(req: Request, res: Response) {
  res.json({ data: await membershipsService.listMembershipEvents(await readableId(req)) });
}

/** GET /members/:id/memberships */
export async function listForMember(req: Request, res: Response) {
  const memberId = idOf(req);
  assertCanReadMembershipsOf(scopeOf(req), memberId);
  res.json({ data: await membershipsService.listMemberMemberships(memberId) });
}

/** GET /members/:id/membership-events */
export async function eventsForMember(req: Request, res: Response) {
  const memberId = idOf(req);
  assertCanReadMembershipsOf(scopeOf(req), memberId);
  res.json({ data: await membershipsService.listMemberMembershipEvents(memberId) });
}

export async function assign(req: Request, res: Response) {
  const input = parseInput(assignMembershipSchema, req.body);
  res.status(201).json(await membershipsService.assignMembership(input, requestContext(req)));
}

export async function activate(req: Request, res: Response) {
  const id = idOf(req);
  const input = parseInput(activateMembershipSchema, req.body ?? {});
  res.json(await membershipsService.activateMembership(id, input, requestContext(req)));
}

export async function renew(req: Request, res: Response) {
  const id = idOf(req);
  const input = parseInput(renewMembershipSchema, req.body ?? {});
  res.status(201).json(await membershipsService.renewMembership(id, input, requestContext(req)));
}

export async function extend(req: Request, res: Response) {
  const id = idOf(req);
  const input = parseInput(extendMembershipSchema, req.body);
  res.json(await membershipsService.extendMembership(id, input, requestContext(req)));
}

export async function suspend(req: Request, res: Response) {
  const id = idOf(req);
  const input = parseInput(suspendMembershipSchema, req.body);
  res.json(await membershipsService.suspendMembership(id, input, requestContext(req)));
}

export async function reactivate(req: Request, res: Response) {
  const id = idOf(req);
  const input = parseInput(reactivateMembershipSchema, req.body);
  res.json(await membershipsService.reactivateMembership(id, input, requestContext(req)));
}

export async function cancel(req: Request, res: Response) {
  const id = idOf(req);
  const input = parseInput(cancelMembershipSchema, req.body);
  res.json(await membershipsService.cancelMembership(id, input, requestContext(req)));
}
