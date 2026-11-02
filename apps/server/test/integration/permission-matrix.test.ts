import {
  hasPermission,
  RECEPTION_REPORT_TYPES,
  REPORT_TYPES,
  reportPermission,
  ROLES,
  type Permission,
  type Role,
} from '@gms/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import {
  attendanceRecords,
  classSessions,
  fitnessClasses,
  invoices,
  payments,
} from '../../src/db/schema';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import { randomUUID } from 'node:crypto';
import {
  createDevice,
  createMember,
  createMembership,
  createPlan,
  createUser,
  enrollMember,
} from '../setup/factories';

/**
 * Permission-matrix harness (PLAN §5): every protected route × every role.
 * Allowed roles must get past authorization (any status except 401/403);
 * every other role must get 403, and anonymous callers 401.
 * Request bodies are deliberately empty/invalid so allowed calls stop at validation and change nothing.
 *
 * `scopedDeny` lists roles that hold the permission with a narrower scope which this route
 * cannot satisfy (members use /me, not staff routes; the signed-in trainer is not the target
 * trainer and has no assigned members). `roles` replaces the permission for role-specific routes such as /me.
 */
interface Targets {
  userId: string;
  memberId: string;
  planId: string;
  membershipId: string;
  deviceId: string;
  attendanceId: string;
  enrollmentId: string;
  invoiceId: string;
  paymentId: string;
  classId: string;
  sessionId: string;
  missingId: string;
}

interface RouteCase {
  method: 'get' | 'post' | 'patch' | 'put';
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
  // Memberships (Stage 3)
  {
    method: 'get',
    path: () => '/api/v1/memberships',
    permission: 'memberships:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/memberships', permission: 'memberships:assign' },
  {
    method: 'get',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}`,
    permission: 'memberships:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'get',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}/events`,
    permission: 'memberships:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'post',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}/activate`,
    permission: 'memberships:activate',
  },
  {
    method: 'post',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}/renew`,
    permission: 'memberships:renew',
  },
  {
    method: 'post',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}/extend`,
    permission: 'memberships:change-status',
  },
  {
    method: 'post',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}/suspend`,
    permission: 'memberships:change-status',
  },
  {
    method: 'post',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}/reactivate`,
    permission: 'memberships:change-status',
  },
  {
    method: 'post',
    path: ({ membershipId }) => `/api/v1/memberships/${membershipId}/cancel`,
    permission: 'memberships:change-status',
  },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/memberships`,
    permission: 'memberships:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/membership-events`,
    permission: 'memberships:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  // Member portal (Stage 2): the member role only
  { method: 'get', path: () => '/api/v1/me/profile', roles: ['MEMBER'] },
  { method: 'patch', path: () => '/api/v1/me/profile', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/profile/photo', roles: ['MEMBER'] },
  { method: 'post', path: () => '/api/v1/me/profile/photo', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/membership', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/memberships', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/attendance', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/invoices', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/payments', roles: ['MEMBER'] },
  {
    method: 'get',
    path: ({ paymentId }) => `/api/v1/me/payments/${paymentId}/receipt`,
    roles: ['MEMBER'],
  },
  // Access control (Stage 4). Device-key routes are covered in access.test.ts.
  { method: 'get', path: () => '/api/v1/access/devices', permission: 'access:monitor' },
  { method: 'get', path: () => '/api/v1/access/attempts', permission: 'access:read-log' },
  // Without a deviceId the stream stops at validation instead of holding the connection open.
  { method: 'get', path: () => '/api/v1/access/stream', permission: 'access:monitor' },
  {
    method: 'get',
    path: () => '/api/v1/access/simulator/fixtures',
    permission: 'access:simulate',
  },
  { method: 'post', path: () => '/api/v1/access/simulate', permission: 'access:simulate' },
  // Attendance (Stage 4)
  {
    method: 'post',
    path: () => '/api/v1/attendance/manual-check-in',
    permission: 'attendance:manual-check-in',
  },
  {
    method: 'get',
    path: () => '/api/v1/attendance',
    permission: 'attendance:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: () => '/api/v1/attendance/today',
    permission: 'attendance:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    // An unknown record, so allowed roles get 404 and nothing is checked out.
    method: 'post',
    path: ({ missingId }) => `/api/v1/attendance/${missingId}/check-out`,
    permission: 'attendance:check-out',
  },
  {
    method: 'post',
    path: ({ attendanceId }) => `/api/v1/attendance/${attendanceId}/corrections`,
    permission: 'attendance:correct',
  },
  {
    method: 'get',
    path: ({ attendanceId }) => `/api/v1/attendance/${attendanceId}/corrections`,
    permission: 'attendance:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/attendance`,
    permission: 'attendance:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/access-attempts`,
    permission: 'attendance:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  // Devices (Stage 4)
  { method: 'get', path: () => '/api/v1/devices', permission: 'devices:manage' },
  { method: 'post', path: () => '/api/v1/devices', permission: 'devices:manage' },
  {
    method: 'get',
    path: ({ deviceId }) => `/api/v1/devices/${deviceId}`,
    permission: 'devices:manage',
  },
  {
    method: 'patch',
    path: ({ deviceId }) => `/api/v1/devices/${deviceId}`,
    permission: 'devices:manage',
  },
  {
    method: 'post',
    path: ({ deviceId }) => `/api/v1/devices/${deviceId}/rotate-key`,
    permission: 'devices:manage',
  },
  {
    method: 'post',
    path: ({ deviceId }) => `/api/v1/devices/${deviceId}/disable`,
    permission: 'devices:manage',
  },
  {
    method: 'post',
    path: ({ deviceId }) => `/api/v1/devices/${deviceId}/enable`,
    permission: 'devices:manage',
  },
  // Biometrics (Stage 4)
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/biometric`,
    permission: 'biometrics:read-status',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/biometric/consent`,
    permission: 'biometrics:manage',
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/biometric/consent/withdraw`,
    permission: 'biometrics:manage',
  },
  {
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/biometric/enrollments`,
    permission: 'biometrics:manage',
  },
  {
    method: 'post',
    path: ({ enrollmentId }) => `/api/v1/biometric/enrollments/${enrollmentId}/revoke`,
    permission: 'biometrics:manage',
  },
  // Billing (Stage 5). Members read their own billing through /me only.
  {
    method: 'get',
    path: () => '/api/v1/invoices',
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/invoices', permission: 'payments:record' },
  {
    method: 'get',
    path: ({ invoiceId }) => `/api/v1/invoices/${invoiceId}`,
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: ({ invoiceId }) => `/api/v1/invoices/${invoiceId}/void`,
    permission: 'payments:void',
  },
  {
    method: 'get',
    path: () => '/api/v1/payments',
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/payments', permission: 'payments:record' },
  {
    method: 'get',
    path: ({ paymentId }) => `/api/v1/payments/${paymentId}`,
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ paymentId }) => `/api/v1/payments/${paymentId}/receipt`,
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: ({ paymentId }) => `/api/v1/payments/${paymentId}/refunds`,
    permission: 'payments:refund',
  },
  {
    method: 'get',
    path: () => '/api/v1/refunds',
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/invoices`,
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/payments`,
    permission: 'payments:read',
    scopedDeny: STAFF_ONLY,
  },
  // Trainers, schedules, classes and appointments (Stage 6). The target trainer is not the
  // signed-in trainer, so trainer routes with OWN scope answer 403 for the trainer session.
  {
    method: 'get',
    path: () => '/api/v1/trainers',
    permission: 'trainers:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ userId }) => `/api/v1/trainers/${userId}`,
    permission: 'trainers:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'patch',
    path: ({ userId }) => `/api/v1/trainers/${userId}`,
    permission: 'trainers:manage',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'get',
    path: ({ userId }) => `/api/v1/trainers/${userId}/availability`,
    permission: 'trainers:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'put',
    path: ({ userId }) => `/api/v1/trainers/${userId}/availability`,
    permission: 'trainers:manage-availability',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'post',
    path: ({ userId }) => `/api/v1/trainers/${userId}/time-off`,
    permission: 'trainers:manage-availability',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    // An unknown time-off entry: allowed roles get 404.
    method: 'post',
    path: ({ missingId }) => `/api/v1/time-off/${missingId}/cancel`,
    permission: 'trainers:manage-availability',
  },
  {
    method: 'get',
    path: ({ userId }) => `/api/v1/trainers/${userId}/schedule`,
    permission: 'trainers:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ userId }) => `/api/v1/trainers/${userId}/available-slots`,
    permission: 'appointments:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'get',
    path: ({ userId }) => `/api/v1/trainers/${userId}/members`,
    permission: 'trainer-assignments:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'get',
    path: () => '/api/v1/trainer-assignments',
    permission: 'trainer-assignments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: () => '/api/v1/trainer-assignments',
    permission: 'trainer-assignments:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/trainer-assignments/${missingId}/end`,
    permission: 'trainer-assignments:manage',
  },
  { method: 'get', path: () => '/api/v1/shifts', permission: 'schedules:read' },
  { method: 'post', path: () => '/api/v1/shifts', permission: 'schedules:manage' },
  {
    method: 'patch',
    path: ({ missingId }) => `/api/v1/shifts/${missingId}`,
    permission: 'schedules:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/shifts/${missingId}/cancel`,
    permission: 'schedules:manage',
  },
  {
    method: 'get',
    path: () => '/api/v1/classes',
    permission: 'classes:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ classId }) => `/api/v1/classes/${classId}`,
    permission: 'classes:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/classes', permission: 'classes:manage' },
  {
    method: 'patch',
    path: ({ classId }) => `/api/v1/classes/${classId}`,
    permission: 'classes:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/classes/${missingId}/archive`,
    permission: 'classes:manage',
  },
  {
    method: 'get',
    path: () => '/api/v1/class-sessions',
    permission: 'classes:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ sessionId }) => `/api/v1/class-sessions/${sessionId}`,
    permission: 'classes:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/class-sessions', permission: 'classes:manage' },
  {
    method: 'patch',
    path: ({ sessionId }) => `/api/v1/class-sessions/${sessionId}`,
    permission: 'classes:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/class-sessions/${missingId}/cancel`,
    permission: 'classes:manage',
  },
  {
    // Taught by the target trainer, not the signed-in one (OWN_SESSIONS).
    method: 'get',
    path: ({ sessionId }) => `/api/v1/class-sessions/${sessionId}/bookings`,
    permission: 'bookings:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    method: 'post',
    path: ({ sessionId }) => `/api/v1/class-sessions/${sessionId}/bookings`,
    permission: 'bookings:manage',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/bookings/${missingId}/cancel`,
    permission: 'bookings:manage',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/bookings/${missingId}/attendance`,
    permission: 'classes:mark-attendance',
  },
  {
    method: 'get',
    path: () => '/api/v1/appointments',
    permission: 'appointments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: () => '/api/v1/appointments',
    permission: 'appointments:manage',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/appointments/${missingId}`,
    permission: 'appointments:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'patch',
    path: ({ missingId }) => `/api/v1/appointments/${missingId}`,
    permission: 'appointments:manage',
    scopedDeny: STAFF_ONLY,
  },
  ...(['cancel', 'complete', 'no-show'] as const).map((action): RouteCase => ({
    method: 'post',
    path: ({ missingId }) => `/api/v1/appointments/${missingId}/${action}`,
    permission: 'appointments:manage',
    scopedDeny: STAFF_ONLY,
  })),
  { method: 'get', path: () => '/api/v1/me/trainers', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/schedule', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/class-sessions', roles: ['MEMBER'] },
  { method: 'post', path: () => '/api/v1/me/bookings', roles: ['MEMBER'] },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/me/bookings/${missingId}/cancel`,
    roles: ['MEMBER'],
  },
  { method: 'get', path: () => '/api/v1/me/appointments', roles: ['MEMBER'] },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/me/appointments/${missingId}/cancel`,
    roles: ['MEMBER'],
  },
  // Stage 7: exercises, workouts, progress, equipment, notifications
  {
    method: 'get',
    path: () => '/api/v1/exercises',
    permission: 'exercises:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/exercises/${missingId}`,
    permission: 'exercises:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/exercises/${missingId}/image`,
    permission: 'exercises:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/exercises', permission: 'exercises:manage' },
  {
    method: 'patch',
    path: ({ missingId }) => `/api/v1/exercises/${missingId}`,
    permission: 'exercises:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/exercises/${missingId}/archive`,
    permission: 'exercises:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/exercises/${missingId}/image`,
    permission: 'exercises:manage',
  },
  {
    method: 'get',
    path: () => '/api/v1/workout-plans',
    permission: 'workouts:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/workout-plans/${missingId}`,
    permission: 'workouts:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/workout-plans', permission: 'workouts:manage' },
  {
    method: 'patch',
    path: ({ missingId }) => `/api/v1/workout-plans/${missingId}`,
    permission: 'workouts:manage',
  },
  {
    method: 'put',
    path: ({ missingId }) => `/api/v1/workout-plans/${missingId}/items`,
    permission: 'workouts:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/workout-plans/${missingId}/duplicate`,
    permission: 'workouts:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/workout-plans/${missingId}/archive`,
    permission: 'workouts:manage',
  },
  {
    method: 'get',
    path: () => '/api/v1/workout-assignments',
    permission: 'workouts:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/workout-assignments/${missingId}`,
    permission: 'workouts:read',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'post', path: () => '/api/v1/workout-assignments', permission: 'workouts:assign' },
  {
    method: 'patch',
    path: ({ missingId }) => `/api/v1/workout-assignments/${missingId}`,
    permission: 'workouts:assign',
  },
  {
    method: 'get',
    path: () => '/api/v1/workout-logs',
    permission: 'workouts:read',
    scopedDeny: STAFF_ONLY,
  },
  {
    method: 'post',
    path: () => '/api/v1/workout-logs',
    permission: 'workouts:log',
    scopedDeny: STAFF_ONLY,
  },
  {
    // The signed-in trainer is not assigned to the target member.
    method: 'get',
    path: ({ memberId }) => `/api/v1/members/${memberId}/progress`,
    permission: 'progress:read',
    scopedDeny: STAFF_ONLY_UNASSIGNED,
  },
  {
    // Invalid body is refused before the assignment check, so the trainer reaches validation.
    method: 'post',
    path: ({ memberId }) => `/api/v1/members/${memberId}/progress`,
    permission: 'progress:record',
    scopedDeny: STAFF_ONLY,
  },
  { method: 'get', path: () => '/api/v1/equipment', permission: 'equipment:read' },
  { method: 'get', path: () => '/api/v1/equipment/maintenance-due', permission: 'equipment:read' },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/equipment/${missingId}`,
    permission: 'equipment:read',
  },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/equipment/${missingId}/maintenance`,
    permission: 'equipment:read',
  },
  { method: 'post', path: () => '/api/v1/equipment', permission: 'equipment:manage' },
  {
    method: 'patch',
    path: ({ missingId }) => `/api/v1/equipment/${missingId}`,
    permission: 'equipment:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/equipment/${missingId}/status`,
    permission: 'equipment:manage',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/equipment/${missingId}/maintenance`,
    permission: 'equipment:manage',
  },
  { method: 'get', path: () => '/api/v1/notifications', permission: 'notifications:read' },
  {
    method: 'get',
    path: () => '/api/v1/notifications/unread-count',
    permission: 'notifications:read',
  },
  {
    method: 'post',
    path: () => '/api/v1/notifications/read-all',
    permission: 'notifications:read',
  },
  {
    method: 'post',
    path: ({ missingId }) => `/api/v1/notifications/${missingId}/read`,
    permission: 'notifications:read',
  },
  { method: 'get', path: () => '/api/v1/notifications/channels', permission: 'settings:read' },
  { method: 'get', path: () => '/api/v1/me/workouts', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/workout-logs', roles: ['MEMBER'] },
  { method: 'post', path: () => '/api/v1/me/workout-logs', roles: ['MEMBER'] },
  { method: 'get', path: () => '/api/v1/me/progress', roles: ['MEMBER'] },
  { method: 'post', path: () => '/api/v1/me/progress', roles: ['MEMBER'] },
  {
    method: 'get',
    path: ({ missingId }) => `/api/v1/me/exercises/${missingId}/image`,
    roles: ['MEMBER'],
  },
  // Dashboard (grows per stage)
  { method: 'get', path: () => '/api/v1/dashboard/summary', permission: 'dashboard:read' },
  { method: 'get', path: () => '/api/v1/dashboard/activity', permission: 'dashboard:read' },
  {
    method: 'get',
    path: () => '/api/v1/dashboard/charts/attendance',
    permission: 'reports:operational',
  },
  {
    method: 'get',
    path: () => '/api/v1/dashboard/charts/revenue',
    permission: 'reports:financial',
  },
  // Reports (Stage 8): the Receptionist's LIMITED scope covers attendance and denied access only.
  ...REPORT_TYPES.map((type): RouteCase => ({
    method: 'get',
    path: () => `/api/v1/reports/${type}`,
    permission: reportPermission(type),
    scopedDeny: RECEPTION_REPORT_TYPES.includes(type) ? [] : ['RECEPTIONIST'],
  })),
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
  const member = await createMember({ firstName: 'Matrix', lastName: 'Member' });
  const plan = await createPlan({ name: 'Matrix Plan' });
  const membership = await createMembership(member, plan, {
    startDate: '2026-01-01',
    endDate: '2099-12-31',
  });
  const scanner = await createDevice();
  const staff = await createUser({ role: 'TRAINER', firstName: 'Matrix', lastName: 'Target' });
  const enrollment = await enrollMember(member, scanner.device, 'SIM-0001', staff);
  const scan = await request(app)
    .post('/api/v1/access/scan')
    .set('Authorization', scanner.authorization)
    .send({
      eventId: randomUUID(),
      matchResult: 'MATCH',
      templateRef: 'SIM-0001',
      occurredAt: new Date().toISOString(),
    });
  if (scan.body.decision !== 'GRANTED') throw new Error('Matrix check-in was not granted');
  const [invoice] = await db
    .insert(invoices)
    .values({
      memberId: member.id,
      description: 'Matrix charge',
      amountDueMinor: 100_000,
      dueDate: '2099-12-31',
      status: 'PARTIALLY_PAID',
    })
    .returning();
  const [payment] = await db
    .insert(payments)
    .values({
      invoiceId: invoice!.id,
      memberId: member.id,
      amountMinor: 10_000,
      method: 'CASH',
      status: 'COMPLETED',
      receivedAt: new Date(),
    })
    .returning();
  const [fitnessClass] = await db
    .insert(fitnessClasses)
    .values({ name: 'Matrix Yoga', defaultDurationMinutes: 60, defaultCapacity: 10 })
    .returning();
  const startsAt = new Date(Date.now() + 7 * 86_400_000);
  const [session] = await db
    .insert(classSessions)
    .values({
      classId: fitnessClass!.id,
      trainerId: staff.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      capacity: 10,
    })
    .returning();
  targets = {
    userId: staff.id,
    memberId: member.id,
    planId: plan.id,
    membershipId: membership.id,
    deviceId: scanner.device.id,
    attendanceId: (await db.select({ id: attendanceRecords.id }).from(attendanceRecords))[0]!.id,
    enrollmentId: enrollment.id,
    invoiceId: invoice!.id,
    paymentId: payment!.id,
    classId: fitnessClass!.id,
    sessionId: session!.id,
    missingId: randomUUID(),
  };
  for (const role of ROLES) sessions.set(role, await signIn(app, await createUser({ role })));
});
afterAll(closeDb);

const BAD_BODY = { unexpectedField: true };

describe.each(
  ROUTES.map((route) => ({
    ...route,
    label: route.path({
      userId: ':id',
      memberId: ':id',
      planId: ':id',
      membershipId: ':id',
      deviceId: ':id',
      attendanceId: ':id',
      enrollmentId: ':id',
      invoiceId: ':id',
      paymentId: ':id',
      classId: ':id',
      sessionId: ':id',
      missingId: ':id',
    }),
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
