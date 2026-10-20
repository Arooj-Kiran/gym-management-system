import {
  SIM_UNENROLLED_REF,
  type AccessAttemptDto,
  type AccessDeviceBrief,
  type accessAttemptListQuerySchema,
  type SimulatorFixture,
  type SimulatorFixturesDto,
} from '@gms/shared';
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { config } from '../../config/env';
import { db } from '../../db/client';
import {
  accessAttempts,
  accessDevices,
  biometricEnrollments,
  members,
  memberships,
  users,
} from '../../db/schema';
import { gymDayStart } from '../../lib/dates';
import { likePattern, pageOffset, paginated } from '../../lib/pagination';
import { evaluateEligibility, gymNow } from './eligibility';

type AttemptListQuery = z.output<typeof accessAttemptListQuerySchema>;

export async function listAttempts(query: AttemptListQuery, fixed: { memberId?: string } = {}) {
  const filters: (SQL | undefined)[] = [];
  const memberId = fixed.memberId ?? query.memberId;
  if (memberId) filters.push(eq(accessAttempts.memberId, memberId));
  if (query.result) filters.push(eq(accessAttempts.result, query.result));
  if (query.reason) filters.push(eq(accessAttempts.reason, query.reason));
  if (query.source) filters.push(eq(accessAttempts.source, query.source));
  if (query.deviceId) filters.push(eq(accessAttempts.deviceId, query.deviceId));
  if (query.from) filters.push(gte(accessAttempts.occurredAt, gymDayStart(query.from)));
  if (query.to) filters.push(lt(accessAttempts.occurredAt, gymDayStart(query.to, 1)));
  if (query.q) {
    const pattern = likePattern(query.q);
    filters.push(
      or(
        ilike(sql`${members.firstName} || ' ' || ${members.lastName}`, pattern),
        ilike(members.memberCode, pattern),
      ),
    );
  }
  const where = and(...filters);
  const direction = (query.order ?? 'desc') === 'asc' ? asc : desc;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        attempt: accessAttempts,
        deviceName: accessDevices.name,
        memberCode: members.memberCode,
        firstName: members.firstName,
        lastName: members.lastName,
        verifierFirstName: users.firstName,
        verifierLastName: users.lastName,
      })
      .from(accessAttempts)
      .leftJoin(accessDevices, eq(accessDevices.id, accessAttempts.deviceId))
      .leftJoin(members, eq(members.id, accessAttempts.memberId))
      .leftJoin(users, eq(users.id, accessAttempts.verifiedByUserId))
      .where(where)
      .orderBy(direction(accessAttempts.occurredAt), direction(accessAttempts.id))
      .limit(query.pageSize)
      .offset(pageOffset(query.page, query.pageSize)),
    db
      .select({ total: count() })
      .from(accessAttempts)
      .leftJoin(members, eq(members.id, accessAttempts.memberId))
      .where(where),
  ]);

  const data: AccessAttemptDto[] = rows.map((row) => ({
    id: row.attempt.id,
    occurredAt: row.attempt.occurredAt.toISOString(),
    receivedAt: row.attempt.receivedAt.toISOString(),
    result: row.attempt.result,
    reason: row.attempt.reason,
    source: row.attempt.source,
    duplicate: row.attempt.isDuplicate,
    uploadedFromOutbox: row.attempt.uploadedFromOutbox,
    device:
      row.attempt.deviceId && row.deviceName
        ? { id: row.attempt.deviceId, name: row.deviceName }
        : null,
    member:
      row.attempt.memberId && row.memberCode && row.firstName && row.lastName
        ? {
            id: row.attempt.memberId,
            memberCode: row.memberCode,
            firstName: row.firstName,
            lastName: row.lastName,
          }
        : null,
    membershipId: row.attempt.membershipId,
    attendanceId: row.attempt.attendanceId,
    verifiedByName: row.verifierFirstName
      ? `${row.verifierFirstName} ${row.verifierLastName}`
      : null,
  }));
  return paginated(data, query.page, query.pageSize, totals?.total ?? 0);
}

/** Active devices, for the kiosk picker and the log filter. No keys, no health details. */
export async function listDeviceBriefs(): Promise<AccessDeviceBrief[]> {
  return db
    .select({
      id: accessDevices.id,
      name: accessDevices.name,
      location: accessDevices.location,
      deviceType: accessDevices.deviceType,
      status: accessDevices.status,
    })
    .from(accessDevices)
    .where(eq(accessDevices.status, 'ACTIVE'))
    .orderBy(asc(accessDevices.name));
}

/**
 * The simulator panel's fake fingerprints: every enrolled SIM- ID on an active simulated device,
 * with what a scan would give right now (read without locks, for display only), plus the reserved
 * unenrolled ID. Fake IDs are not sensitive, so they are shown in full.
 */
export async function simulatorFixtures(): Promise<SimulatorFixturesDto> {
  const devices = (await listDeviceBriefs()).filter((d) => d.deviceType === 'SIMULATED');
  if (devices.length === 0) return { devices, fixtures: [] };

  const enrolled = await db
    .select({
      deviceId: biometricEnrollments.deviceId,
      templateRef: biometricEnrollments.templateRef,
      memberId: members.id,
      firstName: members.firstName,
      lastName: members.lastName,
      archivedAt: members.archivedAt,
      accountStatus: members.accountStatus,
      accessBlocked: members.accessBlocked,
    })
    .from(biometricEnrollments)
    .innerJoin(members, eq(members.id, biometricEnrollments.memberId))
    .where(
      and(
        eq(biometricEnrollments.status, 'ACTIVE'),
        inArray(
          biometricEnrollments.deviceId,
          devices.map((d) => d.id),
        ),
      ),
    )
    .orderBy(asc(biometricEnrollments.templateRef));

  const memberIds = [...new Set(enrolled.map((row) => row.memberId))];
  const membershipRows = memberIds.length
    ? await db
        .select({
          id: memberships.id,
          memberId: memberships.memberId,
          status: memberships.status,
          startDate: memberships.startDate,
          endDate: memberships.endDate,
          accessDays: memberships.accessDaysSnapshot,
          accessStartTime: memberships.accessStartTimeSnapshot,
          accessEndTime: memberships.accessEndTimeSnapshot,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .where(inArray(memberships.memberId, memberIds))
    : [];
  const now = gymNow(config.gymTimezone);

  const fixtures: SimulatorFixture[] = enrolled.flatMap((row) => {
    if (!row.templateRef) return [];
    const expected = evaluateEligibility(
      {
        archived: row.archivedAt !== null,
        accountStatus: row.accountStatus,
        accessBlocked: row.accessBlocked,
      },
      membershipRows.filter((m) => m.memberId === row.memberId),
      now,
    ).reason;
    return [
      {
        deviceId: row.deviceId,
        templateRef: row.templateRef,
        label: `${row.firstName} ${row.lastName}`,
        memberFirstName: row.firstName,
        expected,
      },
    ];
  });
  for (const device of devices) {
    fixtures.push({
      deviceId: device.id,
      templateRef: SIM_UNENROLLED_REF,
      label: 'Unenrolled fingerprint',
      memberFirstName: null,
      expected: 'MEMBER_NOT_RECOGNIZED',
    });
  }
  return { devices, fixtures };
}
