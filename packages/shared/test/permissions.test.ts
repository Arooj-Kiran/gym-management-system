import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS,
  ROLES,
  SCOPES,
  hasPermission,
  permissionScope,
  permissionsForRole,
  type Permission,
  type Scope,
} from '../src';

/**
 * Independent transcription of docs/PLAN.md §5, column order: Admin, Manager, Receptionist, Trainer, Member.
 * Y=ALL O=OWN A=ASSIGNED P=OWN_AND_ASSIGNED S=OWN_SESSIONS V=VIA_ASSIGNED_PLANS L=LIMITED -=denied.
 * Any difference means the matrix changed, which needs approval (RULES.md §9).
 */
const EXPECTED: Record<Permission, string> = {
  'staff:read': 'YY---',
  'staff:manage': 'Y----',
  'staff:assign-role': 'Y----',
  'settings:read': 'YY---',
  'settings:manage': 'Y----',
  'audit:read': 'Y----',
  'devices:manage': 'Y----',
  'members:read': 'YYYAO',
  'members:create': 'YYY--',
  'members:update': 'YYY--',
  'members:archive': 'YY---',
  'access:restrict': 'YY---',
  'plans:read': 'YYY-L',
  'plans:manage': 'Y----',
  'memberships:read': 'YYYAO',
  'memberships:assign': 'YYY--',
  'memberships:activate': 'YYY--',
  'memberships:renew': 'YYY--',
  'memberships:change-status': 'YY---',
  'access:simulate': 'YYY--',
  'access:monitor': 'YYY--',
  'access:read-log': 'YYY--',
  'attendance:read': 'YYYAO',
  'attendance:manual-check-in': 'YYY--',
  'attendance:check-out': 'YYY--',
  'attendance:correct': 'YY---',
  'biometrics:read-status': 'YYY-O',
  'biometrics:manage': 'YY---',
  'payments:read': 'YYY-O',
  'payments:record': 'YYY--',
  'payments:refund': 'YY---',
  'payments:void': 'YY---',
  'trainers:read': 'YYYYL',
  'trainers:manage': 'YY-O-',
  'trainers:manage-availability': 'YY-O-',
  'trainer-assignments:read': 'YYYOO',
  'trainer-assignments:manage': 'YY---',
  'schedules:read': 'YYOO-',
  'schedules:manage': 'YY---',
  'classes:read': 'YYYYY',
  'classes:manage': 'YY---',
  'classes:mark-attendance': 'YYYS-',
  'bookings:read': 'YYYSO',
  'bookings:manage': 'YYY-O',
  'appointments:read': 'YYYOO',
  'appointments:manage': 'YYYOO',
  'exercises:read': 'YY-YV',
  'exercises:manage': 'YY-Y-',
  'workouts:read': 'YY-PO',
  'workouts:manage': 'YY-O-',
  'workouts:assign': 'YY-A-',
  'workouts:log': 'YY-AO',
  'progress:read': 'YY-AO',
  'progress:record': 'YY-AO',
  'equipment:read': 'YYYY-',
  'equipment:manage': 'YY---',
  'dashboard:read': 'YYLO-',
  'reports:operational': 'YYL--',
  'reports:financial': 'YY---',
  'notifications:read': 'OOOOO',
};

const CODE: Record<string, Scope | null> = {
  Y: SCOPES.ALL,
  O: SCOPES.OWN,
  A: SCOPES.ASSIGNED,
  P: SCOPES.OWN_AND_ASSIGNED,
  S: SCOPES.OWN_SESSIONS,
  V: SCOPES.VIA_ASSIGNED_PLANS,
  L: SCOPES.LIMITED,
  '-': null,
};

describe('permission matrix', () => {
  it('contains exactly the permissions in the approved plan', () => {
    expect([...PERMISSIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s matches the plan for every role', (permission, row) => {
    ROLES.forEach((role, index) => {
      expect(permissionScope(role, permission as Permission), `${permission} / ${role}`).toBe(
        CODE[row[index]!],
      );
    });
  });

  it('never lets a non-admin manage staff, roles, settings or audit', () => {
    for (const role of ROLES.filter((r) => r !== 'ADMIN')) {
      for (const permission of [
        'staff:manage',
        'staff:assign-role',
        'settings:manage',
        'audit:read',
      ] as const) {
        expect(hasPermission(role, permission)).toBe(false);
      }
    }
  });

  it('lists the granted permissions for a role', () => {
    expect(permissionsForRole('MEMBER')).not.toContain('staff:read');
    expect(permissionsForRole('ADMIN')).toContain('staff:assign-role');
  });
});
