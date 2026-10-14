import { hasPermission, type Permission } from '@gms/shared';
import type { RequestHandler } from 'express';
import { forbidden, unauthenticated } from '../lib/errors';

/** Role check against the shared matrix. Object-level scoping (Own/Assigned) happens in services. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw unauthenticated();
    if (!hasPermission(req.auth.user.role, permission)) throw forbidden();
    next();
  };
}
