import { hasPermission, ROLES, type Permission, type Role } from '@gms/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '../../src/db/client';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { createUser } from '../setup/factories';

/**
 * Permission-matrix harness (PLAN §5): every Stage 1 protected route × every role.
 * Allowed roles must get past authorization (any status except 401/403);
 * every other role must get 403, and anonymous callers 401.
 * Request bodies are deliberately empty/invalid so allowed calls stop at validation and change nothing.
 */
interface RouteCase {
  method: 'get' | 'post' | 'patch';
  path: (targetId: string) => string;
  permission: Permission;
}

const ROUTES: RouteCase[] = [
  { method: 'get', path: () => '/api/v1/staff', permission: 'staff:read' },
  { method: 'get', path: (id) => `/api/v1/staff/${id}`, permission: 'staff:read' },
  { method: 'post', path: () => '/api/v1/staff', permission: 'staff:manage' },
  { method: 'patch', path: (id) => `/api/v1/staff/${id}`, permission: 'staff:manage' },
  { method: 'patch', path: (id) => `/api/v1/staff/${id}/role`, permission: 'staff:assign-role' },
  { method: 'post', path: (id) => `/api/v1/staff/${id}/activate`, permission: 'staff:manage' },
  { method: 'post', path: (id) => `/api/v1/staff/${id}/deactivate`, permission: 'staff:manage' },
  {
    method: 'post',
    path: (id) => `/api/v1/staff/${id}/reset-password`,
    permission: 'staff:manage',
  },
  { method: 'get', path: () => '/api/v1/settings', permission: 'settings:read' },
  { method: 'patch', path: () => '/api/v1/settings', permission: 'settings:manage' },
  { method: 'get', path: () => '/api/v1/audit-logs', permission: 'audit:read' },
];

const app = testApp();
const sessions = new Map<Role, Session>();
let targetId = '';

beforeAll(async () => {
  await resetTables();
  targetId = (await createUser({ role: 'TRAINER', firstName: 'Matrix', lastName: 'Target' })).id;
  for (const role of ROLES) sessions.set(role, await signIn(app, await createUser({ role })));
});
afterAll(closeDb);

const BAD_BODY = { unexpectedField: true };

describe.each(ROUTES)('$method $permission', (route) => {
  it.each(ROLES)('role %s', async (role) => {
    const session = sessions.get(role)!;
    const url = route.path(targetId);
    let call = session.agent[route.method](url);
    if (route.method !== 'get') call = call.set('X-CSRF-Token', session.csrf).send(BAD_BODY);
    const res = await call;

    if (hasPermission(role, route.permission)) {
      expect([401, 403]).not.toContain(res.status);
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('anonymous caller gets 401', async () => {
    const url = route.path(targetId);
    const anonymous = request(app);
    const res = await anonymous[route.method](url).send(
      route.method === 'get' ? undefined : BAD_BODY,
    );
    expect(res.status).toBe(401);
  });
});
