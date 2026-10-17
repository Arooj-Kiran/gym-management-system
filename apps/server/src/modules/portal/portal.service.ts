import type { MyProfileDto, updateMyProfileSchema } from '@gms/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { members } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import type { UploadedImage } from '../../middleware/upload';
import { memberPhotoUrl, readPhoto, replacePhoto } from '../members/members.service';

type UpdateMyProfile = z.output<typeof updateMyProfileSchema>;
type MemberRow = typeof members.$inferSelect;

function toDto(row: MemberRow): MyProfileDto {
  return {
    memberCode: row.memberCode,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phoneE164,
    photoUrl: memberPhotoUrl('/api/v1/me/profile/photo', row.profilePhotoKey),
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    emergencyContactRelation: row.emergencyContactRelation,
    registrationDate: row.registrationDate,
    accountStatus: row.accountStatus,
    accessBlocked: row.accessBlocked,
  };
}

/** The member ID always comes from the session, never from the request (PLAN §4.10). */
async function requireOwnRow(executor: DbExecutor, userId: string, forUpdate = false) {
  const query = executor
    .select()
    .from(members)
    .where(and(eq(members.userId, userId), isNull(members.archivedAt)))
    .limit(1);
  const [row] = forUpdate ? await query.for('update') : await query;
  if (!row) throw notFound('Member profile');
  return row;
}

export async function getMyProfile(userId: string): Promise<MyProfileDto> {
  return toDto(await requireOwnRow(db, userId));
}

export async function updateMyProfile(
  userId: string,
  input: UpdateMyProfile,
  ctx: RequestContext,
): Promise<MyProfileDto> {
  return db.transaction(async (tx) => {
    const row = await requireOwnRow(tx, userId, true);
    const diff = diffFields(
      {
        emergencyContactName: row.emergencyContactName,
        emergencyContactPhone: row.emergencyContactPhone,
        emergencyContactRelation: row.emergencyContactRelation,
      },
      input,
    );
    if (!diff.changed) return toDto(row);
    const [updated] = await tx
      .update(members)
      .set(diff.after)
      .where(eq(members.id, row.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: 'MEMBER_PROFILE_SELF_UPDATED',
      entityType: 'MEMBER',
      entityId: row.id,
      before: diff.before,
      after: diff.after,
    });
    return toDto(updated!);
  });
}

export async function replaceMyPhoto(userId: string, image: UploadedImage, ctx: RequestContext) {
  const row = await requireOwnRow(db, userId);
  await replacePhoto(row.id, image, ctx, 'MEMBER_PROFILE_SELF_UPDATED');
  return getMyProfile(userId);
}

export async function readMyPhoto(userId: string) {
  const row = await requireOwnRow(db, userId);
  return readPhoto(row.id);
}
