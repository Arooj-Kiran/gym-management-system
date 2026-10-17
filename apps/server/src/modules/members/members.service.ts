import {
  ERROR_CODES,
  type DuplicateCheckResult,
  type MembershipBrief,
  type MemberDto,
  type MemberMatch,
  type MemberSummaryDto,
  type checkDuplicateQuerySchema,
  type createMemberSchema,
  type memberListQuerySchema,
  type updateMemberSchema,
} from '@gms/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import { members, users } from '../../db/schema';
import {
  deleteFile,
  newImageKey,
  readImage,
  saveFile,
} from '../../integrations/storage/local-storage';
import { diffFields, recordAudit } from '../../lib/audit';
import { gymToday } from '../../lib/dates';
import { isUniqueViolation } from '../../lib/db-errors';
import { conflict, notFound, validationFailed } from '../../lib/errors';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import { hashPassword } from '../../lib/passwords';
import type { RequestContext } from '../../lib/request-context';
import type { UploadedImage } from '../../middleware/upload';
import { revokeUserSessions } from '../auth/session.service';
import {
  currentEffectiveStatusSql,
  currentMembershipBriefSql,
} from '../memberships/current-membership';
import { assertCanReadMember, type MemberReadScope } from './members.policy';

type CreateMember = z.output<typeof createMemberSchema>;
type UpdateMember = z.output<typeof updateMemberSchema>;
type MemberListQuery = z.output<typeof memberListQuerySchema>;
type CheckDuplicateQuery = z.output<typeof checkDuplicateQuerySchema>;
type MemberRow = typeof members.$inferSelect;
type MemberWithMembership = MemberRow & { currentMembership: MembershipBrief | null };

/** The member's current membership (PLAN §3.3), selected next to the member row. */
const currentMembershipColumn = () => ({
  currentMembership: currentMembershipBriefSql(members.id, gymToday()).mapWith(
    (value) => value as MembershipBrief,
  ),
});

const portalColumns = {
  portalEmail: users.email,
  portalIsActive: users.isActive,
  portalMustChangePassword: users.mustChangePassword,
  portalLastLoginAt: users.lastLoginAt,
};

type MemberWithPortal = MemberWithMembership & {
  portalEmail: string | null;
  portalIsActive: boolean | null;
  portalMustChangePassword: boolean | null;
  portalLastLoginAt: Date | null;
};

/** The URL changes whenever the photo does, so browsers can cache it safely. */
export function memberPhotoUrl(basePath: string, key: string | null): string | null {
  if (!key) return null;
  const version = key.slice(key.indexOf('/') + 1, key.indexOf('/') + 9);
  return `${basePath}?v=${version}`;
}

function toSummary(row: MemberWithMembership): MemberSummaryDto {
  return {
    id: row.id,
    memberCode: row.memberCode,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phoneE164,
    photoUrl: memberPhotoUrl(`/api/v1/members/${row.id}/photo`, row.profilePhotoKey),
    registrationDate: row.registrationDate,
    accountStatus: row.accountStatus,
    accessBlocked: row.accessBlocked,
    hasPortalAccount: row.userId !== null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    isDemo: row.isDemo,
    createdAt: row.createdAt.toISOString(),
    currentMembership: row.currentMembership ?? null,
  };
}

function toDto(row: MemberWithPortal): MemberDto {
  return {
    ...toSummary(row),
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    emergencyContactRelation: row.emergencyContactRelation,
    notes: row.notes,
    accessBlockReason: row.accessBlockReason,
    accessBlockedAt: row.accessBlockedAt?.toISOString() ?? null,
    portalAccount:
      row.userId && row.portalEmail
        ? {
            email: row.portalEmail,
            isActive: row.portalIsActive ?? false,
            mustChangePassword: row.portalMustChangePassword ?? false,
            lastLoginAt: row.portalLastLoginAt?.toISOString() ?? null,
          }
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findRow(executor: DbExecutor, id: string, forUpdate = false) {
  const query = executor
    .select({ ...getTableColumns(members), ...portalColumns, ...currentMembershipColumn() })
    .from(members)
    .leftJoin(users, eq(users.id, members.userId))
    .where(eq(members.id, id))
    .limit(1);
  const [row] = forUpdate ? await query.for('update', { of: members }) : await query;
  return row as MemberWithPortal | undefined;
}

async function requireRow(executor: DbExecutor, id: string, forUpdate = false) {
  const row = await findRow(executor, id, forUpdate);
  if (!row) throw notFound('Member');
  return row;
}

function assertNotArchived(row: MemberRow) {
  if (row.archivedAt) {
    throw conflict(
      ERROR_CODES.MEMBER_ARCHIVED,
      'This member is archived. Restore them before making changes.',
    );
  }
}

function assertNotFuture(registrationDate: string | null | undefined) {
  if (registrationDate && registrationDate > gymToday()) {
    throw validationFailed([
      { path: 'registrationDate', message: 'Registration date cannot be in the future' },
    ]);
  }
}

// --- Duplicate detection (C2) -------------------------------------------------------------

const matchColumns = {
  id: members.id,
  memberCode: members.memberCode,
  firstName: members.firstName,
  lastName: members.lastName,
};

async function findEmailConflict(executor: DbExecutor, email: string | null, excludeId?: string) {
  if (!email) return null;
  const [row] = await executor
    .select(matchColumns)
    .from(members)
    .where(
      and(
        sql`lower(${members.email}) = lower(${email})`,
        isNull(members.archivedAt),
        excludeId ? ne(members.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findPhoneMatches(
  executor: DbExecutor,
  phone: string | null,
  name: { firstName?: string; lastName?: string },
  excludeId?: string,
): Promise<MemberMatch[]> {
  if (!phone) return [];
  const rows = await executor
    .select(matchColumns)
    .from(members)
    .where(
      and(
        eq(members.phoneE164, phone),
        isNull(members.archivedAt),
        excludeId ? ne(members.id, excludeId) : undefined,
      ),
    )
    .orderBy(asc(members.memberCode))
    .limit(20);
  const same = (a: string, b: string | undefined) =>
    !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  return rows.map((row) => ({
    ...row,
    sameName: same(row.firstName, name.firstName) && same(row.lastName, name.lastName),
  }));
}

const duplicateEmail = (existing: Omit<MemberMatch, 'sameName'> | null) =>
  conflict(
    ERROR_CODES.DUPLICATE_EMAIL,
    existing
      ? `${existing.firstName} ${existing.lastName} (${existing.memberCode}) already uses this email address.`
      : 'Another member already uses this email address.',
    { existing },
  );

const duplicatePortalEmail = () =>
  conflict(ERROR_CODES.DUPLICATE_EMAIL, 'Another login already uses this email address.', {
    existing: null,
  });

/** Serializes saves of the same phone number, so two desks cannot both skip the warning. */
async function lockPhone(tx: DbExecutor, phone: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`member-phone:${phone}`}))`);
}

interface PhoneOverride {
  confirmDuplicatePhone?: boolean;
  duplicatePhoneReason?: string;
}

/** Returns the matches the caller confirmed (to audit), or throws the C2 warning. */
async function checkPhone(
  tx: DbExecutor,
  phone: string,
  name: { firstName: string; lastName: string },
  override: PhoneOverride,
  excludeId?: string,
) {
  await lockPhone(tx, phone);
  const matches = await findPhoneMatches(tx, phone, name, excludeId);
  if (matches.length > 0 && !override.confirmDuplicatePhone) {
    const sameName = matches.some((match) => match.sameName);
    throw conflict(
      ERROR_CODES.DUPLICATE_PHONE_WARNING,
      sameName
        ? 'A member with the same name and phone number already exists. This may be the same person.'
        : 'This phone number is already used by another member.',
      { matches },
    );
  }
  return matches;
}

async function auditPhoneOverride(
  tx: DbExecutor,
  ctx: RequestContext,
  memberId: string,
  phone: string,
  matches: MemberMatch[],
  reason: string | undefined,
) {
  if (matches.length === 0) return;
  await recordAudit(tx, ctx, {
    action: 'MEMBER_DUPLICATE_PHONE_CONFIRMED',
    entityType: 'MEMBER',
    entityId: memberId,
    after: {
      phone,
      matchedMemberIds: matches.map((match) => match.id),
      matchedMemberCodes: matches.map((match) => match.memberCode),
      sameNameMatch: matches.some((match) => match.sameName),
    },
    reason,
  });
}

export async function checkDuplicates(query: CheckDuplicateQuery): Promise<DuplicateCheckResult> {
  const [emailConflict, phoneMatches] = await Promise.all([
    findEmailConflict(db, query.email, query.excludeId),
    findPhoneMatches(db, query.phone, query, query.excludeId),
  ]);
  return { emailConflict, phoneMatches };
}

// --- Reads --------------------------------------------------------------------------------

const SORT_COLUMNS = {
  name: [members.lastName, members.firstName],
  memberCode: [members.memberCode],
  registrationDate: [members.registrationDate, members.createdAt],
  createdAt: [members.createdAt],
} as const;

const DEFAULT_ORDER = {
  name: 'asc',
  memberCode: 'asc',
  registrationDate: 'desc',
  createdAt: 'desc',
} as const;

export async function listMembers(query: MemberListQuery, scope: MemberReadScope) {
  // Trainers see assigned members only; none exist until Stage 6 adds assignments.
  if (scope.kind === 'assigned') return paginated([], query.page, query.pageSize, 0);

  const filters: (SQL | undefined)[] = [];
  if (query.view === 'current') filters.push(isNull(members.archivedAt));
  if (query.view === 'archived') filters.push(isNotNull(members.archivedAt));
  if (query.accountStatus) filters.push(eq(members.accountStatus, query.accountStatus));
  if (query.accessBlocked !== undefined) {
    filters.push(eq(members.accessBlocked, query.accessBlocked));
  }
  if (query.registeredFrom) filters.push(gte(members.registrationDate, query.registeredFrom));
  if (query.registeredTo) filters.push(lte(members.registrationDate, query.registeredTo));
  if (query.membershipStatus) {
    const status = currentEffectiveStatusSql(members.id, gymToday());
    filters.push(
      query.membershipStatus === 'NONE'
        ? sql`${status} is null`
        : sql`${status} = ${query.membershipStatus}`,
    );
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    const digits = query.q.replace(/\D/g, '');
    filters.push(
      or(
        ilike(sql`${members.firstName} || ' ' || ${members.lastName}`, pattern),
        ilike(sql`${members.email}::text`, pattern),
        ilike(members.memberCode, pattern),
        // "0300 123" finds +92300123…: match on digits, ignoring the national leading zero.
        digits.length >= 3
          ? ilike(members.phoneE164, likePattern(digits.replace(/^0/, '')))
          : undefined,
      ),
    );
  }
  const where = and(...filters);
  const direction = (query.order ?? DEFAULT_ORDER[query.sort]) === 'asc' ? asc : desc;
  const orderBy = SORT_COLUMNS[query.sort].map((column) => direction(column));

  const [rows, [totals]] = await Promise.all([
    db
      .select({ ...getTableColumns(members), ...currentMembershipColumn() })
      .from(members)
      .where(where)
      .orderBy(...orderBy, asc(members.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db.select({ total: count() }).from(members).where(where),
  ]);
  return paginated(rows.map(toSummary), query.page, query.pageSize, totals?.total ?? 0);
}

export async function getMember(id: string, scope: MemberReadScope): Promise<MemberDto> {
  assertCanReadMember(scope, id);
  return toDto(await requireRow(db, id));
}

// --- Writes -------------------------------------------------------------------------------

export async function createMember(input: CreateMember, ctx: RequestContext): Promise<MemberDto> {
  assertNotFuture(input.registrationDate);
  const { confirmDuplicatePhone, duplicatePhoneReason, ...fields } = input;
  try {
    return await db.transaction(async (tx) => {
      const existing = await findEmailConflict(tx, fields.email);
      if (existing) throw duplicateEmail(existing);
      const matches = await checkPhone(tx, fields.phone, fields, {
        confirmDuplicatePhone,
        duplicatePhoneReason,
      });

      const [created] = await tx
        .insert(members)
        .values({
          firstName: fields.firstName,
          lastName: fields.lastName,
          email: fields.email,
          phoneE164: fields.phone,
          emergencyContactName: fields.emergencyContactName,
          emergencyContactPhone: fields.emergencyContactPhone,
          emergencyContactRelation: fields.emergencyContactRelation,
          registrationDate: fields.registrationDate ?? gymToday(),
          notes: fields.notes,
          createdBy: ctx.actorUserId,
        })
        .returning({ id: members.id, memberCode: members.memberCode });
      await recordAudit(tx, ctx, {
        action: 'MEMBER_CREATED',
        entityType: 'MEMBER',
        entityId: created!.id,
        after: { memberCode: created!.memberCode, ...fields },
      });
      await auditPhoneOverride(tx, ctx, created!.id, fields.phone, matches, duplicatePhoneReason);
      return toDto(await requireRow(tx, created!.id));
    });
  } catch (error) {
    if (isUniqueViolation(error, 'members_email_active_key')) {
      throw duplicateEmail(await findEmailConflict(db, input.email));
    }
    throw error;
  }
}

/** Keeps the member's portal login in step with their profile. */
async function syncPortalUser(tx: DbExecutor, row: MemberWithPortal, changes: UpdateMember) {
  if (!row.userId) return;
  if (changes.email === null) {
    throw validationFailed([
      { path: 'email', message: 'This member signs in to the portal, so an email is required' },
    ]);
  }
  const userChanges = {
    email: changes.email,
    firstName: changes.firstName,
    lastName: changes.lastName,
    phone: changes.phone,
  };
  if (Object.values(userChanges).some((value) => value !== undefined)) {
    await tx.update(users).set(userChanges).where(eq(users.id, row.userId));
  }
}

export async function updateMember(
  id: string,
  input: UpdateMember,
  ctx: RequestContext,
): Promise<MemberDto> {
  assertNotFuture(input.registrationDate);
  const { confirmDuplicatePhone, duplicatePhoneReason, ...fields } = input;
  try {
    return await db.transaction(async (tx) => {
      const current = await requireRow(tx, id, true);
      assertNotArchived(current);
      const currentFields = {
        firstName: current.firstName,
        lastName: current.lastName,
        email: current.email,
        phone: current.phoneE164,
        emergencyContactName: current.emergencyContactName,
        emergencyContactPhone: current.emergencyContactPhone,
        emergencyContactRelation: current.emergencyContactRelation,
        registrationDate: current.registrationDate,
        notes: current.notes,
        accountStatus: current.accountStatus,
      };
      const diff = diffFields(currentFields, fields);
      if (!diff.changed) return toDto(current);
      const changes = diff.after as UpdateMember;

      if (changes.email) {
        const existing = await findEmailConflict(tx, changes.email, id);
        if (existing) throw duplicateEmail(existing);
      }
      let matches: MemberMatch[] = [];
      if (changes.phone) {
        const name = {
          firstName: changes.firstName ?? current.firstName,
          lastName: changes.lastName ?? current.lastName,
        };
        matches = await checkPhone(
          tx,
          changes.phone,
          name,
          { confirmDuplicatePhone, duplicatePhoneReason },
          id,
        );
      }

      await tx
        .update(members)
        .set({
          firstName: changes.firstName,
          lastName: changes.lastName,
          email: changes.email,
          phoneE164: changes.phone,
          emergencyContactName: changes.emergencyContactName,
          emergencyContactPhone: changes.emergencyContactPhone,
          emergencyContactRelation: changes.emergencyContactRelation,
          registrationDate: changes.registrationDate,
          notes: changes.notes,
          accountStatus: changes.accountStatus,
        })
        .where(eq(members.id, id));
      await syncPortalUser(tx, current, changes);
      await recordAudit(tx, ctx, {
        action: 'MEMBER_UPDATED',
        entityType: 'MEMBER',
        entityId: id,
        before: diff.before,
        after: diff.after,
      });
      if (changes.phone) {
        await auditPhoneOverride(tx, ctx, id, changes.phone, matches, duplicatePhoneReason);
      }
      return toDto(await requireRow(tx, id));
    });
  } catch (error) {
    if (isUniqueViolation(error, 'members_email_active_key')) {
      throw duplicateEmail(await findEmailConflict(db, input.email ?? null, id));
    }
    if (isUniqueViolation(error, 'users_email_key')) throw duplicatePortalEmail();
    throw error;
  }
}

/** Archiving keeps all history; the portal login is switched off and its sessions end. */
export async function archiveMember(id: string, reason: string, ctx: RequestContext) {
  return db.transaction(async (tx) => {
    const current = await requireRow(tx, id, true);
    if (current.archivedAt) return toDto(current);
    await tx
      .update(members)
      .set({ archivedAt: new Date(), archivedBy: ctx.actorUserId })
      .where(eq(members.id, id));
    if (current.userId) {
      await tx.update(users).set({ isActive: false }).where(eq(users.id, current.userId));
      await revokeUserSessions(tx, current.userId);
    }
    await recordAudit(tx, ctx, {
      action: 'MEMBER_ARCHIVED',
      entityType: 'MEMBER',
      entityId: id,
      before: { archived: false },
      after: { archived: true, ...(current.userId ? { portalLoginDisabled: true } : {}) },
      reason,
    });
    return toDto(await requireRow(tx, id));
  });
}

export async function restoreMember(id: string, reason: string | undefined, ctx: RequestContext) {
  try {
    return await db.transaction(async (tx) => {
      const current = await requireRow(tx, id, true);
      if (!current.archivedAt) return toDto(current);
      // Another current member may have taken the email while this one was archived.
      const existing = await findEmailConflict(tx, current.email, id);
      if (existing) throw duplicateEmail(existing);
      await tx
        .update(members)
        .set({ archivedAt: null, archivedBy: null })
        .where(eq(members.id, id));
      if (current.userId) {
        await tx.update(users).set({ isActive: true }).where(eq(users.id, current.userId));
      }
      await recordAudit(tx, ctx, {
        action: 'MEMBER_RESTORED',
        entityType: 'MEMBER',
        entityId: id,
        before: { archived: true },
        after: { archived: false, ...(current.userId ? { portalLoginEnabled: true } : {}) },
        reason,
      });
      return toDto(await requireRow(tx, id));
    });
  } catch (error) {
    if (isUniqueViolation(error, 'members_email_active_key')) throw duplicateEmail(null);
    throw error;
  }
}

/**
 * Stores the new photo first, then swaps the key in the database. The old file is removed
 * only after the commit; on failure the new file is removed instead.
 */
export async function replacePhoto(
  id: string,
  image: UploadedImage,
  ctx: RequestContext,
  action: 'MEMBER_PHOTO_UPDATED' | 'MEMBER_PROFILE_SELF_UPDATED' = 'MEMBER_PHOTO_UPDATED',
) {
  const key = newImageKey('members', image.mime);
  await saveFile(key, image.data);
  let previousKey: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const current = await requireRow(tx, id, true);
      assertNotArchived(current);
      previousKey = current.profilePhotoKey;
      await tx.update(members).set({ profilePhotoKey: key }).where(eq(members.id, id));
      await recordAudit(tx, ctx, {
        action,
        entityType: 'MEMBER',
        entityId: id,
        before: { photo: previousKey ? 'present' : 'none' },
        after: { photo: 'replaced', contentType: image.mime, bytes: image.data.length },
      });
    });
  } catch (error) {
    await deleteFile(key);
    throw error;
  }
  if (previousKey) await deleteFile(previousKey);
  return toDto(await requireRow(db, id));
}

export async function readPhoto(id: string) {
  const [row] = await db
    .select({ key: members.profilePhotoKey })
    .from(members)
    .where(eq(members.id, id))
    .limit(1);
  if (!row) throw notFound('Member');
  const image = row.key ? await readImage(row.key) : null;
  if (!image) throw notFound('Photo');
  return image;
}

export async function createPortalAccount(
  id: string,
  temporaryPassword: string,
  ctx: RequestContext,
): Promise<MemberDto> {
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    return await db.transaction(async (tx) => {
      const current = await requireRow(tx, id, true);
      assertNotArchived(current);
      if (current.userId) {
        throw conflict(
          ERROR_CODES.PORTAL_ACCOUNT_EXISTS,
          'This member already has a portal login.',
        );
      }
      if (!current.email) {
        throw validationFailed([
          { path: 'email', message: 'Add an email address to this member first' },
        ]);
      }
      const [user] = await tx
        .insert(users)
        .values({
          email: current.email,
          passwordHash,
          role: 'MEMBER',
          firstName: current.firstName,
          lastName: current.lastName,
          phone: current.phoneE164,
          mustChangePassword: true,
          isDemo: current.isDemo,
        })
        .returning({ id: users.id });
      await tx.update(members).set({ userId: user!.id }).where(eq(members.id, id));
      await recordAudit(tx, ctx, {
        action: 'MEMBER_PORTAL_ACCOUNT_CREATED',
        entityType: 'MEMBER',
        entityId: id,
        // Key names avoid "password" on purpose: stripSecrets would drop them.
        after: { loginEmail: current.email, userId: user!.id, changeRequiredAtNextSignIn: true },
      });
      return toDto(await requireRow(tx, id));
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) throw duplicatePortalEmail();
    throw error;
  }
}

export async function setAccessBlocked(
  id: string,
  blocked: boolean,
  reason: string | undefined,
  ctx: RequestContext,
): Promise<MemberDto> {
  return db.transaction(async (tx) => {
    const current = await requireRow(tx, id, true);
    assertNotArchived(current);
    if (current.accessBlocked === blocked) return toDto(current);
    await tx
      .update(members)
      .set(
        blocked
          ? {
              accessBlocked: true,
              accessBlockReason: reason ?? null,
              accessBlockedAt: new Date(),
              accessBlockedBy: ctx.actorUserId,
            }
          : {
              accessBlocked: false,
              accessBlockReason: null,
              accessBlockedAt: null,
              accessBlockedBy: null,
            },
      )
      .where(eq(members.id, id));
    await recordAudit(tx, ctx, {
      action: blocked ? 'MEMBER_ACCESS_BLOCKED' : 'MEMBER_ACCESS_UNBLOCKED',
      entityType: 'MEMBER',
      entityId: id,
      before: { accessBlocked: current.accessBlocked },
      after: { accessBlocked: blocked },
      reason,
    });
    return toDto(await requireRow(tx, id));
  });
}
