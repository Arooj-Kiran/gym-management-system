import { hasPermission, ROLES, type Permission, type Role } from '@gms/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/db/client';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createMember, createPlan, createUser } from '../setup/factories';

/**
 * Permission-matrix harness (PLAN §5): every protected route × every role.
 * Allowed roles must get past authorization (any status except 401/403);
 * every other role must get 403, and anonymous callers 401.
 * Request bodies are deliberately empty/invalid so allowed calls stop at validation and change nothing.
 *
 * `scopedDeny` lists roles that hold the permission with a narrower scope which this route
 * cannot satisfy (members use /me, not staff routes; trainers have no assigned members until
 * Stage 6). `roles` replaces the permission for role-specific routes such as /me.
 */
interface Targets {
  userId: string;
  memberId: string;
  planId: string;
}

interface RouteCase {
  method: 'get' | 'post' | 'patch';
  path: (targets: Targets) => string;
  permission?: Permission;
  roles?: Role[];
  scopedDeny?: Role[];
}

const STAFF_ONLY: Role[] = ['MEMBER'];
const STAFF_ONLY_UNASSIGNED: Role[] = ['MEMBER', 'TRAINER'];

const ROUTES: RouteCase[] = [
  { method: 'get', path: () => '/api/v1/staff', permission: 'staff:read' },
  { method: 'get', path: ({ userId }) => `/api/v1/staff/${userId}`, permission: 'staff:read' },
  { method: 'post', path: () => '/api/v1/staff', permission: 'staff:manage' },
  { method: 'patch', path: ({ userId }) => `/api/v1/staff/${userId}`, permission: 'staff:manage' },
  {
    method: 'patch',
    path: ({ userId }) => `/api/v1/staff/${userId}/role`,
    permission: 'staff:assign-role',
  },
  {
    method: 'post',
    path: ({ userId }) => `/api/v1/staff/${userId}/activate`,
    permission: 'staff:manage',
  },
  {
    method: 'post',
    path: ({ userId }) => `/api/v1/staff/${userId}/deactivate`,
    permission: 'staff:manage',
  },
  {
    method: 'post',
    path: ({ userId }) => `/api/v1/staff/${userId}/reset-password`,
    permission: 'staff:manage',
  },
  { method: 'get', path: () => '/api/v1/settings', permission: 'settings:read' },
  { method: 'patch', path: () => '/api/v1/settings', permission: 'settings:manage' },
  { method: 'get', path: () => '/api/v1/audit-logs', permission: 'audit:read' },
  // Members (Stage 2)
  {
    method: 'get',
    path: () => '/api/v1/members',
    permission: 'members:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: () => '/api/v1/members/check-duplicate',
    permission: 'members:create',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/members', permission: 'members:create' },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}`,
    permission: 'members:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'patch',
    path: ({ memberId }) => `/api/v1/members/${memberId}`,
    permission: 'members:update',
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/archive`,
    permission: 'members:archive',
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/restore`,
    permission: 'members:archive',
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/photo`,
    permission: 'members:update',
  },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/photo`,
    permission: 'members:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/portal-account`,
    permission: 'members:update',
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/access-block`,
    permission: 'access:restrict',
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/access-unblock`,
    permission: 'access:restrict',
  },
  // Membership plans (Stage 2)
  { method: 'get', path: () => '/api/v1/membership-plans', permission: 'plans:read' },
  { method: 'post', path: () => '/api/v1/membership-plans', permission: 'plans:manage' },
  {
    method: 'get',
    path: ({ planId }) => `/api/v1/membership-plans/${planId}`,
    permission: 'plans:read',
  },
  {
    method: 'patch',
    path: ({ planId }) => `/api/v1/membership-plans/${planId}`,
    permission: 'plans:manage',
  },
  {
    method: 'post',
    path: ({ planId }) => `/api/v1/membership-plans/${planId}/archive`,
    permission: 'plans:manage',
  },
  {
    method: 'post',
    path: ({ planId }) => `/api/v1/membership-plans/${planId}/unarchive`,
    permission: 'plans:manage',
  },
  // Member portal (Stage 2): the member role only
  { method: 'get', path: () => '/api/v1/me/profile', roles: ['MEMBER'] },
  { method: 'patch', path: () => '/api/v1/me/profile', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/profile/photo', roles: ['MEMBER'] },
  { method: 'post', path: () => '/api/v1/me/profile/photo', roles: ['MEMBER'] },
  // Dashboard (grows per stage)
  { method: 'get', path: () => '/api/v1/dashboard/summary', permission: 'dashboard:read' },
  { method: 'get', path: () => '/api/v1/dashboard/activity', permission: 'dashboard:read' },
];

function isAllowed(route: RouteCase, role: Role) {
  if (route.roles) return route.roles.includes(role);
  return hasPermission(role, route.permission!) && !route.scopedDeny?.includes(role);
}

const app = testApp();
const sessions = new Map<Role, Session>();
let targets: Targets;

beforeAll(async () => {
  await resetTables();
  targets = {
    userId: (await createUser({ role: 'TRAINER', firstName: 'Matrix', lastName: 'Target' })).id,
    memberId: (await createMember({ firstName: 'Matrix', lastName: 'Member' })).id,
    planId: (await createPlan({ name: 'Matrix Plan' })).id,
  };
  for (const role of ROLES) sessions.set(role, await signIn(app, await createUser({ role })));
});
afterAll(closeDb);

const BAD_BODY = { unexpectedField: true };

describe.each(
  ROUTES.map((route) => ({
    ...route,
    label: route.path({ userId: ':id', memberId: ':id', planId: ':id' }),
  })),
)('$method $label', (route) => {
  it.each(ROLES)('role %s', async (role) => {
    const session = sessions.get(role)!;
    const url = route.path(targets);
    let call = session.agent[route.method](url);
    if (route.method !== 'get') call = call.set('X-CSRF-Token', session.csrf).send(BAD_BODY);
    const res = await call;

    if (isAllowed(route, role)) {
      expect([401, 403]).not.toContain(res.status);
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('anonymous caller gets 401', async () => {
    const url = route.path(targets);
    const anonymous = request(app);
    const res = await anonymous[route.method](url).send(
      route.method === 'get' ? undefined : BAD_BODY,
    );
    expect(res.status).toBe(401);
  });
});
