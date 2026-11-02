import { permissionScope, SCOPES } from '@gms/shared';
import { forbidden } from '../../lib/errors';
import { assertAssigned } from '../trainers/trainer-scope';

/**
 * Object-level scope for `memberships:read` on staff routes (PLAN §5).
 * - Full-access roles see every membership.
 * - Trainers see assigned members' status and dates only (TrainerMembershipDto).
 * - Members read their own memberships through /me.
 */
export type MembershipReadScope = { kind: 'all' } | { kind: 'assigned'; trainerUserId: string };

export function membershipReadScope(auth: Express.AuthContext): MembershipReadScope {
  const scope = permissionScope(auth.user.role, 'memberships:read');
  if (scope === SCOPES.ALL) return { kind: 'all' };
  if (scope === SCOPES.ASSIGNED) return { kind: 'assigned', trainerUserId: auth.user.id };
  throw forbidden();
}

/** 403 unless the caller may see this member (a trainer: only while assigned). */
export async function assertCanReadMembershipsOf(scope: MembershipReadScope, memberId: string) {
  if (scope.kind === 'assigned') await assertAssigned(scope.trainerUserId, memberId);
}
