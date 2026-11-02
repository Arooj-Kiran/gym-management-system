import type { ReportCell, ReportInterval, ReportValueKind } from '@gms/shared';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';

const NUMBER = new Intl.NumberFormat('en');

/** One report value as shown on screen (the CSV keeps the raw values). */
export function formatReportValue(
  kind: ReportValueKind,
  value: ReportCell | undefined,
  currencyCode: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (kind) {
    case 'money':
      return formatMoney(Number(value), currencyCode);
    case 'number':
      return NUMBER.format(Number(value));
    case 'percent':
      return `${NUMBER.format(Number(value))}%`;
    case 'date':
      return formatDate(String(value));
    case 'datetime':
      return formatDateTime(String(value));
    case 'text':
      return String(value);
  }
}

/** Numbers and money line up on the right, as in a ledger. */
export const isNumericKind = (kind: ReportValueKind) =>
  kind === 'money' || kind === 'number' || kind === 'percent';

/** Axis and tooltip label of a bucket: "12 Mar" per day, "Mar 2026" per month. */
export function formatBucket(bucket: string, interval: ReportInterval, long = false) {
  if (interval === 'month') {
    return new Intl.DateTimeFormat('en-GB', {
      month: long ? 'long' : 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${bucket}-01T00:00:00Z`));
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: long ? 'numeric' : undefined,
    weekday: long ? 'short' : undefined,
    timeZone: 'UTC',
  }).format(new Date(`${bucket}T00:00:00Z`));
}

/** Compact axis numbers: 1,200 → 1.2K; money in major units. */
export function formatAxisValue(value: number, kind: 'number' | 'money') {
  const major = kind === 'money' ? value / 100 : value;
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(
    major,
  );
}

/**
 * Series colours from the theme tokens, chosen by meaning so the same figure looks the same on
 * every chart: arrivals and money in blue, refusals and refunds in red, net results in green.
 */
const SERIES_COLORS: Record<string, string> = {
  checkIns: 'var(--primary)',
  registrations: 'var(--primary)',
  renewals: 'var(--primary)',
  attended: 'var(--primary)',
  records: 'var(--primary)',
  collected: 'var(--primary)',
  activated: 'var(--success)',
  net: 'var(--success)',
  denied: 'var(--danger)',
  refunded: 'var(--danger)',
  cancelled: 'var(--danger)',
  noShows: 'var(--warning-text)',
  suspended: 'var(--warning-text)',
  balance: 'var(--warning-text)',
  expired: 'var(--text-muted)',
};
const FALLBACK_COLORS = [
  'var(--primary)',
  'var(--success)',
  'var(--warning-text)',
  'var(--danger)',
  'var(--text-muted)',
];

export const seriesColor = (key: string, index: number) =>
  SERIES_COLORS[key] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
