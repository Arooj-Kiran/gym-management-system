import { permissionScope, SCOPES } from '@gms/shared';
import { forbidden } from '../../lib/errors';
import { assertAssigned } from '../trainers/trainer-scope';

/**
 * Object-level scope for `members:read` on staff routes (PLAN §5).
 * - Full-access roles see every member.
 * - Trainers see only members assigned to them (an open trainer assignment), and only the
 *   trainer-safe fields.
 * - Members never use staff routes; they read themselves through /me.
 */
export type MemberReadScope = { kind: 'all' } | { kind: 'assigned'; trainerUserId: string };

export function memberReadScope(auth: Express.AuthContext): MemberReadScope {
  const scope = permissionScope(auth.user.role, 'members:read');
  if (scope === SCOPES.ALL) return { kind: 'all' };
  if (scope === SCOPES.ASSIGNED) return { kind: 'assigned', trainerUserId: auth.user.id };
  throw forbidden();
}

/** 403 unless the caller may see this member (a trainer: only while assigned). */
export async function assertCanReadMember(scope: MemberReadScope, memberId: string) {
  if (scope.kind === 'assigned') await assertAssigned(scope.trainerUserId, memberId);
}
