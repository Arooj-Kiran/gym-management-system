import {
  daysBetween,
  effectiveMembershipStatus,
  isCurrentStatus,
  type MyMembershipDto,
  type MyMembershipOverview,
  type MyProfileDto,
  type updateMyProfileSchema,
} from '@gms/shared';
import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { invoices, members, memberships } from '../../db/schema';
import { diffFields, recordAudit } from '../../lib/audit';
import { gymToday } from '../../lib/dates';
import { notFound } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import type { UploadedImage } from '../../middleware/upload';
import {
  joinMembershipInvoice,
  membershipInvoiceColumns,
  toInvoiceBrief,
  type MembershipInvoiceColumns,
} from '../billing/billing.service';
import { memberPhotoUrl, readPhoto, replacePhoto } from '../members/members.service';
import { currentMembershipSql } from '../memberships/current-membership';
import { getSettings } from '../settings/settings.service';

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
export async function requireOwnRow(executor: DbExecutor, userId: string, forUpdate = false) {
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

// --- Membership (read-only) -----------------------------------------------------------------

type MembershipRow = typeof memberships.$inferSelect & MembershipInvoiceColumns;

/** Only what a member needs: no reasons, staff names or internal links. */
function toMyMembership(row: MembershipRow, today: string): MyMembershipDto {
  return {
    id: row.id,
    planName: row.planNameSnapshot,
    priceMinor: row.priceMinorSnapshot,
    status: row.status,
    effectiveStatus: effectiveMembershipStatus(row, today),
    startDate: row.startDate,
    endDate: row.endDate,
    accessDays: row.accessDaysSnapshot,
    accessStartTime: row.accessStartTimeSnapshot?.slice(0, 5) ?? null,
    accessEndTime: row.accessEndTimeSnapshot?.slice(0, 5) ?? null,
    invoice: toInvoiceBrief(row, today),
  };
}

async function ownMemberships(memberId: string) {
  return db
    .select({ ...getTableColumns(memberships), ...membershipInvoiceColumns })
    .from(memberships)
    .leftJoin(invoices, joinMembershipInvoice)
    .where(eq(memberships.memberId, memberId))
    .orderBy(desc(memberships.startDate), desc(memberships.createdAt));
}

/** The member's own membership history, newest period first. */
export async function getMyMemberships(userId: string): Promise<MyMembershipDto[]> {
  const member = await requireOwnRow(db, userId);
  const today = gymToday();
  return (await ownMemberships(member.id)).map((row) => toMyMembership(row, today));
}

/** The membership the member is on now (same rule as staff screens), and any renewal after it. */
export async function getMyMembership(userId: string): Promise<MyMembershipOverview> {
  const member = await requireOwnRow(db, userId);
  const today = gymToday();
  const [[pick], rows, settings] = await Promise.all([
    db
      .select({ id: currentMembershipSql<string>(members.id, today, sql`cm.id`) })
      .from(members)
      .where(eq(members.id, member.id)),
    ownMemberships(member.id),
    getSettings(),
  ]);
  const current = rows.find((row) => row.id === pick?.id) ?? null;
  if (!current) return { current: null, next: null, daysLeft: null, expiringSoon: false };

  const next =
    rows
      .filter(
        (row) =>
          row.id !== current.id && isCurrentStatus(row.status) && row.startDate > current.endDate,
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ?? null;
  const status = effectiveMembershipStatus(current, today);
  const running = (status === 'ACTIVE' || status === 'SUSPENDED') && current.startDate <= today;
  const daysLeft = running ? daysBetween(today, current.endDate) + 1 : null;
  return {
    current: toMyMembership(current, today),
    next: next ? toMyMembership(next, today) : null,
    daysLeft,
    expiringSoon:
      status === 'ACTIVE' &&
      daysLeft !== null &&
      daysLeft - 1 <= settings.expiryReminderDays &&
      next === null,
  };
}
