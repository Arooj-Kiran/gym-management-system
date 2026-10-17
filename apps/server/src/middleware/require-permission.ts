import { hasPermission, isStaffRole, type Permission, type Role } from '@gms/shared';
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

/** Allowed when the role holds any one of the permissions. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw unauthenticated();
    const role = req.auth.user.role;
    if (!permissions.some((permission) => hasPermission(role, permission))) throw forbidden();
    next();
  };
}

/** For /me/* routes, which exist only for one role (PLAN §4.10). */
export function requireRole(role: Role): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw unauthenticated();
    if (req.auth.user.role !== role) throw forbidden();
    next();
  };
}

/** Staff routes: a member reaches their own data only through /me (PLAN §4.10). */
export const requireStaffRole: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw unauthenticated();
  if (!isStaffRole(req.auth.user.role)) throw forbidden();
  next();
};
