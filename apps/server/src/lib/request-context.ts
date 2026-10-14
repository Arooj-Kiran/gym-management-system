import type { Role } from '@gms/shared';
import type { Request } from 'express';
import { unauthenticated } from './errors';

/** Who did something, and from where — attached to every audit row. */
export interface RequestContext {
  actorUserId: string | null;
  actorRole: Role | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    actorUserId: req.auth?.user.id ?? null,
    actorRole: req.auth?.user.role ?? null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
    requestId: String(req.id),
  };
}

export function requireAuthContext(req: Request): Express.AuthContext {
  if (!req.auth) throw unauthenticated();
  return req.auth;
}
