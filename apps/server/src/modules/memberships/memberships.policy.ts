import { permissionScope, SCOPES } from '@gms/shared';
import { forbidden } from '../../lib/errors';

/**
 * Object-level scope for `memberships:read` on staff routes (PLAN §5).
 * - Full-access roles see every membership.
 * - Trainers see assigned members' status and dates only. Assignments arrive in Stage 6, so
 *   until then the list is empty and any single membership is out of scope.
 * - Members read their own memberships through /me.
 */
export type MembershipReadScope = { kind: 'all' } | { kind: 'assigned'; trainerUserId: string };

export function membershipReadScope(auth: Express.AuthContext): MembershipReadScope {
  const scope = permissionScope(auth.user.role, 'memberships:read');
  if (scope === SCOPES.ALL) return { kind: 'all' };
  if (scope === SCOPES.ASSIGNED) return { kind: 'assigned', trainerUserId: auth.user.id };
  throw forbidden();
}

/** Stage 6 replaces this with a trainer_assignments lookup. */
export function assertCanReadMembershipsOf(scope: MembershipReadScope, _memberId: string) {
  if (scope.kind === 'assigned') throw forbidden('This member is not assigned to you.');
}
