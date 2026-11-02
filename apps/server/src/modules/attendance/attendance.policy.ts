import { permissionScope, SCOPES } from '@gms/shared';
import { forbidden } from '../../lib/errors';
import { assertAssigned } from '../trainers/trainer-scope';

/**
 * Object-level scope for `attendance:read` on staff routes (PLAN §5).
 * - Full-access roles see every record.
 * - Trainers see members assigned to them only.
 * - Members read their own check-ins through /me/attendance.
 */
export type AttendanceReadScope = { kind: 'all' } | { kind: 'assigned'; trainerUserId: string };

export function attendanceReadScope(auth: Express.AuthContext): AttendanceReadScope {
  const scope = permissionScope(auth.user.role, 'attendance:read');
  if (scope === SCOPES.ALL) return { kind: 'all' };
  if (scope === SCOPES.ASSIGNED) return { kind: 'assigned', trainerUserId: auth.user.id };
  throw forbidden();
}

/** 403 unless the caller may see this member (a trainer: only while assigned). */
export async function assertCanReadAttendanceOf(scope: AttendanceReadScope, memberId: string) {
  if (scope.kind === 'assigned') await assertAssigned(scope.trainerUserId, memberId);
}
