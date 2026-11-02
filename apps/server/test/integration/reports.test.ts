import { randomUUID } from 'node:crypto';
import {
  ACCESS_REASON_LABELS,
  addDays,
  REPORT_TYPES,
  type ReportDto,
  type Role,
} from '@gms/shared';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../../src/db/client';
import {
  accessAttempts,
  appointments,
  attendanceRecords,
  classBookings,
  classSessions,
  equipment,
  fitnessClasses,
  invoices,
  maintenanceRecords,
  membershipEvents,
  payments,
  refunds,
} from '../../src/db/schema';
import { gymLocalToInstant, gymToday, gymWallClock } from '../../src/lib/dates';
import { signIn, testApp, type Session } from '../setup/auth';
import { resetTables } from '../setup/db';
import {
  createMember,
  createMembership,
  createPlan,
  createUser,
  type TestUser,
} from '../setup/factories';

const app = testApp();
const anonymous = () => request(app);

/**
 * Scenario 16: every report against raw SQL and hand-computed figures. The period is March 2026
 * in gym time (Asia/Karachi, UTC+5), so midnight in the gym is 19:00 UTC the day before: a UTC
 * date would put the first and last instants in the wrong period.
 */
const FROM = '2026-03-01';
const TO = '2026-03-31';
const at = (date: string, time: string, extraMs = 0) =>
  new Date(gymLocalToInstant(date, time).getTime() + extraMs);
const JUST_BEFORE = at('2026-02-28', '23:59', 59_999);
const FIRST_INSTANT = at(FROM, '00:00');
const LAST_INSTANT = at(TO, '23:59', 59_999);
const JUST_AFTER = at('2026-04-01', '00:00');
const PERIOD = `from=${FROM}&to=${TO}`;

let admin: TestUser;
let session: Session;

beforeEach(async () => {
  await resetTables();
  admin = await createUser({ role: 'ADMIN', firstName: 'Ayesha', lastName: 'Malik' });
  session = await signIn(app, admin);
});
afterAll(closeDb);

const report = (s: Session, type: string, query = PERIOD) =>
  s.agent.get(`/api/v1/reports/${type}?${query}`);

async function json(type: string, query = PERIOD): Promise<ReportDto> {
  const res = await report(session, type, query);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as ReportDto;
}

const metric = (dto: ReportDto, key: string) => dto.summary.find((m) => m.key === key)?.value;
const point = (dto: ReportDto, bucket: string) =>
  dto.series?.points.find((p) => p.bucket === bucket)?.values;

async function member(firstName = 'Test', lastName = 'Member') {
  const plan = await createPlan();
  const created = await createMember({ firstName, lastName });
  const membership = await createMembership(created, plan, {
    startDate: '2026-01-01',
    endDate: '2026-12-31',
  });
  return { member: created, membership, plan };
}

/** A granted entry and its attendance row (they reference each other; checked at commit). */
async function checkIn(
  m: { member: { id: string }; membership: { id: string } },
  when: Date,
  options: { source?: 'SIMULATED' | 'MANUAL'; status?: 'VALID' | 'VOIDED' } = {},
) {
  const source = options.source ?? 'SIMULATED';
  await db.transaction(async (tx) => {
    const attendanceId = randomUUID();
    const [attempt] = await tx
      .insert(accessAttempts)
      .values({
        occurredAt: when,
        source,
        memberId: m.member.id,
        membershipId: m.membership.id,
        result: 'GRANTED',
        reason: 'GRANTED',
        attendanceId,
        verifiedByUserId: source === 'MANUAL' ? admin.id : null,
      })
      .returning();
    await tx.insert(attendanceRecords).values({
      id: attendanceId,
      memberId: m.member.id,
      membershipId: m.membership.id,
      checkInAt: when,
      source,
      accessAttemptId: attempt!.id,
      status: options.status ?? 'VALID',
      createdBy: source === 'MANUAL' ? admin.id : null,
    });
  });
}

async function payment(memberId: string, amountMinor: number, receivedAt: Date, method = 'CASH') {
  const [invoice] = await db
    .insert(invoices)
    .values({ memberId, description: 'Monthly fee', amountDueMinor: amountMinor, dueDate: FROM })
    .returning();
  const [paid] = await db
    .insert(payments)
    .values({
      invoiceId: invoice!.id,
      memberId,
      amountMinor,
      method: method as 'CASH',
      reference: method === 'CASH' ? null : 'TXN-1',
      status: 'COMPLETED',
      receivedAt,
    })
    .returning();
  return paid!;
}

/** Splits a CSV body into rows of cells (RFC 4180), dropping the byte-order mark. */
function parseCsv(body: string): string[][] {
  const text = body.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  return rows;
}

/** The JSON row as the CSV must show it, computed independently of the CSV writer. */
function expectedCsvRow(dto: ReportDto, row: ReportDto['rows'][number]) {
  return dto.columns.map(({ key, kind }) => {
    const value = row[key] ?? null;
    if (value === null) return '';
    if (kind === 'money') return (Number(value) / 100).toFixed(2);
    if (kind === 'datetime') {
      const wall = gymWallClock(new Date(String(value)));
      return `${wall.date} ${wall.time}`;
    }
    const textValue = String(value);
    return kind === 'text' && /^[=+\-@\t\r]/.test(textValue) ? `'${textValue}` : textValue;
  });
}

async function expectCsvMatchesJson(type: string, query = PERIOD) {
  const dto = await json(type, query);
  const res = await report(session, type, `${query}&format=csv`).buffer(true);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
  // The name is a plain token, so Express leaves it unquoted (RFC 6266 allows both).
  expect(res.headers['content-disposition']).toBe(
    `attachment; filename=${type}_${dto.from}_${dto.to}.csv`,
  );
  expect(res.headers['cache-control']).toBe('no-store');
  const body = res.text;
  expect(body.charCodeAt(0)).toBe(0xfeff);
  const [header, ...rows] = parseCsv(body);
  expect(header).toEqual(dto.columns.map((column) => column.label));
  expect(rows).toHaveLength(dto.rows.length);
  expect(rows).toEqual(dto.rows.map((row) => expectedCsvRow(dto, row)));
  return dto;
}

describe('attendance report (scenario 16)', () => {
  it('counts valid check-ins with inclusive gym-time boundaries, matching raw SQL', async () => {
    const sana = await member('Sana', 'Iqbal');
    const omar = await member('Omar', 'Farooq');
    await checkIn(sana, JUST_BEFORE);
    await checkIn(sana, FIRST_INSTANT);
    await checkIn(omar, at('2026-03-15', '18:00'), { source: 'MANUAL' });
    await checkIn(omar, at('2026-03-16', '07:00'), { status: 'VOIDED' });
    await checkIn(sana, LAST_INSTANT);
    await checkIn(sana, JUST_AFTER);

    const dto = await json('attendance');
    expect(dto).toMatchObject({ type: 'attendance', from: FROM, to: TO, interval: 'day' });
    // Hand-computed: first instant, 15 March and last instant; not the voided one or either edge.
    expect(metric(dto, 'checkIns')).toBe(3);
    expect(metric(dto, 'members')).toBe(2);
    expect(metric(dto, 'dailyAverage')).toBe(0.1);
    expect(dto.series!.points).toHaveLength(31);
    expect(point(dto, FROM)).toEqual({ checkIns: 1 });
    expect(point(dto, '2026-03-15')).toEqual({ checkIns: 1 });
    expect(point(dto, '2026-03-16')).toEqual({ checkIns: 0 });
    expect(point(dto, TO)).toEqual({ checkIns: 1 });
    expect(dto.breakdown!.items).toEqual([
      { key: 'REAL', label: expect.any(String), value: 0 },
      { key: 'SIMULATED', label: expect.any(String), value: 2 },
      { key: 'MANUAL', label: expect.any(String), value: 1 },
    ]);
    expect(dto.rows.map((row) => row.checkInAt)).toEqual([
      LAST_INSTANT.toISOString(),
      at('2026-03-15', '18:00').toISOString(),
      FIRST_INSTANT.toISOString(),
    ]);
    expect(dto.rows[0]).toMatchObject({ member: 'Sana Iqbal', checkOutAt: null });
    expect(dto.totalRows).toBe(3);
    expect(dto.truncated).toBe(false);

    const raw = await db.execute<{ n: number }>(sql`select count(*)::int as n
      from attendance_records where status = 'VALID'
        and (check_in_at at time zone 'Asia/Karachi')::date between ${FROM}::date and ${TO}::date`);
    expect(raw.rows[0]!.n).toBe(3);
  });

  it('exports the same rows as CSV, with instants in gym time', async () => {
    const sana = await member('Sana', 'Iqbal');
    await checkIn(sana, FIRST_INSTANT);
    await checkIn(sana, LAST_INSTANT);
    await expectCsvMatchesJson('attendance');
    const res = await report(session, 'attendance', `${PERIOD}&format=csv`).buffer(true);
    // The first instant is 28 February in UTC; the CSV shows the gym's 1 March.
    expect(res.text).toContain('2026-03-01 00:00');
    expect(res.text).toContain('2026-03-31 23:59');
  });

  it('groups by month for long periods and keeps every month, even empty ones', async () => {
    const sana = await member();
    await checkIn(sana, at('2026-01-31', '23:00'));
    await checkIn(sana, at('2026-03-01', '00:00'));
    const dto = await json('attendance', 'from=2026-01-01&to=2026-06-30');
    expect(dto.interval).toBe('month');
    expect(dto.series!.points.map((p) => [p.bucket, p.values.checkIns])).toEqual([
      ['2026-01', 1],
      ['2026-02', 0],
      ['2026-03', 1],
      ['2026-04', 0],
      ['2026-05', 0],
      ['2026-06', 0],
    ]);
    expect((await json('attendance', `${PERIOD}&interval=month`)).series!.points).toEqual([
      { bucket: '2026-03', values: { checkIns: 1 } },
    ]);
  });
});

describe('denied access report', () => {
  it('counts denials by reason in the period and never exposes a biometric reference', async () => {
    const { member: zara } = await member('Zara', 'Ahmed');
    const deny = (reason: string, occurredAt: Date, memberId: string | null = zara.id) =>
      db.insert(accessAttempts).values({
        occurredAt,
        source: 'SIMULATED',
        memberId,
        result: 'DENIED',
        reason: reason as 'MEMBERSHIP_CANCELLED',
      });
    await deny('MEMBERSHIP_CANCELLED', FIRST_INSTANT);
    await deny('MEMBERSHIP_CANCELLED', at('2026-03-10', '09:00'));
    await deny('MEMBER_NOT_RECOGNIZED', at('2026-03-10', '09:05'), null);
    await deny('SCANNER_UNAVAILABLE', LAST_INSTANT, null);
    await deny('MEMBERSHIP_EXPIRED', JUST_AFTER);

    const dto = await json('denied-access');
    expect(metric(dto, 'denied')).toBe(4);
    expect(metric(dto, 'notRecognized')).toBe(1);
    expect(metric(dto, 'membership')).toBe(2);
    expect(metric(dto, 'system')).toBe(1);
    expect(dto.breakdown!.items.map((item) => [item.key, item.value])).toEqual([
      ['MEMBERSHIP_CANCELLED', 2],
      ['MEMBER_NOT_RECOGNIZED', 1],
      ['SCANNER_UNAVAILABLE', 1],
    ]);
    expect(point(dto, '2026-03-10')).toEqual({ denied: 2 });
    const unknown = dto.rows.find(
      (row) => row.reason === ACCESS_REASON_LABELS.MEMBER_NOT_RECOGNIZED,
    );
    expect(unknown).toMatchObject({ member: null, memberCode: null });
    expect(dto.columns.map((column) => column.key)).toEqual([
      'occurredAt',
      'reason',
      'memberCode',
      'member',
      'device',
      'source',
    ]);
    expect(JSON.stringify(dto)).not.toMatch(/template|enrol/i);

    const raw = await db.execute<{ n: number }>(sql`select count(*)::int as n from access_attempts
      where result = 'DENIED' and occurred_at >= ${FIRST_INSTANT.toISOString()}::timestamptz
        and occurred_at < ${JUST_AFTER.toISOString()}::timestamptz`);
    expect(raw.rows[0]!.n).toBe(4);
    await expectCsvMatchesJson('denied-access');
  });
});

describe('registrations, membership status and renewals', () => {
  it('lists registrations by date, inclusive at both ends, archived members included', async () => {
    const plan = await createPlan();
    await createMember({ registrationDate: '2026-02-28' });
    const first = await createMember({
      registrationDate: FROM,
      firstName: 'Hina',
      lastName: 'Shah',
    });
    await createMembership(first, plan, { startDate: FROM, endDate: '2026-12-31' });
    await createMember({ registrationDate: TO, archivedAt: new Date(), archivedBy: admin.id });
    await createMember({ registrationDate: '2026-04-01' });

    const dto = await json('registrations');
    expect(metric(dto, 'registrations')).toBe(2);
    expect(metric(dto, 'current')).toBe(1);
    expect(metric(dto, 'active')).toBe(1);
    expect(point(dto, FROM)).toEqual({ registrations: 1 });
    expect(point(dto, TO)).toEqual({ registrations: 1 });
    expect(dto.rows.map((row) => [row.registrationDate, row.accountStatus])).toEqual([
      [TO, 'Archived'],
      [FROM, 'Active'],
    ]);
    expect(dto.rows[1]).toMatchObject({ member: 'Hina Shah', membershipStatus: 'Active' });
    expect(dto.rows[0]!.membershipStatus).toBe('No membership');

    const raw = await db.execute<{ n: number }>(sql`select count(*)::int as n from members
      where registration_date between ${FROM}::date and ${TO}::date`);
    expect(raw.rows[0]!.n).toBe(2);
    await expectCsvMatchesJson('registrations');
  });

  it('shows today’s status per current member and the status changes in the period', async () => {
    const plan = await createPlan({ name: 'Monthly Standard' });
    const today = gymToday();
    const active = await createMember({ firstName: 'Ali', lastName: 'Raza' });
    const ms = await createMembership(active, plan, {
      startDate: addDays(today, -10),
      endDate: addDays(today, 20),
    });
    const cancelled = await createMember();
    const cancelledMs = await createMembership(cancelled, plan, {
      startDate: addDays(today, -10),
      endDate: addDays(today, 20),
      status: 'CANCELLED',
    });
    const lapsed = await createMember();
    await createMembership(lapsed, plan, {
      startDate: addDays(today, -60),
      endDate: addDays(today, -30),
    });
    await createMember();
    const event = (
      membership: { id: string; memberId: string },
      eventType: 'ACTIVATED' | 'CANCELLED' | 'RENEWED' | 'CREATED',
      createdAt: Date,
    ) =>
      db.insert(membershipEvents).values({
        membershipId: membership.id,
        memberId: membership.memberId,
        eventType,
        fromStatus: eventType === 'CANCELLED' ? 'ACTIVE' : 'PENDING',
        toStatus: eventType === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
        actorUserId: admin.id,
        createdAt,
      });
    await event(ms, 'CREATED', FIRST_INSTANT);
    await event(ms, 'ACTIVATED', FIRST_INSTANT);
    await event(cancelledMs, 'CANCELLED', LAST_INSTANT);
    await event(cancelledMs, 'ACTIVATED', JUST_BEFORE);
    await event(ms, 'RENEWED', at('2026-03-20', '12:00'));
    await event(cancelledMs, 'RENEWED', JUST_AFTER);

    const status = await json('membership-status');
    // Today: one active (Ali), one cancelled, one lapsed past its end date, one with none.
    expect(metric(status, 'active')).toBe(1);
    expect(metric(status, 'cancelled')).toBe(1);
    expect(metric(status, 'expired')).toBe(1);
    expect(metric(status, 'suspended')).toBe(0);
    expect(status.breakdown!.items.find((item) => item.key === 'NONE')!.value).toBe(1);
    // Changes in March: the activation on 1 March and the cancellation on 31 March.
    expect(metric(status, 'changes')).toBe(2);
    expect(point(status, FROM)).toMatchObject({ activated: 1, cancelled: 0 });
    expect(point(status, TO)).toMatchObject({ activated: 0, cancelled: 1 });
    expect(status.rows.map((row) => row.change)).toEqual(['Cancelled', 'Activated']);
    expect(status.rows[1]).toMatchObject({ plan: 'Monthly Standard', member: 'Ali Raza' });

    const raw = await db.execute<{ status: string | null; n: number }>(sql`
      select coalesce(s.status, 'NONE') as status, count(*)::int as n from (
        select (select case when ms.status = 'ACTIVE' and ms.end_date < ${today}::date
                            then 'EXPIRED' else ms.status::text end
                from memberships ms where ms.member_id = m.id
                order by ms.start_date desc limit 1) as status
        from members m where m.archived_at is null) s group by 1`);
    expect(Object.fromEntries(raw.rows.map((r) => [r.status, r.n]))).toEqual({
      ACTIVE: 1,
      CANCELLED: 1,
      EXPIRED: 1,
      NONE: 1,
    });

    const renewals = await json('renewals');
    expect(metric(renewals, 'renewals')).toBe(1);
    expect(metric(renewals, 'members')).toBe(1);
    expect(renewals.rows).toEqual([
      expect.objectContaining({ member: 'Ali Raza', renewedBy: 'Ayesha Malik' }),
    ]);
    await expectCsvMatchesJson('membership-status');
    await expectCsvMatchesJson('renewals');
  });
});

describe('payments, revenue and outstanding balances (financial)', () => {
  it('sums completed payments and refunds in the period, matching raw SQL', async () => {
    const { member: m } = await member('Bilal', 'Khan');
    await payment(m.id, 10_000, JUST_BEFORE);
    const first = await payment(m.id, 50_000, FIRST_INSTANT);
    await payment(m.id, 25_000, at('2026-03-15', '12:00'), 'BANK_TRANSFER');
    const last = await payment(m.id, 30_000, LAST_INSTANT);
    await payment(m.id, 99_000, JUST_AFTER);
    const refund = (paymentId: string, amountMinor: number, refundedAt: Date) =>
      db
        .insert(refunds)
        .values({ paymentId, amountMinor, reason: 'Overcharged', method: 'CASH', refundedAt });
    await refund(first.id, 5_000, at('2026-03-02', '10:00'));
    // Refunded in April: counts for revenue in April, but is still "refunded since" on the payment.
    await refund(last.id, 2_000, JUST_AFTER);

    const paid = await json('payments');
    expect(metric(paid, 'payments')).toBe(3);
    expect(metric(paid, 'collected')).toBe(105_000);
    expect(metric(paid, 'refunded')).toBe(7_000);
    expect(paid.breakdown!.items.find((item) => item.key === 'CASH')!.value).toBe(80_000);
    expect(paid.breakdown!.items.find((item) => item.key === 'BANK_TRANSFER')!.value).toBe(25_000);
    expect(paid.rows.map((row) => [row.amount, row.refunded])).toEqual([
      [30_000, 2_000],
      [25_000, 0],
      [50_000, 5_000],
    ]);

    const revenue = await json('revenue');
    // Collected 105_000 in March; 5_000 refunded in March (the April refund is not).
    expect(metric(revenue, 'collected')).toBe(105_000);
    expect(metric(revenue, 'refunded')).toBe(5_000);
    expect(metric(revenue, 'net')).toBe(100_000);
    expect(metric(revenue, 'payments')).toBe(3);
    expect(revenue.rows).toHaveLength(31);
    expect(revenue.rows.find((row) => row.period === '2026-03-02')).toEqual({
      period: '2026-03-02',
      payments: 0,
      collected: 0,
      refunds: 1,
      refunded: 5_000,
      net: -5_000,
    });
    expect(point(revenue, FROM)).toEqual({ collected: 50_000, refunded: 0, net: 50_000 });

    const raw = await db.execute<{ collected: string; refunded: string }>(sql`select
      (select sum(amount_minor) from payments where status = 'COMPLETED'
        and (received_at at time zone 'Asia/Karachi')::date between ${FROM}::date and ${TO}::date) as collected,
      (select sum(amount_minor) from refunds
        where (refunded_at at time zone 'Asia/Karachi')::date between ${FROM}::date and ${TO}::date) as refunded`);
    expect(Number(raw.rows[0]!.collected)).toBe(105_000);
    expect(Number(raw.rows[0]!.refunded)).toBe(5_000);

    await expectCsvMatchesJson('payments');
    const csv = await report(session, 'revenue', `${PERIOD}&format=csv`).buffer(true);
    expect(csv.text).toContain('2026-03-02,0,0.00,1,50.00,-50.00');
    await expectCsvMatchesJson('revenue');
  });

  it('lists invoices due in the period that still owe money, agreeing with the dashboard', async () => {
    const today = gymToday();
    const { member: m } = await member('Nadia', 'Hussain');
    const post = (path: string, body: object) =>
      session.agent.post(`/api/v1${path}`).set('X-CSRF-Token', session.csrf).send(body);
    const charge = (amountDueMinor: number, dueDate: string) =>
      post('/invoices', { memberId: m.id, description: 'Locker rental', amountDueMinor, dueDate });
    await charge(60_000, addDays(today, -3)).expect(201);
    const part = (await charge(50_000, addDays(today, -3)).expect(201)).body;
    await charge(20_000, today).expect(201);
    const settled = (await charge(30_000, today).expect(201)).body;
    await charge(40_000, addDays(today, 40)).expect(201);
    await post('/payments', { invoiceId: part.id, amountMinor: 40_000, method: 'CASH' }).expect(
      201,
    );
    await post('/payments', { invoiceId: settled.id, amountMinor: 30_000, method: 'CASH' }).expect(
      201,
    );

    const period = `from=${addDays(today, -29)}&to=${today}`;
    const dto = await json('outstanding-balances', period);
    // 60_000 overdue + 10_000 left on the part-paid one + 20_000 due today; not the settled one
    // nor the one due outside the period.
    expect(metric(dto, 'invoices')).toBe(3);
    expect(metric(dto, 'outstanding')).toBe(90_000);
    expect(metric(dto, 'overdue')).toBe(1);
    expect(metric(dto, 'overdueAmount')).toBe(60_000);
    expect(dto.rows.map((row) => [row.balance, row.status, row.daysPastDue])).toEqual([
      [60_000, 'Overdue', 3],
      [10_000, 'Partially paid', 3],
      [20_000, 'Unpaid', 0],
    ]);
    const card = (await session.agent.get('/api/v1/dashboard/summary')).body.billing;
    expect(card.overdue).toEqual({ count: 1, amountMinor: 60_000 });
    await expectCsvMatchesJson('outstanding-balances', period);
  });
});

describe('classes, trainers and equipment', () => {
  it('totals class attendance and trainer performance, leaving cancelled sessions out', async () => {
    const coach = await createUser({ role: 'TRAINER', firstName: 'Kamran', lastName: 'Butt' });
    await createUser({ role: 'TRAINER', firstName: 'Idle', lastName: 'Former', isActive: false });
    const [yoga] = await db
      .insert(fitnessClasses)
      .values({ name: 'Morning Yoga', defaultDurationMinutes: 60, defaultCapacity: 12 })
      .returning();
    const session_ = (startsAt: Date, status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED') =>
      db
        .insert(classSessions)
        .values({
          classId: yoga!.id,
          trainerId: coach.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          capacity: 12,
          room: 'Studio A',
          status,
          cancelReason: status === 'CANCELLED' ? 'Trainer unwell' : null,
        })
        .returning()
        .then((rows) => rows[0]!);
    const held = await session_(FIRST_INSTANT, 'COMPLETED');
    const second = await session_(at('2026-03-20', '07:00'), 'COMPLETED');
    const cancelled = await session_(at('2026-03-21', '07:00'), 'CANCELLED');
    const outside = await session_(JUST_AFTER, 'COMPLETED');
    const people = await Promise.all([1, 2, 3, 4].map(() => createMember()));
    const book = (sessionId: string, memberId: string, status: 'ATTENDED' | 'NO_SHOW' | 'BOOKED') =>
      db.insert(classBookings).values({ sessionId, memberId, status });
    await book(held.id, people[0]!.id, 'ATTENDED');
    await book(held.id, people[1]!.id, 'ATTENDED');
    await book(held.id, people[2]!.id, 'NO_SHOW');
    await book(second.id, people[0]!.id, 'ATTENDED');
    await book(second.id, people[3]!.id, 'BOOKED');
    await book(cancelled.id, people[1]!.id, 'BOOKED');
    await book(outside.id, people[1]!.id, 'ATTENDED');
    await db.insert(appointments).values([
      {
        trainerId: coach.id,
        memberId: people[0]!.id,
        startsAt: at('2026-03-05', '17:00'),
        endsAt: at('2026-03-05', '18:00'),
        status: 'COMPLETED',
      },
      {
        trainerId: coach.id,
        memberId: people[1]!.id,
        startsAt: at('2026-03-06', '17:00'),
        endsAt: at('2026-03-06', '18:00'),
        status: 'NO_SHOW',
      },
    ]);

    const classes = await json('class-attendance');
    expect(metric(classes, 'sessions')).toBe(2);
    expect(metric(classes, 'booked')).toBe(5);
    expect(metric(classes, 'attended')).toBe(3);
    expect(metric(classes, 'noShows')).toBe(1);
    expect(metric(classes, 'attendanceRate')).toBe(75);
    expect(classes.rows.map((row) => [row.status, row.booked, row.attended])).toEqual([
      ['Cancelled', 1, 0],
      ['Completed', 2, 1],
      ['Completed', 3, 2],
    ]);
    expect(classes.rows[0]).toMatchObject({ className: 'Morning Yoga', trainer: 'Kamran Butt' });
    await expectCsvMatchesJson('class-attendance');

    const trainers = await json('trainer-performance');
    // The inactive trainer had no work in March, so is not listed.
    expect(trainers.rows).toEqual([
      {
        trainer: 'Kamran Butt',
        status: 'Active',
        sessions: 2,
        attended: 3,
        noShows: 1,
        attendanceRate: 75,
        appointmentsCompleted: 1,
        appointmentsNoShow: 1,
        assignedMembers: 0,
      },
    ]);
    expect(metric(trainers, 'trainers')).toBe(1);
    const raw = await db.execute<{ n: number }>(sql`select count(*)::int as n
      from class_bookings cb join class_sessions cs on cs.id = cb.session_id
      where cb.status = 'ATTENDED' and cs.status <> 'CANCELLED'
        and cs.starts_at >= ${FIRST_INSTANT.toISOString()}::timestamptz
        and cs.starts_at < ${JUST_AFTER.toISOString()}::timestamptz`);
    expect(raw.rows[0]!.n).toBe(3);
    await expectCsvMatchesJson('trainer-performance');
  });

  it('totals maintenance in the period and what is due for service today', async () => {
    const today = gymToday();
    const [bike, rack] = await db
      .insert(equipment)
      .values([
        { name: 'Spin bike 3', category: 'CARDIO', nextMaintenanceDate: addDays(today, -2) },
        {
          name: 'Squat rack',
          category: 'STRENGTH_MACHINE',
          nextMaintenanceDate: addDays(today, 7),
        },
        {
          name: 'Old treadmill',
          category: 'CARDIO',
          status: 'RETIRED',
          outOfServiceReason: 'Motor failed',
          nextMaintenanceDate: addDays(today, -40),
        },
      ])
      .returning();
    await db.insert(equipment).values({
      name: 'Rowing machine',
      category: 'CARDIO',
      nextMaintenanceDate: addDays(today, 8),
    });
    const record = (
      equipmentId: string,
      type: 'REPAIR' | 'PREVENTIVE',
      performedOn: string,
      costMinor: number | null,
    ) =>
      db.insert(maintenanceRecords).values({
        equipmentId,
        type,
        performedOn,
        costMinor,
        description: 'Checked and serviced',
        conditionAfter: 'GOOD',
        performedByName: 'FitFix Services',
      });
    await record(bike!.id, 'REPAIR', '2026-02-28', 9_000);
    await record(bike!.id, 'REPAIR', FROM, 12_500);
    await record(rack!.id, 'PREVENTIVE', TO, null);
    await record(rack!.id, 'PREVENTIVE', '2026-04-01', 3_000);

    const dto = await json('equipment-maintenance');
    expect(metric(dto, 'records')).toBe(2);
    expect(metric(dto, 'repairs')).toBe(1);
    expect(metric(dto, 'cost')).toBe(12_500);
    // Due: the bike (overdue) and the rack (in 7 days); not the retired one or the rower (8 days).
    expect(metric(dto, 'dueNow')).toBe(2);
    expect(metric(dto, 'overdueNow')).toBe(1);
    expect(dto.rows.map((row) => [row.performedOn, row.equipment, row.cost])).toEqual([
      [TO, 'Squat rack', null],
      [FROM, 'Spin bike 3', 12_500],
    ]);
    await expectCsvMatchesJson('equipment-maintenance');
  });
});

describe('report access (PLAN §5)', () => {
  const RECEPTION: string[] = ['attendance', 'denied-access'];

  it('gives Admin and Manager every report, Receptionist attendance and denials only', async () => {
    for (const role of ['ADMIN', 'MANAGER'] as const) {
      const staff = role === 'ADMIN' ? session : await signIn(app, await createUser({ role }));
      for (const type of REPORT_TYPES) {
        expect((await report(staff, type)).status, `${role} ${type}`).toBe(200);
      }
    }
    const desk = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
    for (const type of REPORT_TYPES) {
      const res = await report(desk, type);
      expect(res.status, `RECEPTIONIST ${type}`).toBe(RECEPTION.includes(type) ? 200 : 403);
      if (res.status === 403) expect(res.body.error.code).toBe('FORBIDDEN');
    }
    // A CSV is no way around it.
    expect((await report(desk, 'revenue', `${PERIOD}&format=csv`)).status).toBe(403);
  });

  it('refuses every report to Trainers, members and anonymous callers', async () => {
    const cases: [Role | null, number][] = [
      ['TRAINER', 403],
      ['MEMBER', 403],
      [null, 401],
    ];
    for (const [role, status] of cases) {
      const caller = role ? await signIn(app, await createUser({ role })) : null;
      for (const type of REPORT_TYPES) {
        const res = caller
          ? await report(caller, type)
          : await anonymous().get(`/api/v1/reports/${type}?${PERIOD}`);
        expect(res.status, `${role} ${type}`).toBe(status);
      }
    }
  });

  it('refuses financial reports to a Receptionist before reading the query', async () => {
    const desk = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
    expect((await report(desk, 'payments', 'from=nonsense')).status).toBe(403);
  });
});

describe('report periods and validation', () => {
  it('defaults to the last 30 days ending today in gym time', async () => {
    const dto = await json('attendance', '');
    expect(dto.to).toBe(gymToday());
    expect(dto.from).toBe(addDays(gymToday(), -29));
    expect(dto.series!.points).toHaveLength(30);
  });

  it('rejects bad periods, unknown types and unknown parameters with 400', async () => {
    const cases: [string, string, string][] = [
      ['attendance', 'from=2026-03-31&to=2026-03-01', 'to'],
      ['attendance', 'from=2025-01-01&to=2026-03-01', 'to'],
      ['attendance', 'from=2026-02-30', 'from'],
      ['attendance', 'interval=week', 'interval'],
      ['attendance', 'format=xlsx', 'format'],
      ['attendance', 'memberId=1', ''],
    ];
    for (const [type, query, path] of cases) {
      const res = await report(session, type, query);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code, query).toBe('VALIDATION_FAILED');
      if (path) {
        expect(
          res.body.error.details.some((d: { path: string }) => d.path === path),
          `${query}: ${JSON.stringify(res.body.error.details)}`,
        ).toBe(true);
      }
    }
    expect((await report(session, 'everything')).status).toBe(400);
    expect((await report(session, 'attendance', 'from=2025-03-31&to=2026-03-31')).status).toBe(200);
  });

  it('never lets a member name run as a spreadsheet formula', async () => {
    const m = await member('=HYPERLINK("http://evil.test")', '+Payload');
    await checkIn(m, at('2026-03-05', '10:00'));
    const res = await report(session, 'attendance', `${PERIOD}&format=csv`).buffer(true);
    const [, row] = parseCsv(res.text);
    expect(row![2]).toBe(`'=HYPERLINK("http://evil.test") +Payload`);
    for (const cell of row!) expect(cell).not.toMatch(/^[=+\-@]/);
  });

  it('rate-limits reports per user', async () => {
    const limited = testApp({ loginMax: 1_000, reportsPerMinute: 2 });
    const caller = await signIn(limited, admin);
    expect((await report(caller, 'attendance')).status).toBe(200);
    expect((await report(caller, 'registrations')).status).toBe(200);
    const res = await report(caller, 'attendance');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // Another user has their own allowance.
    const other = await signIn(limited, await createUser({ role: 'MANAGER' }));
    expect((await report(other, 'attendance')).status).toBe(200);
  });
});

describe('dashboard charts and period totals', () => {
  it('serve the same series as the reports, revenue only with reports:financial', async () => {
    const sana = await member('Sana', 'Iqbal');
    await checkIn(sana, FIRST_INSTANT);
    await db.insert(accessAttempts).values({
      occurredAt: LAST_INSTANT,
      source: 'SIMULATED',
      result: 'DENIED',
      reason: 'MEMBER_NOT_RECOGNIZED',
    });
    await payment(sana.member.id, 40_000, at('2026-03-10', '11:00'));

    const attendanceChart = await session.agent.get(
      `/api/v1/dashboard/charts/attendance?${PERIOD}`,
    );
    expect(attendanceChart.status).toBe(200);
    expect(attendanceChart.headers['cache-control']).toBe('no-store');
    expect(attendanceChart.body).toMatchObject({ from: FROM, to: TO, interval: 'day' });
    const attendanceReport = await json('attendance');
    expect(attendanceChart.body.series.points.map((p: { values: object }) => p.values)).toEqual(
      attendanceReport.series!.points.map((p) => ({
        checkIns: p.values.checkIns,
        denied: p.bucket === TO ? 1 : 0,
      })),
    );

    const revenueChart = await session.agent.get(`/api/v1/dashboard/charts/revenue?${PERIOD}`);
    expect(revenueChart.status).toBe(200);
    expect(revenueChart.body.series).toEqual((await json('revenue')).series);

    const summary = (await session.agent.get(`/api/v1/dashboard/summary?${PERIOD}`)).body;
    expect(summary.period).toEqual({
      from: FROM,
      to: TO,
      registrations: 0,
      checkIns: 1,
      denied: 1,
      revenue: { collectedMinor: 40_000, refundedMinor: 0, netMinor: 40_000, paymentCount: 1 },
    });

    const desk = await signIn(app, await createUser({ role: 'RECEPTIONIST' }));
    expect((await desk.agent.get(`/api/v1/dashboard/charts/attendance?${PERIOD}`)).status).toBe(
      200,
    );
    expect((await desk.agent.get(`/api/v1/dashboard/charts/revenue?${PERIOD}`)).status).toBe(403);
    const deskSummary = (await desk.agent.get(`/api/v1/dashboard/summary?${PERIOD}`)).body;
    expect(deskSummary.period).toMatchObject({ checkIns: 1, denied: 1, revenue: null });

    const coach = await signIn(app, await createUser({ role: 'TRAINER' }));
    expect((await coach.agent.get('/api/v1/dashboard/charts/attendance')).status).toBe(403);
    expect((await coach.agent.get('/api/v1/dashboard/charts/revenue')).status).toBe(403);
    expect((await coach.agent.get('/api/v1/dashboard/summary')).body.period).toBeNull();
  });

  it('validates the dashboard period like a report period', async () => {
    const res = await session.agent.get('/api/v1/dashboard/summary?from=2026-03-31&to=2026-03-01');
    expect(res.status).toBe(400);
    expect((await session.agent.get('/api/v1/dashboard/charts/revenue?format=csv')).status).toBe(
      400,
    );
  });
});
