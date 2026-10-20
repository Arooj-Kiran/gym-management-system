import { permissionScope, SCOPES } from '@gms/shared';
import { forbidden } from '../../lib/errors';

/**
 * Object-level scope for `attendance:read` on staff routes (PLAN §5).
 * - Full-access roles see every record.
 * - Trainers see assigned members only. Assignments arrive in Stage 6, so until then a trainer
 *   is assigned to nobody: lists are empty and any single member is out of scope.
 * - Members read their own check-ins through /me/attendance.
 */
export type AttendanceReadScope = { kind: 'all' } | { kind: 'assigned'; trainerUserId: string };

export function attendanceReadScope(auth: Express.AuthContext): AttendanceReadScope {
  const scope = permissionScope(auth.user.role, 'attendance:read');
  if (scope === SCOPES.ALL) return { kind: 'all' };
  if (scope === SCOPES.ASSIGNED) return { kind: 'assigned', trainerUserId: auth.user.id };
  throw forbidden();
}

/** Stage 6 replaces this with a trainer_assignments lookup. */
export function assertCanReadAttendanceOf(scope: AttendanceReadScope, _memberId: string) {
  if (scope.kind === 'assigned') throw forbidden('This member is not assigned to you.');
}
