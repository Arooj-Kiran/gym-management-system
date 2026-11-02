import { z } from 'zod';
import { addDays, daysBetween } from '../memberships';
import { permissionScope, SCOPES, type Permission } from '../permissions';
import type { Role } from '../roles';
import { isoDateSchema } from './common';

// --- Report types and who may run them (PLAN §4.9, §5) -----------------------------------------

export const OPERATIONAL_REPORT_TYPES = [
  'registrations',
  'membership-status',
  'renewals',
  'attendance',
  'denied-access',
  'class-attendance',
  'equipment-maintenance',
] as const;

export const FINANCIAL_REPORT_TYPES = [
  'payments',
  'outstanding-balances',
  'revenue',
  'trainer-performance',
] as const;

export const REPORT_TYPES = [...OPERATIONAL_REPORT_TYPES, ...FINANCIAL_REPORT_TYPES] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** The Receptionist's LIMITED reports:operational scope. */
export const RECEPTION_REPORT_TYPES: readonly ReportType[] = ['attendance', 'denied-access'];

export const REPORT_LABELS: Record<ReportType, string> = {
  registrations: 'Member registrations',
  'membership-status': 'Membership status',
  renewals: 'Membership renewals',
  attendance: 'Attendance',
  'denied-access': 'Denied entry attempts',
  'class-attendance': 'Class attendance',
  'equipment-maintenance': 'Equipment maintenance',
  payments: 'Payments',
  'outstanding-balances': 'Outstanding balances',
  revenue: 'Revenue',
  'trainer-performance': 'Trainer performance',
};

export const REPORT_DESCRIPTIONS: Record<ReportType, string> = {
  registrations: 'Members by registration date, with their current membership status.',
  'membership-status': 'Members by current status today, and the status changes in the period.',
  renewals: 'Memberships renewed in the period.',
  attendance: 'Valid check-ins in the period. Voided check-ins are left out.',
  'denied-access': 'Every refused entry attempt in the period, by reason.',
  'class-attendance': 'Class sessions in the period with bookings, attendance and no-shows.',
  'equipment-maintenance': 'Maintenance work in the period, and equipment due for service now.',
  payments: 'Completed payments received in the period.',
  'outstanding-balances': 'Unpaid invoices due in the period, with what is still owed today.',
  revenue: 'Money collected less refunds paid out, per day or month.',
  'trainer-performance': 'Sessions taught, class attendance and appointments for each trainer.',
};

const FINANCIAL = new Set<ReportType>(FINANCIAL_REPORT_TYPES);

export function reportPermission(type: ReportType): Permission {
  return FINANCIAL.has(type) ? 'reports:financial' : 'reports:operational';
}

/** Mirrors the server check, so the web only offers reports the role can open. */
export function canViewReport(role: Role, type: ReportType): boolean {
  const scope = permissionScope(role, reportPermission(type));
  if (scope === SCOPES.ALL) return true;
  return scope === SCOPES.LIMITED && RECEPTION_REPORT_TYPES.includes(type);
}

export function reportTypesForRole(role: Role): ReportType[] {
  return REPORT_TYPES.filter((type) => canViewReport(role, type));
}

// --- Query ----------------------------------------------------------------------------------

export const REPORT_LIMITS = {
  /** Default period: the last 30 days, today included. */
  defaultRangeDays: 30,
  maxRangeDays: 366,
  /** Longer periods are grouped by month when no interval is asked for. */
  dailyIntervalMaxDays: 92,
  /** Rows returned (JSON and CSV); the summary and chart always cover the whole period. */
  maxRows: 5000,
} as const;

export const REPORT_INTERVALS = ['day', 'month'] as const;
export type ReportInterval = (typeof REPORT_INTERVALS)[number];

export const REPORT_FORMATS = ['json', 'csv'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

const rangeQueryShape = {
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  interval: z.enum(REPORT_INTERVALS, { error: 'Choose day or month' }).optional(),
};

export const reportTypeParamSchema = z.strictObject({
  type: z.enum(REPORT_TYPES, { error: 'Unknown report' }),
});

export const reportQuerySchema = z.strictObject({
  ...rangeQueryShape,
  format: z.enum(REPORT_FORMATS, { error: 'Choose json or csv' }).default('json'),
});
export type ReportQuery = z.input<typeof reportQuerySchema>;

/** Dashboard summary and charts take the same period as the reports. */
export const dashboardRangeQuerySchema = z.strictObject(rangeQueryShape);
export type DashboardRangeQuery = z.input<typeof dashboardRangeQuerySchema>;

export interface ReportRange {
  /** Inclusive calendar dates in gym time. */
  from: string;
  to: string;
  interval: ReportInterval;
}

export type ReportRangeResult =
  { ok: true; range: ReportRange } | { ok: false; path: 'from' | 'to'; message: string };

/**
 * Fills in the defaults (to = today, from = 30 days before `to`) and checks the period.
 * Without an interval, up to 92 days are shown per day and longer periods per month.
 */
export function resolveReportRange(
  query: { from?: string; to?: string; interval?: ReportInterval },
  today: string,
): ReportRangeResult {
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -(REPORT_LIMITS.defaultRangeDays - 1));
  const days = daysBetween(from, to) + 1;
  if (days < 1) return { ok: false, path: 'to', message: '"To" must be on or after "From"' };
  if (days > REPORT_LIMITS.maxRangeDays) {
    return {
      ok: false,
      path: 'to',
      message: `Choose a period of at most ${REPORT_LIMITS.maxRangeDays} days`,
    };
  }
  const interval = query.interval ?? (days <= REPORT_LIMITS.dailyIntervalMaxDays ? 'day' : 'month');
  return { ok: true, range: { from, to, interval } };
}

/** Every bucket label in the period, oldest first: YYYY-MM-DD per day or YYYY-MM per month. */
export function reportBuckets(range: ReportRange): string[] {
  if (range.interval === 'day') {
    const days = daysBetween(range.from, range.to) + 1;
    return Array.from({ length: days }, (_, index) => addDays(range.from, index));
  }
  const buckets: string[] = [];
  let year = Number(range.from.slice(0, 4));
  let month = Number(range.from.slice(5, 7));
  const last = range.to.slice(0, 7);
  for (;;) {
    const bucket = `${year}-${String(month).padStart(2, '0')}`;
    buckets.push(bucket);
    if (bucket >= last) return buckets;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

// --- Response -------------------------------------------------------------------------------

/** money: integer minor units; date: YYYY-MM-DD; datetime: ISO 8601 UTC; percent: 0–100. */
export type ReportValueKind = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime';
export type ReportMetricKind = 'number' | 'money' | 'percent';
export type ReportCell = string | number | null;

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportValueKind;
}

export interface ReportMetric {
  key: string;
  label: string;
  value: number;
  kind: ReportMetricKind;
  /** Short context shown under the number, e.g. "today" for a snapshot. */
  hint?: string;
}

export interface ReportSeriesKey {
  key: string;
  label: string;
}

export interface ReportSeries {
  /** All keys share one kind, so one axis fits them. */
  kind: 'number' | 'money';
  keys: ReportSeriesKey[];
  /** One point per bucket in the period, zeros included. */
  points: { bucket: string; values: Record<string, number> }[];
}

export interface ReportBreakdown {
  title: string;
  kind: 'number' | 'money';
  items: { key: string; label: string; value: number }[];
}

export interface ReportDto {
  type: ReportType;
  title: string;
  from: string;
  to: string;
  interval: ReportInterval;
  generatedAt: string;
  summary: ReportMetric[];
  series: ReportSeries | null;
  breakdown: ReportBreakdown | null;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Rows in the period before the row limit. */
  totalRows: number;
  truncated: boolean;
}

/** GET /dashboard/charts/revenue and /dashboard/charts/attendance. */
export interface DashboardChartDto {
  from: string;
  to: string;
  interval: ReportInterval;
  series: ReportSeries;
}
