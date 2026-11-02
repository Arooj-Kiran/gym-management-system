import { and, eq, isNull, sql, type Column, type SQL } from 'drizzle-orm';
import { db, type DbExecutor } from '../../db/client';
import { trainerAssignments } from '../../db/schema';
import { forbidden } from '../../lib/errors';
import { qualified } from '../memberships/current-membership';

/**
 * PLAN §5 "Assigned": a trainer sees a member while an assignment between them is open
 * (end_date is null). Every trainer-scoped read goes through these two helpers.
 */
export const assignedMemberSql = (memberId: Column, trainerUserId: string): SQL =>
  sql`exists (select 1 from trainer_assignments ta where ta.member_id = ${qualified(memberId)}
    and ta.trainer_id = ${trainerUserId} and ta.end_date is null)`;

export async function isAssigned(
  trainerUserId: string,
  memberId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: trainerAssignments.id })
    .from(trainerAssignments)
    .where(
      and(
        eq(trainerAssignments.trainerId, trainerUserId),
        eq(trainerAssignments.memberId, memberId),
        isNull(trainerAssignments.endDate),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function assertAssigned(trainerUserId: string, memberId: string) {
  if (!(await isAssigned(trainerUserId, memberId))) {
    throw forbidden('This member is not assigned to you.');
  }
}
