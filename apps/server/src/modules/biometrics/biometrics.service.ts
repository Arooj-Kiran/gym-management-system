import {
  BIOMETRIC_CONSENT,
  ERROR_CODES,
  SIM_REF_PREFIX,
  SIM_UNENROLLED_REF,
  isSimulatedRef,
  maskTemplateRef,
  type BiometricConsentDto,
  type BiometricEnrollmentDto,
  type MemberBiometricStatus,
  type enrollSchema,
} from '@gms/shared';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { db, type DbExecutor } from '../../db/client';
import {
  accessDevices,
  biometricConsents,
  biometricEnrollments,
  members,
  users,
} from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { isUniqueViolation } from '../../lib/db-errors';
import { AppError, conflict, notFound, validationFailed } from '../../lib/errors';
import type { RequestContext } from '../../lib/request-context';
import { sha256Hex } from '../../lib/tokens';
import type { AccessDevice } from '../access/device-auth';

type EnrollInput = z.output<typeof enrollSchema>;

const recorder = alias(users, 'recorder');
const withdrawer = alias(users, 'withdrawer');
const enroller = alias(users, 'enroller');
const revoker = alias(users, 'revoker');

const fullName = (first: string | null, last: string | null) => (first ? `${first} ${last}` : null);

async function listConsents(memberId: string): Promise<BiometricConsentDto[]> {
  const rows = await db
    .select({
      consent: biometricConsents,
      recorderFirst: recorder.firstName,
      recorderLast: recorder.lastName,
      withdrawerFirst: withdrawer.firstName,
      withdrawerLast: withdrawer.lastName,
    })
    .from(biometricConsents)
    .leftJoin(recorder, eq(recorder.id, biometricConsents.recordedBy))
    .leftJoin(withdrawer, eq(withdrawer.id, biometricConsents.withdrawnRecordedBy))
    .where(eq(biometricConsents.memberId, memberId))
    .orderBy(desc(biometricConsents.givenAt), desc(biometricConsents.id));
  return rows.map((row) => ({
    id: row.consent.id,
    consentVersion: row.consent.consentVersion,
    givenAt: row.consent.givenAt.toISOString(),
    recordedByName: fullName(row.recorderFirst, row.recorderLast),
    withdrawnAt: row.consent.withdrawnAt?.toISOString() ?? null,
    withdrawnByName: fullName(row.withdrawerFirst, row.withdrawerLast),
  }));
}

async function listEnrollments(where: SQL): Promise<BiometricEnrollmentDto[]> {
  const rows = await db
    .select({
      enrollment: biometricEnrollments,
      deviceName: accessDevices.name,
      deviceType: accessDevices.deviceType,
      enrollerFirst: enroller.firstName,
      enrollerLast: enroller.lastName,
      revokerFirst: revoker.firstName,
      revokerLast: revoker.lastName,
    })
    .from(biometricEnrollments)
    .innerJoin(accessDevices, eq(accessDevices.id, biometricEnrollments.deviceId))
    .leftJoin(enroller, eq(enroller.id, biometricEnrollments.enrolledBy))
    .leftJoin(revoker, eq(revoker.id, biometricEnrollments.revokedBy))
    .where(where)
    .orderBy(desc(biometricEnrollments.enrolledAt), desc(biometricEnrollments.id));
  return rows.map((row) => ({
    id: row.enrollment.id,
    device: {
      id: row.enrollment.deviceId,
      name: row.deviceName,
      deviceType: row.deviceType,
    },
    provider: row.enrollment.provider,
    templateRefMasked: maskTemplateRef(row.enrollment.templateRef),
    status: row.enrollment.status,
    enrolledAt: row.enrollment.enrolledAt.toISOString(),
    enrolledByName: fullName(row.enrollerFirst, row.enrollerLast),
    revokedAt: row.enrollment.revokedAt?.toISOString() ?? null,
    revokedByName: fullName(row.revokerFirst, row.revokerLast),
    revokeReason: row.enrollment.revokeReason,
    deletedAt: row.enrollment.deletedAt?.toISOString() ?? null,
  }));
}

async function enrollmentDto(id: string): Promise<BiometricEnrollmentDto> {
  const [dto] = await listEnrollments(eq(biometricEnrollments.id, id));
  if (!dto) throw notFound('Enrollment');
  return dto;
}

async function requireMember(executor: DbExecutor, memberId: string, lock = false) {
  const query = executor
    .select({ id: members.id, archivedAt: members.archivedAt })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw notFound('Member');
  return row;
}

const assertNotArchived = (member: { archivedAt: Date | null }) => {
  if (member.archivedAt) {
    throw conflict(ERROR_CODES.MEMBER_ARCHIVED, 'This member is archived. Restore them first.');
  }
};

async function currentConsent(executor: DbExecutor, memberId: string) {
  const [row] = await executor
    .select()
    .from(biometricConsents)
    .where(and(eq(biometricConsents.memberId, memberId), isNull(biometricConsents.withdrawnAt)))
    .limit(1);
  return row ?? null;
}

/** The member's consent and enrollments. Device user IDs are always masked (PLAN §6.6). */
export async function getMemberBiometricStatus(memberId: string): Promise<MemberBiometricStatus> {
  await requireMember(db, memberId);
  const [consentHistory, enrollments] = await Promise.all([
    listConsents(memberId),
    listEnrollments(eq(biometricEnrollments.memberId, memberId)),
  ]);
  return {
    consent: consentHistory.find((consent) => consent.withdrawnAt === null) ?? null,
    consentHistory,
    enrollments,
    currentConsentVersion: BIOMETRIC_CONSENT.version,
  };
}

/** Records that the member agreed to the current consent text (version + SHA-256 of the text). */
export async function giveConsent(memberId: string, ctx: RequestContext) {
  try {
    await db.transaction(async (tx) => {
      assertNotArchived(await requireMember(tx, memberId, true));
      if (await currentConsent(tx, memberId)) {
        throw conflict(ERROR_CODES.CONSENT_ALREADY_GIVEN, 'This member has already given consent.');
      }
      const [consent] = await tx
        .insert(biometricConsents)
        .values({
          memberId,
          consentVersion: BIOMETRIC_CONSENT.version,
          consentTextSha256: sha256Hex(BIOMETRIC_CONSENT.text),
          recordedBy: ctx.actorUserId!,
        })
        .returning();
      await recordAudit(tx, ctx, {
        action: 'BIOMETRIC_CONSENT_GIVEN',
        entityType: 'BIOMETRIC_CONSENT',
        entityId: consent!.id,
        after: { memberId, consentVersion: consent!.consentVersion },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, 'biometric_consents_member_current_key')) {
      throw conflict(ERROR_CODES.CONSENT_ALREADY_GIVEN, 'This member has already given consent.');
    }
    throw error;
  }
  return getMemberBiometricStatus(memberId);
}

/**
 * Withdrawing consent revokes every live enrollment of the member. The devices then delete the
 * templates and confirm (PLAN §6.6). Entry falls back to manual check-in by staff.
 */
export async function withdrawConsent(memberId: string, reason: string, ctx: RequestContext) {
  await db.transaction(async (tx) => {
    await requireMember(tx, memberId, true);
    const consent = await currentConsent(tx, memberId);
    if (!consent) {
      throw conflict(ERROR_CODES.CONSENT_REQUIRED, 'This member has no consent to withdraw.');
    }
    const now = new Date();
    await tx
      .update(biometricConsents)
      .set({ withdrawnAt: now, withdrawnRecordedBy: ctx.actorUserId })
      .where(eq(biometricConsents.id, consent.id));
    const revoked = await tx
      .update(biometricEnrollments)
      .set({
        status: 'REVOKED',
        revokedAt: now,
        revokedBy: ctx.actorUserId,
        revokeReason: 'Consent withdrawn',
      })
      .where(
        and(
          eq(biometricEnrollments.memberId, memberId),
          eq(biometricEnrollments.status, 'ACTIVE'),
        ),
      )
      .returning({ id: biometricEnrollments.id });
    await recordAudit(tx, ctx, {
      action: 'BIOMETRIC_CONSENT_WITHDRAWN',
      entityType: 'BIOMETRIC_CONSENT',
      entityId: consent.id,
      after: { memberId, revokedEnrollmentIds: revoked.map((row) => row.id) },
      reason,
    });
    for (const row of revoked) {
      await recordAudit(tx, ctx, {
        action: 'BIOMETRIC_ENROLLMENT_REVOKED',
        entityType: 'BIOMETRIC_ENROLLMENT',
        entityId: row.id,
        before: { status: 'ACTIVE' },
        after: { status: 'REVOKED' },
        reason: 'Consent withdrawn',
      });
    }
  });
  return getMemberBiometricStatus(memberId);
}

const SIM_REF_PATTERN = /^SIM-\d{4}$/;
const SIM_REF_MAX = 9998;

/**
 * Next free SIM-NNNN on a simulated device. A per-device advisory lock serializes concurrent
 * enrollments; SIM-9999 is reserved for the "unenrolled fingerprint" fixture.
 */
async function nextSimulatedRef(tx: DbExecutor, deviceId: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sim-ref:${deviceId}`}))`);
  const [row] = await tx
    .select({
      max: sql<number | null>`max(substring(${biometricEnrollments.templateRef} from 5)::int)`,
    })
    .from(biometricEnrollments)
    .where(
      and(
        eq(biometricEnrollments.deviceId, deviceId),
        sql`${biometricEnrollments.templateRef} ~ '^SIM-[0-9]{4}$'`,
        sql`${biometricEnrollments.templateRef} <> ${SIM_UNENROLLED_REF}`,
      ),
    );
  const next = (row?.max ?? 0) + 1;
  if (next > SIM_REF_MAX) {
    throw conflict(ERROR_CODES.TEMPLATE_REF_IN_USE, 'No free simulated IDs are left on this device.');
  }
  return `${SIM_REF_PREFIX}${String(next).padStart(4, '0')}`;
}

/** Simulated devices take SIM- refs only; real scanners never do (PLAN §3.6). */
function checkTemplateRef(device: AccessDevice, ref: string | undefined) {
  if (device.deviceType === 'SIMULATED') {
    if (ref === undefined) return;
    if (!SIM_REF_PATTERN.test(ref)) {
      throw validationFailed([
        { path: 'templateRef', message: 'A simulated device uses IDs like SIM-0001' },
      ]);
    }
    if (ref === SIM_UNENROLLED_REF) {
      throw validationFailed([
        { path: 'templateRef', message: `${SIM_UNENROLLED_REF} is reserved by the simulator` },
      ]);
    }
    return;
  }
  if (ref === undefined) {
    throw validationFailed([{ path: 'templateRef', message: 'Enter the device user ID' }]);
  }
  if (isSimulatedRef(ref)) {
    throw validationFailed([
      { path: 'templateRef', message: 'SIM- IDs are for simulated devices only' },
    ]);
  }
}

const providerOf = (device: AccessDevice) =>
  device.deviceType === 'SIMULATED'
    ? 'SIMULATED'
    : (device.vendor?.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 32) ?? '') || 'UNKNOWN';

const alreadyEnrolled = () =>
  conflict(ERROR_CODES.ALREADY_ENROLLED, 'This member is already enrolled on this device.');
const refInUse = () =>
  conflict(ERROR_CODES.TEMPLATE_REF_IN_USE, 'This device user ID is already in use on this device.');

/**
 * Links a member to a device-side user ID. The fingerprint itself is enrolled on the scanner;
 * the server never sees it. Requires consent in force and an active device.
 */
export async function enroll(memberId: string, input: EnrollInput, ctx: RequestContext) {
  let enrollmentId: string;
  try {
    enrollmentId = await db.transaction(async (tx) => {
      assertNotArchived(await requireMember(tx, memberId, true));
      const consent = await currentConsent(tx, memberId);
      if (!consent) {
        throw conflict(
          ERROR_CODES.CONSENT_REQUIRED,
          'Record the member’s biometric consent before enrolling a fingerprint.',
        );
      }
      const [device] = await tx
        .select()
        .from(accessDevices)
        .where(eq(accessDevices.id, input.deviceId))
        .limit(1)
        .for('share');
      if (!device) throw notFound('Device');
      if (device.status !== 'ACTIVE') {
        throw conflict(ERROR_CODES.DEVICE_DISABLED, 'This device is disabled.');
      }
      checkTemplateRef(device, input.templateRef);

      const [existing] = await tx
        .select({ id: biometricEnrollments.id })
        .from(biometricEnrollments)
        .where(
          and(
            eq(biometricEnrollments.memberId, memberId),
            eq(biometricEnrollments.deviceId, device.id),
            eq(biometricEnrollments.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (existing) throw alreadyEnrolled();

      const templateRef = input.templateRef ?? (await nextSimulatedRef(tx, device.id));
      // A revoked ref still waits for deletion on the device, so it is not free yet either.
      const [taken] = await tx
        .select({ id: biometricEnrollments.id })
        .from(biometricEnrollments)
        .where(
          and(
            eq(biometricEnrollments.deviceId, device.id),
            eq(biometricEnrollments.templateRef, templateRef),
            inArray(biometricEnrollments.status, ['ACTIVE', 'REVOKED']),
          ),
        )
        .limit(1);
      if (taken) throw refInUse();

      const [row] = await tx
        .insert(biometricEnrollments)
        .values({
          memberId,
          deviceId: device.id,
          provider: providerOf(device),
          templateRef,
          consentId: consent.id,
          enrolledBy: ctx.actorUserId!,
        })
        .returning({ id: biometricEnrollments.id });
      await recordAudit(tx, ctx, {
        action: 'BIOMETRIC_ENROLLED',
        entityType: 'BIOMETRIC_ENROLLMENT',
        entityId: row!.id,
        after: {
          memberId,
          deviceId: device.id,
          templateRefMasked: maskTemplateRef(templateRef),
        },
      });
      return row!.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'biometric_enrollments_member_device_active_key')) {
      throw alreadyEnrolled();
    }
    if (isUniqueViolation(error, 'biometric_enrollments_device_ref_active_key')) throw refInUse();
    throw error;
  }
  return enrollmentDto(enrollmentId);
}

/** Stops the ref from matching at once and queues the template for deletion on the device. */
export async function revokeEnrollment(id: string, reason: string, ctx: RequestContext) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(biometricEnrollments)
      .where(eq(biometricEnrollments.id, id))
      .limit(1)
      .for('update');
    if (!row) throw notFound('Enrollment');
    if (row.status !== 'ACTIVE') {
      throw conflict(ERROR_CODES.INVALID_STATUS_TRANSITION, 'This enrollment is already revoked.');
    }
    await tx
      .update(biometricEnrollments)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokedBy: ctx.actorUserId, revokeReason: reason })
      .where(eq(biometricEnrollments.id, id));
    await recordAudit(tx, ctx, {
      action: 'BIOMETRIC_ENROLLMENT_REVOKED',
      entityType: 'BIOMETRIC_ENROLLMENT',
      entityId: id,
      before: { status: 'ACTIVE' },
      after: { status: 'REVOKED' },
      reason,
    });
  });
  return enrollmentDto(id);
}

/**
 * The agent confirms that the template is gone from the scanner. Only the device that holds the
 * enrollment may confirm; the ref is then erased for good. Repeating the call is harmless.
 */
export async function confirmDeletion(device: AccessDevice, id: string, ctx: RequestContext) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(biometricEnrollments)
      .where(and(eq(biometricEnrollments.id, id), eq(biometricEnrollments.deviceId, device.id)))
      .limit(1)
      .for('update');
    if (!row) throw notFound('Enrollment');
    if (row.status === 'DELETED') return;
    if (row.status === 'ACTIVE') {
      throw new AppError(
        409,
        ERROR_CODES.INVALID_STATUS_TRANSITION,
        'This enrollment has not been revoked.',
      );
    }
    await tx
      .update(biometricEnrollments)
      .set({ status: 'DELETED', templateRef: null, deletedAt: new Date() })
      .where(eq(biometricEnrollments.id, id));
    await recordAudit(tx, ctx, {
      action: 'BIOMETRIC_TEMPLATE_DELETED',
      entityType: 'BIOMETRIC_ENROLLMENT',
      entityId: id,
      before: { status: 'REVOKED' },
      after: { status: 'DELETED', deviceId: device.id },
    });
  });
  return { enrollmentId: id, status: 'DELETED' as const };
}
