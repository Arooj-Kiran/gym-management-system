import { permissionScope, SCOPES } from '@gms/shared';
import { forbidden } from '../../lib/errors';

/**
 * Object-level scope for `members:read` on staff routes (PLAN §5).
 * - Full-access roles see every member.
 * - Trainers see only assigned members. Assignments arrive in Stage 6, so until then a trainer
 *   is assigned to nobody: the list is empty and any single member is out of scope.
 * - Members never use staff routes; they read themselves through /me.
 */
export type MemberReadScope = { kind: 'all' } | { kind: 'assigned'; trainerUserId: string };

export function memberReadScope(auth: Express.AuthContext): MemberReadScope {
  const scope = permissionScope(auth.user.role, 'members:read');
  if (scope === SCOPES.ALL) return { kind: 'all' };
  if (scope === SCOPES.ASSIGNED) return { kind: 'assigned', trainerUserId: auth.user.id };
  throw forbidden();
}

/** Stage 6 replaces this with a trainer_assignments lookup. */
export function assertCanReadMember(scope: MemberReadScope, _memberId: string) {
  if (scope.kind === 'assigned') throw forbidden('This member is not assigned to you.');
}
