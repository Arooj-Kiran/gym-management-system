import { randomUUID } from 'node:crypto';
import {
  kioskMessage,
  type AccessDecision,
  type AccessReason,
  type AccessResult,
  type AccessSource,
  type MatchResult,
} from '@gms/shared';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { db, type DbExecutor } from '../../db/client';
import {
  accessAttempts,
  attendanceRecords,
  biometricEnrollments,
  members,
  memberships,
} from '../../db/schema';
import { recordAudit } from '../../lib/audit';
import { isUniqueViolation, loggableError } from '../../lib/db-errors';
import { AppError, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { RequestContext } from '../../lib/request-context';
import { memberPhotoUrl } from '../members/members.service';
import type { AccessSettings } from './access-settings';
import { accessStream } from './access-stream';
import type { AccessDevice } from './device-auth';
import { evaluateEligibility, gymNow } from './eligibility';

/**
 * AccessDecisionService (PLAN §6.3). Every decision runs in one transaction whose default outcome
 * is DENIED / AUTHORIZATION_UNAVAILABLE: any error, statement timeout or failed commit lands in
 * the fallback path, and GRANTED is only ever returned after the attempt row has committed.
 */

export type DecisionInput =
  | {
      kind: 'device';
      device: AccessDevice;
      eventId: string;
      matchResult: MatchResult;
      templateRef?: string;
      errorCode?: string;
      /** Device time, already sanity-checked (see `sanitizeOccurredAt`). */
      occurredAt: Date;
      /** Simulator scenario AUTHORIZATION_UNAVAILABLE: make the eligibility query fail for real. */
      failEligibility?: boolean;
    }
  | { kind: 'manual'; memberId: string; reason: string; ctx: RequestContext };

/** Everything a response is built from; also re-read from the log for idempotent replays. */
interface DecisionRecord {
  attemptId: string | null;
  result: AccessResult;
  reason: AccessReason;
  source: AccessSource;
  isDuplicate: boolean;
  occurredAt: Date;
  deviceId: string | null;
  member: { id: string; firstName: string; memberCode: string; photoKey: string | null } | null;
  membership: { planName: string; endDate: string } | null;
}

/** Device clocks drift; a time outside this window is replaced by the server's receive time. */
const MAX_PAST_SKEW_MS = 5 * 60_000;
const MAX_FUTURE_SKEW_MS = 60_000;

export function sanitizeOccurredAt(deviceTime: string, now = new Date()): Date {
  const parsed = new Date(deviceTime);
  const delta = parsed.getTime() - now.getTime();
  if (Number.isNaN(delta) || delta < -MAX_PAST_SKEW_MS || delta > MAX_FUTURE_SKEW_MS) return now;
  return delta > 0 ? now : parsed;
}

export function toDecision(record: DecisionRecord): AccessDecision {
  const granted = record.result === 'GRANTED';
  const { title, message } = kioskMessage(record.reason, {
    firstName: record.member?.firstName,
    endDate: record.membership?.endDate,
  });
  const decision: AccessDecision = {
    decision: record.result,
    reason: record.reason,
    title,
    message,
    source: record.source,
    attemptId: record.attemptId,
    duplicate: record.isDuplicate,
    occurredAt: record.occurredAt.toISOString(),
    deviceId: record.deviceId,
  };
  if (record.member) {
    // At the entrance a denial shows the first name only (PLAN §6.3).
    decision.member = granted
      ? {
          firstName: record.member.firstName,
          memberCode: record.member.memberCode,
          photoUrl: memberPhotoUrl(
            `/api/v1/members/${record.member.id}/photo`,
            record.member.photoKey,
          ),
        }
      : { firstName: record.member.firstName };
  }
  if (granted && record.membership) decision.membership = record.membership;
  return decision;
}

/** Rebuilds the decision of a logged attempt (idempotent replay of a device event). */
async function readRecord(
  executor: DbExecutor,
  where: { attemptId: string } | { deviceId: string; eventId: string },
): Promise<DecisionRecord | null> {
  const [row] = await executor
    .select({
      attempt: accessAttempts,
      memberId: members.id,
      firstName: members.firstName,
      memberCode: members.memberCode,
      photoKey: members.profilePhotoKey,
      planName: memberships.planNameSnapshot,
      endDate: memberships.endDate,
    })
    .from(accessAttempts)
    .leftJoin(members, eq(members.id, accessAttempts.memberId))
    .leftJoin(memberships, eq(memberships.id, accessAttempts.membershipId))
    .where(
      'attemptId' in where
        ? eq(accessAttempts.id, where.attemptId)
        : and(
            eq(accessAttempts.deviceId, where.deviceId),
            eq(accessAttempts.eventId, where.eventId),
          ),
    )
    .limit(1);
  if (!row) return null;
  return {
    attemptId: row.attempt.id,
    result: row.attempt.result,
    reason: row.attempt.reason,
    source: row.attempt.source,
    isDuplicate: row.attempt.isDuplicate,
    occurredAt: row.attempt.occurredAt,
    deviceId: row.attempt.deviceId,
    member:
      row.memberId && row.firstName && row.memberCode
        ? {
            id: row.memberId,
            firstName: row.firstName,
            memberCode: row.memberCode,
            photoKey: row.photoKey,
          }
        : null,
    membership:
      row.planName && row.endDate ? { planName: row.planName, endDate: row.endDate } : null,
  };
}

export async function readDecision(attemptId: string) {
  const record = await readRecord(db, { attemptId });
  if (!record) throw notFound('Access attempt');
  return toDecision(record);
}

const setStatementTimeout = (tx: DbExecutor, ms: number) =>
  tx.execute(sql.raw(`set local statement_timeout = ${Math.max(1, Math.trunc(ms))}`));

type Outcome = { replayed: boolean; record: DecisionRecord };

async function decideInTransaction(
  input: DecisionInput,
  settings: AccessSettings,
  known: { memberId: string | null },
): Promise<Outcome> {
  return db.transaction(async (tx) => {
    await setStatementTimeout(tx, settings.dbTimeoutMs);
    const device = input.kind === 'device' ? input.device : null;

    if (input.kind === 'device') {
      const stored = await readRecord(tx, { deviceId: input.device.id, eventId: input.eventId });
      if (stored) return { replayed: true, record: stored };
    }

    const source: AccessSource = device ? device.deviceType : 'MANUAL';
    const occurredAt = input.kind === 'device' ? input.occurredAt : new Date();
    const verifiedByUserId = input.kind === 'manual' ? input.ctx.actorUserId : null;

    const log = async (
      result: AccessResult,
      reason: AccessReason,
      fields: {
        memberId?: string | null;
        membershipId?: string | null;
        attendanceId?: string | null;
        isDuplicate?: boolean;
      } = {},
    ) => {
      const id = randomUUID();
      await tx.insert(accessAttempts).values({
        id,
        occurredAt,
        deviceId: device?.id ?? null,
        source,
        eventId: input.kind === 'device' ? input.eventId : null,
        memberId: fields.memberId ?? null,
        membershipId: fields.membershipId ?? null,
        result,
        reason,
        isDuplicate: fields.isDuplicate ?? false,
        attendanceId: fields.attendanceId ?? null,
        verifiedByUserId,
        errorCode:
          input.kind === 'device' && input.matchResult === 'DEVICE_ERROR'
            ? (input.errorCode ?? null)
            : null,
      });
      return id;
    };

    const finish = async (
      result: AccessResult,
      reason: AccessReason,
      member: DecisionRecord['member'],
      membership: (DecisionRecord['membership'] & { id: string }) | null,
      extra: { attendanceId?: string; isDuplicate?: boolean; createAttendance?: boolean } = {},
    ): Promise<Outcome> => {
      const attendanceId = extra.attendanceId ?? (extra.createAttendance ? randomUUID() : null);
      // The attempt goes first; its link to the attendance row is checked at commit.
      const attemptId = await log(result, reason, {
        memberId: member?.id ?? null,
        membershipId: membership?.id ?? null,
        attendanceId,
        isDuplicate: extra.isDuplicate,
      });
      if (extra.createAttendance && member && membership) {
        await tx.insert(attendanceRecords).values({
          id: attendanceId!,
          memberId: member.id,
          membershipId: membership.id,
          checkInAt: occurredAt,
          source,
          accessAttemptId: attemptId,
          createdBy: verifiedByUserId,
        });
      }
      if (input.kind === 'manual') {
        await recordAudit(tx, input.ctx, {
          action: 'ACCESS_MANUAL_CHECK_IN',
          entityType: 'ACCESS_ATTEMPT',
          entityId: attemptId,
          after: { memberId: member?.id ?? null, result, reason, duplicate: !!extra.isDuplicate },
          reason: input.reason,
        });
      }
      return {
        replayed: false,
        record: {
          attemptId,
          result,
          reason,
          source,
          isDuplicate: !!extra.isDuplicate,
          occurredAt,
          deviceId: device?.id ?? null,
          member,
          membership: membership
            ? { planName: membership.planName, endDate: membership.endDate }
            : null,
        },
      };
    };

    // Steps 3–4: scanner errors and unknown fingerprints.
    let memberId: string;
    if (input.kind === 'manual') {
      memberId = input.memberId;
    } else if (input.matchResult === 'DEVICE_ERROR') {
      return finish('DENIED', 'SCANNER_UNAVAILABLE', null, null);
    } else if (input.matchResult === 'NO_MATCH' || !input.templateRef) {
      return finish('DENIED', 'MEMBER_NOT_RECOGNIZED', null, null);
    } else {
      const [enrollment] = await tx
        .select({ memberId: biometricEnrollments.memberId })
        .from(biometricEnrollments)
        .where(
          and(
            eq(biometricEnrollments.deviceId, input.device.id),
            eq(biometricEnrollments.templateRef, input.templateRef),
            eq(biometricEnrollments.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!enrollment) return finish('DENIED', 'MEMBER_NOT_RECOGNIZED', null, null);
      memberId = enrollment.memberId;
    }
    known.memberId = memberId;

    // Step 5: serialize scans of this member and see every committed membership change.
    const [memberRow] = await tx
      .select({
        id: members.id,
        firstName: members.firstName,
        memberCode: members.memberCode,
        photoKey: members.profilePhotoKey,
        archivedAt: members.archivedAt,
        accountStatus: members.accountStatus,
        accessBlocked: members.accessBlocked,
      })
      .from(members)
      .where(eq(members.id, memberId))
      .limit(1)
      .for('no key update');
    if (!memberRow) throw notFound('Member');
    const member = {
      id: memberRow.id,
      firstName: memberRow.firstName,
      memberCode: memberRow.memberCode,
      photoKey: memberRow.photoKey,
    };

    if (input.kind === 'device' && input.failEligibility) {
      await tx.execute(sql`select 1 / 0 as simulated_authorization_failure`);
    }
    const rows = await tx
      .select({
        id: memberships.id,
        status: memberships.status,
        startDate: memberships.startDate,
        endDate: memberships.endDate,
        accessDays: memberships.accessDaysSnapshot,
        accessStartTime: memberships.accessStartTimeSnapshot,
        accessEndTime: memberships.accessEndTimeSnapshot,
        createdAt: memberships.createdAt,
        planName: memberships.planNameSnapshot,
      })
      .from(memberships)
      .where(eq(memberships.memberId, memberId))
      .for('share');

    // Steps 6–8, always on the server clock in the gym timezone.
    const eligibility = evaluateEligibility(
      {
        archived: memberRow.archivedAt !== null,
        accountStatus: memberRow.accountStatus,
        accessBlocked: memberRow.accessBlocked,
      },
      rows,
      gymNow(config.gymTimezone),
    );
    const membership = eligibility.membership
      ? rows.find((row) => row.id === eligibility.membership!.id)!
      : null;
    if (!eligibility.eligible) return finish('DENIED', eligibility.reason, member, membership);

    // Step 9: a second scan inside the window re-uses the attendance row.
    if (settings.duplicateWindowSeconds > 0) {
      const [recent] = await tx
        .select({ id: attendanceRecords.id })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.memberId, memberId),
            eq(attendanceRecords.status, 'VALID'),
            gt(
              attendanceRecords.checkInAt,
              sql`now() - make_interval(secs => ${settings.duplicateWindowSeconds})`,
            ),
          ),
        )
        .orderBy(desc(attendanceRecords.checkInAt))
        .limit(1);
      if (recent) {
        return finish('GRANTED', 'GRANTED', member, membership, {
          attendanceId: recent.id,
          isDuplicate: true,
        });
      }
    }

    // Step 10.
    return finish('GRANTED', 'GRANTED', member, membership, { createAttendance: true });
  });
}

/** The fallback: record the denial on its own, best effort. */
async function recordUnavailable(
  input: DecisionInput,
  settings: AccessSettings,
  memberId: string | null,
): Promise<DecisionRecord> {
  const occurredAt = input.kind === 'device' ? input.occurredAt : new Date();
  const source: AccessSource = input.kind === 'device' ? input.device.deviceType : 'MANUAL';
  const deviceId = input.kind === 'device' ? input.device.id : null;
  let attemptId: string | null = null;
  try {
    attemptId = await db.transaction(async (tx) => {
      await setStatementTimeout(tx, settings.dbTimeoutMs);
      const id = randomUUID();
      await tx.insert(accessAttempts).values({
        id,
        occurredAt,
        deviceId,
        source,
        eventId: input.kind === 'device' ? input.eventId : null,
        memberId,
        result: 'DENIED',
        reason: 'AUTHORIZATION_UNAVAILABLE',
        verifiedByUserId: input.kind === 'manual' ? input.ctx.actorUserId : null,
      });
      if (input.kind === 'manual') {
        await recordAudit(tx, input.ctx, {
          action: 'ACCESS_MANUAL_CHECK_IN',
          entityType: 'ACCESS_ATTEMPT',
          entityId: id,
          after: { memberId, result: 'DENIED', reason: 'AUTHORIZATION_UNAVAILABLE' },
          reason: input.reason,
        });
      }
      return id;
    });
  } catch (error) {
    logger.error({ err: loggableError(error) }, 'Could not record an access denial');
  }
  return {
    attemptId,
    result: 'DENIED',
    reason: 'AUTHORIZATION_UNAVAILABLE',
    source,
    isDuplicate: false,
    occurredAt,
    deviceId,
    member: null,
    membership: null,
  };
}

const EVENT_CONSTRAINT = 'access_attempts_device_event_key';

/**
 * Decide, commit, then publish. Validation-style errors (an unknown member on a manual check-in)
 * are thrown; every other failure becomes DENIED / AUTHORIZATION_UNAVAILABLE.
 */
export async function decide(input: DecisionInput, settings: AccessSettings) {
  const known = { memberId: input.kind === 'manual' ? input.memberId : null };
  let outcome: Outcome;
  try {
    outcome = await decideInTransaction(input, settings, known);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (input.kind === 'device' && isUniqueViolation(error, EVENT_CONSTRAINT)) {
      // The same event raced in twice; the first one's decision stands.
      const stored = await readRecord(db, {
        deviceId: input.device.id,
        eventId: input.eventId,
      }).catch(() => null);
      if (stored) return toDecision(stored);
    }
    logger.error({ err: loggableError(error) }, 'Access decision failed; denying');
    outcome = { replayed: false, record: await recordUnavailable(input, settings, known.memberId) };
  }

  const decision = toDecision(outcome.record);
  if (!outcome.replayed) {
    accessStream.publish(decision.deviceId, decision);
    if (input.kind === 'device') void touchDevice(input.device.id);
  }
  return decision;
}

async function touchDevice(deviceId: string) {
  try {
    await db.execute(sql`update access_devices set last_seen_at = now() where id = ${deviceId}`);
  } catch (error) {
    logger.warn({ err: loggableError(error) }, 'Could not update device last-seen time');
  }
}

/** A scan from an unknown, disabled or wrongly keyed device. Logged and published, never decided. */
export async function recordDeviceNotAuthorized(device: AccessDevice | null) {
  const occurredAt = new Date();
  let attemptId: string | null = randomUUID();
  try {
    await db.insert(accessAttempts).values({
      id: attemptId,
      occurredAt,
      deviceId: device?.id ?? null,
      // The claimed device's type when it exists; an unknown caller used the device-key path.
      source: device?.deviceType ?? 'REAL',
      result: 'DENIED',
      reason: 'DEVICE_NOT_AUTHORIZED',
    });
  } catch (error) {
    attemptId = null;
    logger.error({ err: loggableError(error) }, 'Could not record an unauthorized device scan');
  }
  const decision = toDecision({
    attemptId,
    result: 'DENIED',
    reason: 'DEVICE_NOT_AUTHORIZED',
    source: device?.deviceType ?? 'REAL',
    isDuplicate: false,
    occurredAt,
    deviceId: device?.id ?? null,
    member: null,
    membership: null,
  });
  accessStream.publish(decision.deviceId, decision);
  return decision;
}

const OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

/**
 * The agent's outbox: denial facts it showed while the backend was unreachable. Always stored as
 * DENIED / AUTHORIZATION_UNAVAILABLE; a re-upload of the same event is ignored.
 */
export async function recordOfflineDenials(
  device: AccessDevice,
  denials: { eventId: string; occurredAt: string }[],
) {
  const now = Date.now();
  const rows = denials.map((denial) => {
    const time = new Date(denial.occurredAt);
    const plausible =
      time.getTime() <= now + MAX_FUTURE_SKEW_MS && time.getTime() >= now - OFFLINE_MAX_AGE_MS;
    return {
      occurredAt: plausible ? time : new Date(now),
      deviceId: device.id,
      source: device.deviceType,
      eventId: denial.eventId,
      result: 'DENIED' as const,
      reason: 'AUTHORIZATION_UNAVAILABLE' as const,
      uploadedFromOutbox: true,
    };
  });
  const inserted = await db
    .insert(accessAttempts)
    .values(rows)
    .onConflictDoNothing({
      target: [accessAttempts.deviceId, accessAttempts.eventId],
      where: sql`event_id is not null`,
    })
    .returning({ id: accessAttempts.id });
  return { received: denials.length, stored: inserted.length };
}
