import {
  COUNTER_PAYMENT_METHODS,
  INVOICE_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type InvoiceStatus,
  type PaymentMethod,
  type ReportRange,
  type ReportType,
} from '@gms/shared';
import { sql } from 'drizzle-orm';
import {
  effectiveInvoiceStatusSql,
  invoicePaidSql,
  invoiceRefundedSql,
  OPEN_INVOICE_STATUSES,
} from '../billing/billing.service';
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

const completedIn = (range: ReportRange) =>
  sql`p.status = 'COMPLETED' and ${instantInPeriod(sql`p.received_at`, range)}`;

const refundedOfPayment = sql`coalesce((select sum(r.amount_minor) from refunds r where r.payment_id = p.id), 0)`;

function methodBreakdown(rows: Row[]) {
  const byMethod = new Map(rows.map((row) => [row.method as PaymentMethod, num(row.total)]));
  return {
    title: 'Collected by method',
    kind: 'money' as const,
    items: COUNTER_PAYMENT_METHODS.map((method) => ({
      key: method,
      label: PAYMENT_METHOD_LABELS[method],
      value: byMethod.get(method) ?? 0,
    })),
  };
}

/** Completed payments received in the period, with how much of each has been refunded since. */
const payments: ReportBuilder = async (range) => {
  const inPeriod = completedIn(range);
  const [[totals], byMethod, grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select count(*) as total, coalesce(sum(p.amount_minor), 0) as collected,
        coalesce(sum(${refundedOfPayment}), 0) as refunded
      from payments p where ${inPeriod}`),
    selectRows<Row>(sql`select p.method, sum(p.amount_minor) as total
      from payments p where ${inPeriod} group by p.method`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`p.received_at`, range.interval)} as bucket,
        sum(p.amount_minor) as collected
      from payments p where ${inPeriod} group by 1`),
    selectRows<Row>(sql`select p.received_at, p.receipt_number, p.method, p.amount_minor,
        ${refundedOfPayment} as refunded, i.invoice_number,
        m.member_code, m.first_name, m.last_name, ${TOTAL_ROWS} as total_rows
      from payments p
      join members m on m.id = p.member_id
      join invoices i on i.id = p.invoice_id
      where ${inPeriod}
      order by p.received_at desc, p.id desc ${ROW_LIMIT}`),
  ]);
  return {
    summary: [
      { key: 'payments', label: 'Payments', value: num(totals?.total), kind: 'number' },
      { key: 'collected', label: 'Collected', value: num(totals?.collected), kind: 'money' },
      {
        key: 'refunded',
        label: 'Refunded since',
        value: num(totals?.refunded),
        kind: 'money',
        hint: 'of these payments',
      },
    ],
    series: buildSeries(range, 'money', [{ key: 'collected', label: 'Collected' }], grouped),
    breakdown: methodBreakdown(byMethod),
    columns: [
      { key: 'receivedAt', label: 'Received', kind: 'datetime' },
      { key: 'receiptNumber', label: 'Receipt', kind: 'text' },
      { key: 'memberCode', label: 'Member code', kind: 'text' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
      { key: 'method', label: 'Method', kind: 'text' },
      { key: 'amount', label: 'Amount', kind: 'money' },
      { key: 'refunded', label: 'Refunded', kind: 'money' },
    ],
    rows: rows.map((row) => ({
      receivedAt: isoOrNull(row.received_at),
      receiptNumber: String(row.receipt_number),
      memberCode: String(row.member_code),
      member: personName(row.first_name, row.last_name),
      invoiceNumber: String(row.invoice_number),
      method: PAYMENT_METHOD_LABELS[row.method as PaymentMethod],
      amount: num(row.amount_minor),
      refunded: num(row.refunded),
    })),
    totalRows: totalOf(rows),
  };
};

/**
 * Invoices due in the period that still owe money today. "Overdue" is the OVERDUE status only,
 * as on the dashboard: a part-paid invoice past its due date stays Partially paid (PLAN §3.4).
 */
const outstandingBalances: ReportBuilder = async (range, today) => {
  const open = sql`select invoices.id, invoices.invoice_number, invoices.description,
      invoices.due_date, invoices.amount_due_minor, invoices.member_id,
      ${invoicePaidSql} - ${invoiceRefundedSql} as net_paid,
      ${effectiveInvoiceStatusSql(today)} as status
    from invoices
    where invoices.status in (${sql.join(
      OPEN_INVOICE_STATUSES.map((status) => sql`${status}`),
      sql`, `,
    )}) and ${dateInPeriod(sql`invoices.due_date`, range)}`;
  const owed = sql`select o.*, greatest(0, o.amount_due_minor - o.net_paid) as balance
    from (${open}) o`;
  const owing = sql`(${owed}) b`;
  const [[totals], byStatus, grouped, rows] = await Promise.all([
    selectRows<Row>(sql`select count(*) as total, coalesce(sum(b.balance), 0) as balance,
        count(*) filter (where b.status = 'OVERDUE') as overdue,
        coalesce(sum(b.balance) filter (where b.status = 'OVERDUE'), 0) as overdue_balance
      from ${owing} where b.balance > 0`),
    selectRows<Row>(
      sql`select b.status, sum(b.balance) as total from ${owing} where b.balance > 0 group by b.status`,
    ),
    selectRows<BucketRow>(sql`select ${dateBucket(sql`b.due_date`, range.interval)} as bucket,
        sum(b.balance) as balance
      from ${owing} where b.balance > 0 group by 1`),
    selectRows<Row>(sql`select b.invoice_number, b.description, b.due_date::text as due_date,
        b.amount_due_minor, b.net_paid, b.balance, b.status,
        greatest(0, ${today}::date - b.due_date) as days_past_due,
        m.member_code, m.first_name, m.last_name, ${TOTAL_ROWS} as total_rows
      from ${owing}
      join members m on m.id = b.member_id
      where b.balance > 0
      order by b.due_date asc, b.invoice_number asc ${ROW_LIMIT}`),
  ]);
  const statuses = new Map(byStatus.map((row) => [row.status as InvoiceStatus, num(row.total)]));
  return {
    summary: [
      { key: 'invoices', label: 'Unpaid invoices', value: num(totals?.total), kind: 'number' },
      {
        key: 'outstanding',
        label: 'Outstanding',
        value: num(totals?.balance),
        kind: 'money',
        hint: 'owed today',
      },
      { key: 'overdue', label: 'Overdue invoices', value: num(totals?.overdue), kind: 'number' },
      {
        key: 'overdueAmount',
        label: 'Overdue amount',
        value: num(totals?.overdue_balance),
        kind: 'money',
      },
    ],
    series: buildSeries(range, 'money', [{ key: 'balance', label: 'Still owed' }], grouped),
    breakdown: {
      title: 'Still owed by status',
      kind: 'money',
      items: OPEN_INVOICE_STATUSES.map((status) => ({
        key: status,
        label: INVOICE_STATUS_LABELS[status],
        value: statuses.get(status) ?? 0,
      })),
    },
    columns: [
      { key: 'dueDate', label: 'Due', kind: 'date' },
      { key: 'invoiceNumber', label: 'Invoice', kind: 'text' },
      { key: 'memberCode', label: 'Member code', kind: 'text' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'description', label: 'Description', kind: 'text' },
      { key: 'status', label: 'Status', kind: 'text' },
      { key: 'amountDue', label: 'Amount due', kind: 'money' },
      { key: 'paid', label: 'Paid', kind: 'money' },
      { key: 'balance', label: 'Balance', kind: 'money' },
      { key: 'daysPastDue', label: 'Days past due', kind: 'number' },
    ],
    rows: rows.map((row) => ({
      dueDate: String(row.due_date),
      invoiceNumber: String(row.invoice_number),
      memberCode: String(row.member_code),
      member: personName(row.first_name, row.last_name),
      description: String(row.description),
      status: INVOICE_STATUS_LABELS[row.status as InvoiceStatus],
      amountDue: num(row.amount_due_minor),
      paid: num(row.net_paid),
      balance: num(row.balance),
      daysPastDue: num(row.days_past_due),
    })),
    totalRows: totalOf(rows),
  };
};

/**
 * Collected = completed payments by the time received; refunds count when they were paid out.
 * Shared with the dashboard revenue chart.
 */
export async function revenueByBucket(range: ReportRange) {
  const [paid, refunded] = await Promise.all([
    selectRows<BucketRow>(sql`select ${instantBucket(sql`p.received_at`, range.interval)} as bucket,
        count(*) as payments, sum(p.amount_minor) as collected
      from payments p where ${completedIn(range)} group by 1`),
    selectRows<BucketRow>(sql`select ${instantBucket(sql`r.refunded_at`, range.interval)} as bucket,
        count(*) as refunds, sum(r.amount_minor) as refunded
      from refunds r where ${instantInPeriod(sql`r.refunded_at`, range)} group by 1`),
  ]);
  const refundsByBucket = new Map(refunded.map((row) => [row.bucket, row]));
  const merged: BucketRow[] = paid.map((row) => ({ ...row }));
  const known = new Set(paid.map((row) => row.bucket));
  for (const row of refunded) if (!known.has(row.bucket)) merged.push({ bucket: row.bucket });
  for (const row of merged) {
    const refund = refundsByBucket.get(row.bucket);
    row.refunds = num(refund?.refunds);
    row.refunded = num(refund?.refunded);
    row.net = num(row.collected) - num(row.refunded);
  }
  const series = buildSeries(
    range,
    'money',
    [
      { key: 'collected', label: 'Collected' },
      { key: 'refunded', label: 'Refunded' },
      { key: 'net', label: 'Net' },
    ],
    merged,
  );
  return { series, merged };
}

const revenue: ReportBuilder = async (range) => {
  const [{ series, merged }, byMethod] = await Promise.all([
    revenueByBucket(range),
    selectRows<Row>(sql`select p.method, sum(p.amount_minor) as total
      from payments p where ${completedIn(range)} group by p.method`),
  ]);
  const counts = new Map(merged.map((row) => [row.bucket, row]));
  const rows = series.points.map(({ bucket, values }) => ({
    period: bucket,
    payments: num(counts.get(bucket)?.payments),
    collected: values.collected ?? 0,
    refunds: num(counts.get(bucket)?.refunds),
    refunded: values.refunded ?? 0,
    net: values.net ?? 0,
  }));
  const sum = (key: 'payments' | 'collected' | 'refunded' | 'net') =>
    rows.reduce((total, row) => total + row[key], 0);
  return {
    summary: [
      { key: 'collected', label: 'Collected', value: sum('collected'), kind: 'money' },
      { key: 'refunded', label: 'Refunded', value: sum('refunded'), kind: 'money' },
      { key: 'net', label: 'Net revenue', value: sum('net'), kind: 'money' },
      { key: 'payments', label: 'Payments', value: sum('payments'), kind: 'number' },
    ],
    series,
    breakdown: methodBreakdown(byMethod),
    columns: [
      { key: 'period', label: range.interval === 'day' ? 'Day' : 'Month', kind: 'text' },
      { key: 'payments', label: 'Payments', kind: 'number' },
      { key: 'collected', label: 'Collected', kind: 'money' },
      { key: 'refunds', label: 'Refunds', kind: 'number' },
      { key: 'refunded', label: 'Refunded', kind: 'money' },
      { key: 'net', label: 'Net', kind: 'money' },
    ],
    rows,
    totalRows: rows.length,
  };
};

/**
 * Per trainer: sessions taught (not cancelled), their class attendance, appointments and the
 * members assigned today. Inactive trainers appear only when they had work in the period.
 */
const trainerPerformance: ReportBuilder = async (range) => {
  const sessionsIn = sql`cs.trainer_id = u.id and cs.status <> 'CANCELLED'
    and ${instantInPeriod(sql`cs.starts_at`, range)}`;
  const bookingsWith = (status: string) => sql`(select count(*) from class_bookings cb
    join class_sessions cs on cs.id = cb.session_id where ${sessionsIn} and cb.status = ${status})`;
  const appointmentsWith = (status: string) => sql`(select count(*) from appointments a
    where a.trainer_id = u.id and a.status = ${status}
      and ${instantInPeriod(sql`a.starts_at`, range)})`;
  const rows = await selectRows<Row>(sql`select t.* from (
      select u.id, u.first_name, u.last_name, u.is_active,
        (select count(*) from class_sessions cs where ${sessionsIn}) as sessions,
        ${bookingsWith('ATTENDED')} as attended,
        ${bookingsWith('NO_SHOW')} as no_shows,
        ${appointmentsWith('COMPLETED')} as appointments_completed,
        ${appointmentsWith('NO_SHOW')} as appointments_no_show,
        (select count(*) from trainer_assignments ta join members m on m.id = ta.member_id
          where ta.trainer_id = u.id and ta.end_date is null and m.archived_at is null) as assigned
      from users u where u.role = 'TRAINER'
    ) t
    where t.is_active or t.sessions > 0 or t.appointments_completed > 0 or t.appointments_no_show > 0
    order by t.first_name, t.last_name, t.id`);
  const trainers = rows.map((row) => {
    const attended = num(row.attended);
    const noShows = num(row.no_shows);
    return {
      trainer: personName(row.first_name, row.last_name),
      status: row.is_active ? 'Active' : 'Inactive',
      sessions: num(row.sessions),
      attended,
      noShows,
      attendanceRate: percent(attended, attended + noShows),
      appointmentsCompleted: num(row.appointments_completed),
      appointmentsNoShow: num(row.appointments_no_show),
      assignedMembers: num(row.assigned),
    };
  });
  const sum = (key: 'sessions' | 'attended' | 'noShows' | 'appointmentsCompleted') =>
    trainers.reduce((total, row) => total + row[key], 0);
  return {
    summary: [
      { key: 'trainers', label: 'Trainers', value: trainers.length, kind: 'number' },
      { key: 'sessions', label: 'Sessions taught', value: sum('sessions'), kind: 'number' },
      { key: 'attended', label: 'Class attendances', value: sum('attended'), kind: 'number' },
      {
        key: 'attendanceRate',
        label: 'Attendance rate',
        value: percent(sum('attended'), sum('attended') + sum('noShows')),
        kind: 'percent',
        hint: 'of marked bookings',
      },
      {
        key: 'appointmentsCompleted',
        label: 'Appointments completed',
        value: sum('appointmentsCompleted'),
        kind: 'number',
      },
    ],
    series: null,
    breakdown: {
      title: 'Sessions taught by trainer',
      kind: 'number',
      items: rows.map((row, index) => ({
        key: String(row.id),
        label: trainers[index]!.trainer ?? '',
        value: trainers[index]!.sessions,
      })),
    },
    columns: [
      { key: 'trainer', label: 'Trainer', kind: 'text' },
      { key: 'status', label: 'Account', kind: 'text' },
      { key: 'sessions', label: 'Sessions', kind: 'number' },
      { key: 'attended', label: 'Attended', kind: 'number' },
      { key: 'noShows', label: 'No-shows', kind: 'number' },
      { key: 'attendanceRate', label: 'Attendance rate', kind: 'percent' },
      { key: 'appointmentsCompleted', label: 'Appointments done', kind: 'number' },
      { key: 'appointmentsNoShow', label: 'Appointment no-shows', kind: 'number' },
      { key: 'assignedMembers', label: 'Assigned members', kind: 'number' },
    ],
    rows: trainers,
    totalRows: trainers.length,
  };
};

export const FINANCIAL_REPORTS: Partial<Record<ReportType, ReportBuilder>> = {
  payments,
  'outstanding-balances': outstandingBalances,
  revenue,
  'trainer-performance': trainerPerformance,
};
