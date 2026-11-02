import {
  ACCESS_REASON_LABELS,
  ACCESS_SOURCE_LABELS,
  addDays,
  daysBetween,
  EQUIPMENT_CONDITION_LABELS,
  MAINTENANCE_TYPE_LABELS,
  MAINTENANCE_TYPES,
  MEMBER_ACCOUNT_STATUS_LABELS,
  MEMBERSHIP_EVENT_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  type AccessReason,
  type AccessSource,
  type EquipmentCondition,
  type MaintenanceType,
  type MemberAccountStatus,
  type MembershipEventType,
  type MembershipStatus,
  type ReportRange,
  type ReportType,
} from '@gms/shared';
import { sql } from 'drizzle-orm';
import { members } from '../../db/schema';
import { currentEffectiveStatusSql } from '../memberships/current-membership';
import {
  buildSeries,
  dateBucket,
  dateInPeriod,
  instantBucket,
  instantInPeriod,
  isoOrNull,
  num,
  percent,
  personName,
  ROW_LIMIT,
  selectRows,
  TOTAL_ROWS,
  type BucketRow,
  type ReportBuilder,
} from './report-sql';

type Row = Record<string, unknown>;

const totalOf = (rows: Row[]) => num(rows[0]?.total_rows);

const statusLabel = (status: unknown) =>
  status ? MEMBERSHIP_STATUS_LABELS[status as MembershipStatus] : 'No membership';

/** Members by registration date (archived members included: they did register). */
const registrations: ReportBuilder = async (range, today) => {
  const status = currentEffectiveStatusSql(members.id, today);
  const inPeriod = dateInPeriod(sql`members.registration_date`, range);
  const [[totals], grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select count(*) as total,
        count(*) filter (where members.archived_at is null) as current,
        count(*) filter (where ${status} = 'ACTIVE') as active
      from members where ${inPeriod}`),
    selectRows<BucketRow>(sql`select ${dateBucket(sql`members.registration_date`, range.interval)} as bucket,
        count(*) as registrations
      from members where ${inPeriod} group by 1`),
    selectRows<Row>(sql`select members.member_code, members.first_name, members.last_name,
        members.registration_date::text as registration_date, members.account_status,
        members.archived_at is not null as archived, ${status} as membership_status,
        ${TOTAL_ROWS} as total_rows
      from members where ${inPeriod}
      order by members.registration_date desc, members.member_code desc ${ROW_LIMIT}`),
  ]);
  return {
    summary: [
      { key: 'registrations', label: 'Registrations', value: num(totals?.total), kind: 'number' },
      {
        key: 'current',
        label: 'Still members',
        value: num(totals?.current),
        kind: 'number',
        hint: 'not archived',
      },
      {
        key: 'active',
        label: 'Active today',
        value: num(totals?.active),
        kind: 'number',
        hint: 'membership active',
      },
    ],
    series: buildSeries(
      range,
      'number',
      [{ key: 'registrations', label: 'Registrations' }],
      grouped,
    ),
    breakdown: null,
    columns: [
      { key: 'registrationDate', label: 'Registered', kind: 'date' },
      { key: 'memberCode', label: 'Member code', kind: 'text' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'membershipStatus', label: 'Membership today', kind: 'text' },
      { key: 'accountStatus', label: 'Account', kind: 'text' },
    ],
    rows: rows.map((row) => ({
      registrationDate: String(row.registration_date),
      memberCode: String(row.member_code),
      member: personName(row.first_name, row.last_name),
      membershipStatus: statusLabel(row.membership_status),
      accountStatus: row.archived
        ? 'Archived'
        : MEMBER_ACCOUNT_STATUS_LABELS[row.account_status as MemberAccountStatus],
    })),
    totalRows: totalOf(rows),
  };
};

const STATUS_CHANGES = ['ACTIVATED', 'SUSPENDED', 'REACTIVATED', 'CANCELLED', 'EXPIRED'] as const;
const SNAPSHOT_ORDER = ['ACTIVE', 'PENDING', 'SUSPENDED', 'EXPIRED', 'CANCELLED', null] as const;

/** Current members by today's status (one per member, as on the dashboard), and the changes. */
const membershipStatus: ReportBuilder = async (range, today) => {
  const status = currentEffectiveStatusSql(members.id, today);
  const changes = sql`me.event_type in (${sql.join(
    STATUS_CHANGES.map((type) => sql`${type}`),
    sql`, `,
  )}) and ${instantInPeriod(sql`me.created_at`, range)}`;
  const [snapshot, grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select s.status, count(*) as total
      from (select ${status} as status from members where members.archived_at is null) s
      group by s.status`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`me.created_at`, range.interval)} as bucket,
        count(*) filter (where me.event_type = 'ACTIVATED') as activated,
        count(*) filter (where me.event_type = 'SUSPENDED') as suspended,
        count(*) filter (where me.event_type = 'CANCELLED') as cancelled,
        count(*) filter (where me.event_type = 'EXPIRED') as expired
      from membership_events me where ${changes} group by 1`),
    selectRows<Row>(sql`select me.created_at, me.event_type, me.from_status, me.to_status,
        m.member_code, m.first_name, m.last_name, ms.plan_name_snapshot,
        ${TOTAL_ROWS} as total_rows
      from membership_events me
      join members m on m.id = me.member_id
      join memberships ms on ms.id = me.membership_id
      where ${changes}
      order by me.created_at desc, me.id desc ${ROW_LIMIT}`),
  ]);
  const now = new Map(snapshot.map((row) => [row.status ?? null, num(row.total)]));
  const snapshotMetric = (key: MembershipStatus) => ({
    key: key.toLowerCase(),
    label: MEMBERSHIP_STATUS_LABELS[key],
    value: now.get(key) ?? 0,
    kind: 'number' as const,
    hint: 'today',
  });
  return {
    summary: [
      snapshotMetric('ACTIVE'),
      snapshotMetric('EXPIRED'),
      snapshotMetric('CANCELLED'),
      snapshotMetric('SUSPENDED'),
      {
        key: 'changes',
        label: 'Status changes',
        value: totalOf(rows),
        kind: 'number',
        hint: 'in the period',
      },
    ],
    series: buildSeries(
      range,
      'number',
      [
        { key: 'activated', label: 'Activated' },
        { key: 'suspended', label: 'Suspended' },
        { key: 'cancelled', label: 'Cancelled' },
        { key: 'expired', label: 'Expired' },
      ],
      grouped,
    ),
    breakdown: {
      title: 'Current members by membership status today',
      kind: 'number',
      items: SNAPSHOT_ORDER.map((key) => ({
        key: key ?? 'NONE',
        label: statusLabel(key),
        value: now.get(key) ?? 0,
      })),
    },
    columns: [
      { key: 'changedAt', label: 'When', kind: 'datetime' },
      { key: 'memberCode', label: 'Member code', kind: 'text' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'plan', label: 'Plan', kind: 'text' },
      { key: 'change', label: 'Change', kind: 'text' },
      { key: 'fromStatus', label: 'From', kind: 'text' },
      { key: 'toStatus', label: 'To', kind: 'text' },
    ],
    rows: rows.map((row) => ({
      changedAt: isoOrNull(row.created_at),
      memberCode: String(row.member_code),
      member: personName(row.first_name, row.last_name),
      plan: String(row.plan_name_snapshot),
      change: MEMBERSHIP_EVENT_LABELS[row.event_type as MembershipEventType],
      fromStatus: row.from_status ? statusLabel(row.from_status) : null,
      toStatus: statusLabel(row.to_status),
    })),
    totalRows: totalOf(rows),
  };
};

/** RENEWED events; each points at the new membership row. */
const renewals: ReportBuilder = async (range) => {
  const inPeriod = sql`me.event_type = 'RENEWED' and ${instantInPeriod(sql`me.created_at`, range)}`;
  const [[totals], grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select count(*) as total, count(distinct me.member_id) as members
      from membership_events me where ${inPeriod}`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`me.created_at`, range.interval)} as bucket,
        count(*) as renewals
      from membership_events me where ${inPeriod} group by 1`),
    selectRows<Row>(sql`select me.created_at, m.member_code, m.first_name, m.last_name,
        ms.plan_name_snapshot, ms.start_date::text as start_date, ms.end_date::text as end_date,
        actor.first_name as actor_first_name, actor.last_name as actor_last_name,
        ${TOTAL_ROWS} as total_rows
      from membership_events me
      join members m on m.id = me.member_id
      join memberships ms on ms.id = me.membership_id
      left join users actor on actor.id = me.actor_user_id
      where ${inPeriod}
      order by me.created_at desc, me.id desc ${ROW_LIMIT}`),
  ]);
  return {
    summary: [
      { key: 'renewals', label: 'Renewals', value: num(totals?.total), kind: 'number' },
      { key: 'members', label: 'Members who renewed', value: num(totals?.members), kind: 'number' },
    ],
    series: buildSeries(range, 'number', [{ key: 'renewals', label: 'Renewals' }], grouped),
    breakdown: null,
    columns: [
      { key: 'renewedAt', label: 'Renewed', kind: 'datetime' },
      { key: 'memberCode', label: 'Member code', kind: 'text' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'plan', label: 'New plan', kind: 'text' },
      { key: 'startDate', label: 'Starts', kind: 'date' },
      { key: 'endDate', label: 'Ends', kind: 'date' },
      { key: 'renewedBy', label: 'Renewed by', kind: 'text' },
    ],
    rows: rows.map((row) => ({
      renewedAt: isoOrNull(row.created_at),
      memberCode: String(row.member_code),
      member: personName(row.first_name, row.last_name),
      plan: String(row.plan_name_snapshot),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      renewedBy: personName(row.actor_first_name, row.actor_last_name),
    })),
    totalRows: totalOf(rows),
  };
};

/** Valid check-ins only: a voided record is not a visit. */
const attendance: ReportBuilder = async (range) => {
  const inPeriod = sql`ar.status = 'VALID' and ${instantInPeriod(sql`ar.check_in_at`, range)}`;
  const [[totals], bySource, grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select count(*) as total, count(distinct ar.member_id) as members
      from attendance_records ar where ${inPeriod}`),
    selectRows<Row>(sql`select ar.source, count(*) as total
      from attendance_records ar where ${inPeriod} group by ar.source`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`ar.check_in_at`, range.interval)} as bucket,
        count(*) as "checkIns"
      from attendance_records ar where ${inPeriod} group by 1`),
    selectRows<Row>(sql`select ar.check_in_at, ar.check_out_at, ar.source,
        m.member_code, m.first_name, m.last_name, ${TOTAL_ROWS} as total_rows
      from attendance_records ar join members m on m.id = ar.member_id
      where ${inPeriod}
      order by ar.check_in_at desc, ar.id desc ${ROW_LIMIT}`),
  ]);
  const checkIns = num(totals?.total);
  const days = daysBetween(range.from, range.to) + 1;
  const sources = new Map(bySource.map((row) => [row.source as AccessSource, num(row.total)]));
  return {
    summary: [
      { key: 'checkIns', label: 'Check-ins', value: checkIns, kind: 'number' },
      { key: 'members', label: 'Members who came', value: num(totals?.members), kind: 'number' },
      {
        key: 'dailyAverage',
        label: 'Daily average',
        value: Math.round((checkIns / days) * 10) / 10,
        kind: 'number',
      },
    ],
    series: buildSeries(range, 'number', [{ key: 'checkIns', label: 'Check-ins' }], grouped),
    breakdown: {
      title: 'Check-ins by source',
      kind: 'number',
      items: (['REAL', 'SIMULATED', 'MANUAL'] as const).map((source) => ({
        key: source,
        label: ACCESS_SOURCE_LABELS[source],
        value: sources.get(source) ?? 0,
      })),
    },
    columns: [
      { key: 'checkInAt', label: 'Checked in', kind: 'datetime' },
      { key: 'memberCode', label: 'Member code', kind: 'text' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'source', label: 'Source', kind: 'text' },
      { key: 'checkOutAt', label: 'Checked out', kind: 'datetime' },
    ],
    rows: rows.map((row) => ({
      checkInAt: isoOrNull(row.check_in_at),
      memberCode: String(row.member_code),
      member: personName(row.first_name, row.last_name),
      source: ACCESS_SOURCE_LABELS[row.source as AccessSource],
      checkOutAt: isoOrNull(row.check_out_at),
    })),
    totalRows: totalOf(rows),
  };
};

/** Valid check-ins and denied attempts per bucket, for the dashboard attendance chart. */
export async function attendanceByBucket(range: ReportRange) {
  const [checkIns, denied] = await Promise.all([
    selectRows<BucketRow>(sql`select ${instantBucket(sql`ar.check_in_at`, range.interval)} as bucket,
        count(*) as "checkIns"
      from attendance_records ar
      where ar.status = 'VALID' and ${instantInPeriod(sql`ar.check_in_at`, range)} group by 1`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`aa.occurred_at`, range.interval)} as bucket,
        count(*) as denied
      from access_attempts aa
      where aa.result = 'DENIED' and ${instantInPeriod(sql`aa.occurred_at`, range)} group by 1`),
  ]);
  const deniedByBucket = new Map(denied.map((row) => [row.bucket, row.denied]));
  const merged: BucketRow[] = [
    ...checkIns.map((row) => ({ ...row, denied: deniedByBucket.get(row.bucket) })),
    ...denied.filter((row) => !checkIns.some((c) => c.bucket === row.bucket)),
  ];
  return buildSeries(
    range,
    'number',
    [
      { key: 'checkIns', label: 'Check-ins' },
      { key: 'denied', label: 'Denied' },
    ],
    merged,
  );
}

const MEMBERSHIP_REASONS: AccessReason[] = [
  'NO_MEMBERSHIP',
  'MEMBERSHIP_NOT_ACTIVATED',
  'MEMBERSHIP_NOT_STARTED',
  'MEMBERSHIP_EXPIRED',
  'MEMBERSHIP_CANCELLED',
  'MEMBERSHIP_SUSPENDED',
  'OUTSIDE_ACCESS_HOURS',
];
const SYSTEM_REASONS: AccessReason[] = [
  'SCANNER_UNAVAILABLE',
  'AUTHORIZATION_UNAVAILABLE',
  'DEVICE_NOT_AUTHORIZED',
];

/** Every denied attempt. Only the reason, member, device and time: never any biometric reference. */
const deniedAccess: ReportBuilder = async (range) => {
  const inPeriod = sql`aa.result = 'DENIED' and ${instantInPeriod(sql`aa.occurred_at`, range)}`;
  const [byReason, grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select aa.reason, count(*) as total
      from access_attempts aa where ${inPeriod} group by aa.reason`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`aa.occurred_at`, range.interval)} as bucket,
        count(*) as denied
      from access_attempts aa where ${inPeriod} group by 1`),
    selectRows<Row>(sql`select aa.occurred_at, aa.reason, aa.source,
        m.member_code, m.first_name, m.last_name, d.name as device_name,
        ${TOTAL_ROWS} as total_rows
      from access_attempts aa
      left join members m on m.id = aa.member_id
      left join access_devices d on d.id = aa.device_id
      where ${inPeriod}
      order by aa.occurred_at desc, aa.id desc ${ROW_LIMIT}`),
  ]);
  const reasons = new Map(byReason.map((row) => [row.reason as AccessReason, num(row.total)]));
  const sumOf = (list: AccessReason[]) =>
    list.reduce((sum, reason) => sum + (reasons.get(reason) ?? 0), 0);
  return {
    summary: [
      { key: 'denied', label: 'Denied attempts', value: totalOf(rows), kind: 'number' },
      {
        key: 'notRecognized',
        label: 'Not recognized',
        value: reasons.get('MEMBER_NOT_RECOGNIZED') ?? 0,
        kind: 'number',
      },
      {
        key: 'membership',
        label: 'Membership problems',
        value: sumOf(MEMBERSHIP_REASONS),
        kind: 'number',
        hint: 'expired, cancelled, suspended …',
      },
      {
        key: 'system',
        label: 'Scanner or system',
        value: sumOf(SYSTEM_REASONS),
        kind: 'number',
        hint: 'failed closed',
      },
    ],
    series: buildSeries(range, 'number', [{ key: 'denied', label: 'Denied' }], grouped),
    breakdown: {
      title: 'Denied attempts by reason',
      kind: 'number',
      items: [...reasons.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([reason, value]) => ({ key: reason, label: ACCESS_REASON_LABELS[reason], value })),
    },
    columns: [
      { key: 'occurredAt', label: 'When', kind: 'datetime' },
      { key: 'reason', label: 'Reason', kind: 'text' },
      { key: 'memberCode', label: 'Member code', kind: 'text' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'device', label: 'Device', kind: 'text' },
      { key: 'source', label: 'Source', kind: 'text' },
    ],
    rows: rows.map((row) => ({
      occurredAt: isoOrNull(row.occurred_at),
      reason: ACCESS_REASON_LABELS[row.reason as AccessReason],
      memberCode: row.member_code ? String(row.member_code) : null,
      member: personName(row.first_name, row.last_name),
      device: row.device_name ? String(row.device_name) : null,
      source: ACCESS_SOURCE_LABELS[row.source as AccessSource],
    })),
    totalRows: totalOf(rows),
  };
};

/**
 * Sessions starting in the period. Seated bookings hold a place (booked, attended, no-show); the
 * attendance rate is attended out of the bookings staff have marked. Cancelled sessions are
 * listed but left out of the totals.
 */
const classAttendance: ReportBuilder = async (range) => {
  const inPeriod = instantInPeriod(sql`cs.starts_at`, range);
  const perSession = sql`select cs.id, cs.starts_at, cs.ends_at, cs.status, cs.capacity, cs.room,
      fc.name as class_name, t.first_name as trainer_first_name, t.last_name as trainer_last_name,
      count(cb.id) filter (where cb.status in ('BOOKED', 'ATTENDED', 'NO_SHOW')) as booked,
      count(cb.id) filter (where cb.status = 'ATTENDED') as attended,
      count(cb.id) filter (where cb.status = 'NO_SHOW') as no_shows
    from class_sessions cs
    join fitness_classes fc on fc.id = cs.class_id
    join users t on t.id = cs.trainer_id
    left join class_bookings cb on cb.session_id = cs.id
    where ${inPeriod}
    group by cs.id, fc.name, t.first_name, t.last_name`;
  const [[totals], grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select count(*) filter (where s.status <> 'CANCELLED') as sessions,
        count(*) filter (where s.status = 'CANCELLED') as cancelled,
        coalesce(sum(s.booked) filter (where s.status <> 'CANCELLED'), 0) as booked,
        coalesce(sum(s.attended) filter (where s.status <> 'CANCELLED'), 0) as attended,
        coalesce(sum(s.no_shows) filter (where s.status <> 'CANCELLED'), 0) as no_shows
      from (${perSession}) s`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`s.starts_at`, range.interval)} as bucket,
        sum(s.attended) as attended, sum(s.no_shows) as "noShows"
      from (${perSession}) s where s.status <> 'CANCELLED' group by 1`),
    selectRows<Row>(sql`select s.*, ${TOTAL_ROWS} as total_rows from (${perSession}) s
      order by s.starts_at desc, s.id desc ${ROW_LIMIT}`),
  ]);
  const attended = num(totals?.attended);
  const noShows = num(totals?.no_shows);
  const now = Date.now();
  return {
    summary: [
      { key: 'sessions', label: 'Sessions held', value: num(totals?.sessions), kind: 'number' },
      { key: 'booked', label: 'Places booked', value: num(totals?.booked), kind: 'number' },
      { key: 'attended', label: 'Attended', value: attended, kind: 'number' },
      { key: 'noShows', label: 'No-shows', value: noShows, kind: 'number' },
      {
        key: 'attendanceRate',
        label: 'Attendance rate',
        value: percent(attended, attended + noShows),
        kind: 'percent',
        hint: 'of marked bookings',
      },
    ],
    series: buildSeries(
      range,
      'number',
      [
        { key: 'attended', label: 'Attended' },
        { key: 'noShows', label: 'No-shows' },
      ],
      grouped,
    ),
    breakdown: null,
    columns: [
      { key: 'startsAt', label: 'Starts', kind: 'datetime' },
      { key: 'className', label: 'Class', kind: 'text' },
      { key: 'trainer', label: 'Trainer', kind: 'text' },
      { key: 'room', label: 'Room', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'capacity', label: 'Capacity', kind: 'number' },
      { key: 'booked', label: 'Booked', kind: 'number' },
      { key: 'attended', label: 'Attended', kind: 'number' },
      { key: 'noShows', label: 'No-shows', kind: 'number' },
    ],
    rows: rows.map((row) => ({
      startsAt: isoOrNull(row.starts_at),
      className: String(row.class_name),
      trainer: personName(row.trainer_first_name, row.trainer_last_name),
      room: row.room ? String(row.room) : null,
      status:
        row.status === 'CANCELLED'
          ? 'Cancelled'
          : Date.parse(isoOrNull(row.ends_at) ?? '') <= now
            ? 'Completed'
            : 'Scheduled',
      capacity: num(row.capacity),
      booked: num(row.booked),
      attended: num(row.attended),
      noShows: num(row.no_shows),
    })),
    totalRows: totalOf(rows),
  };
};

const DUE_WITHIN_DAYS = 7;

/** Maintenance work done in the period, and what is due for service as of today. */
const equipmentMaintenance: ReportBuilder = async (range, today) => {
  const inPeriod = dateInPeriod(sql`mr.performed_on`, range);
  const [[totals], byType, [due], grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select count(*) as total, coalesce(sum(mr.cost_minor), 0) as cost
      from maintenance_records mr where ${inPeriod}`),
    selectRows<Row>(sql`select mr.type, count(*) as total
      from maintenance_records mr where ${inPeriod} group by mr.type`),
    selectRows<Row>(sql`select count(*) as total,
        count(*) filter (where e.next_maintenance_date < ${today}::date) as overdue
      from equipment e
      where e.status <> 'RETIRED'
        and e.next_maintenance_date <= ${addDays(today, DUE_WITHIN_DAYS)}::date`),
    selectRows<BucketRow>(sql`select ${dateBucket(sql`mr.performed_on`, range.interval)} as bucket,
        count(*) as records
      from maintenance_records mr where ${inPeriod} group by 1`),
    selectRows<Row>(sql`select mr.performed_on::text as performed_on, mr.type, mr.condition_after,
        mr.cost_minor, mr.performed_by_name, mr.next_maintenance_date::text as next_date,
        e.name as equipment_name, ${TOTAL_ROWS} as total_rows
      from maintenance_records mr join equipment e on e.id = mr.equipment_id
      where ${inPeriod}
      order by mr.performed_on desc, mr.created_at desc, mr.id desc ${ROW_LIMIT}`),
  ]);
  const types = new Map(byType.map((row) => [row.type as MaintenanceType, num(row.total)]));
  return {
    summary: [
      { key: 'records', label: 'Maintenance records', value: num(totals?.total), kind: 'number' },
      { key: 'repairs', label: 'Repairs', value: types.get('REPAIR') ?? 0, kind: 'number' },
      { key: 'cost', label: 'Maintenance cost', value: num(totals?.cost), kind: 'money' },
      {
        key: 'dueNow',
        label: 'Due for service',
        value: num(due?.total),
        kind: 'number',
        hint: `today, within ${DUE_WITHIN_DAYS} days or overdue`,
      },
      {
        key: 'overdueNow',
        label: 'Overdue for service',
        value: num(due?.overdue),
        kind: 'number',
        hint: 'today',
      },
    ],
    series: buildSeries(range, 'number', [{ key: 'records', label: 'Records' }], grouped),
    breakdown: {
      title: 'Maintenance by type',
      kind: 'number',
      items: MAINTENANCE_TYPES.map((type) => ({
        key: type,
        label: MAINTENANCE_TYPE_LABELS[type],
        value: types.get(type) ?? 0,
      })),
    },
    columns: [
      { key: 'performedOn', label: 'Date', kind: 'date' },
      { key: 'equipment', label: 'Equipment', kind: 'text' },
      { key: 'type', label: 'Type', kind: 'text' },
      { key: 'conditionAfter', label: 'Condition after', kind: 'text' },
      { key: 'cost', label: 'Cost', kind: 'money' },
      { key: 'performedBy', label: 'Done by', kind: 'text' },
      { key: 'nextDate', label: 'Next service', kind: 'date' },
    ],
    rows: rows.map((row) => ({
      performedOn: String(row.performed_on),
      equipment: String(row.equipment_name),
      type: MAINTENANCE_TYPE_LABELS[row.type as MaintenanceType],
      conditionAfter: EQUIPMENT_CONDITION_LABELS[row.condition_after as EquipmentCondition],
      cost: row.cost_minor === null ? null : num(row.cost_minor),
      performedBy: row.performed_by_name ? String(row.performed_by_name) : null,
      nextDate: row.next_date ? String(row.next_date) : null,
    })),
    totalRows: totalOf(rows),
  };
};

export const OPERATIONAL_REPORTS: Partial<Record<ReportType, ReportBuilder>> = {
  registrations,
  'membership-status': membershipStatus,
  renewals,
  attendance,
  'denied-access': deniedAccess,
  'class-attendance': classAttendance,
  'equipment-maintenance': equipmentMaintenance,
};
