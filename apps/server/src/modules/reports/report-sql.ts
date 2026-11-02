import {
  REPORT_LIMITS,
  reportBuckets,
  type ReportDto,
  type ReportInterval,
  type ReportRange,
  type ReportSeries,
  type ReportSeriesKey,
} from '@gms/shared';
import { sql, type SQL } from 'drizzle-orm';
import { config } from '../../config/env';
import { db } from '../../db/client';
import { gymDayStart } from '../../lib/dates';

/**
 * SQL building blocks for the reports and dashboard charts. Periods are inclusive calendar dates
 * in gym time: an instant counts when it falls on or after the start of `from` and before the
 * start of the day after `to`.
 */

export type ReportContent = Pick<
  ReportDto,
  'summary' | 'series' | 'breakdown' | 'columns' | 'rows' | 'totalRows'
>;
/** `today` is the gym-time date the snapshot figures (balances, current status) refer to. */
export type ReportBuilder = (range: ReportRange, today: string) => Promise<ReportContent>;

/** Raw rows. bigint and numeric come back as strings, so read numbers through num(). */
export async function selectRows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as T[];
}

export const num = (value: unknown) => Number(value ?? 0);

export const instantInPeriod = (column: SQL, range: ReportRange) =>
  sql`(${column} >= ${gymDayStart(range.from)} and ${column} < ${gymDayStart(range.to, 1)})`;

export const dateInPeriod = (column: SQL, range: ReportRange) =>
  sql`(${column} between ${range.from}::date and ${range.to}::date)`;

const BUCKET_FORMATS: Record<ReportInterval, string> = { day: 'YYYY-MM-DD', month: 'YYYY-MM' };

/** The bucket label of an instant, by its gym-time calendar date. */
export const instantBucket = (column: SQL, interval: ReportInterval) =>
  sql`to_char(${column} at time zone ${config.gymTimezone}, ${BUCKET_FORMATS[interval]})`;

export const dateBucket = (column: SQL, interval: ReportInterval) =>
  sql`to_char(${column}, ${BUCKET_FORMATS[interval]})`;

/** Row limit plus one window count, so one query gives both the rows and their total. */
export const ROW_LIMIT = sql`limit ${REPORT_LIMITS.maxRows}`;
export const TOTAL_ROWS = sql`count(*) over ()`;

export interface BucketRow {
  bucket: string;
  [key: string]: unknown;
}

/** A point for every bucket in the period, zero where nothing happened. */
export function buildSeries(
  range: ReportRange,
  kind: ReportSeries['kind'],
  keys: ReportSeriesKey[],
  grouped: BucketRow[],
): ReportSeries {
  const byBucket = new Map(grouped.map((row) => [row.bucket, row]));
  return {
    kind,
    keys,
    points: reportBuckets(range).map((bucket) => {
      const row = byBucket.get(bucket);
      return {
        bucket,
        values: Object.fromEntries(keys.map(({ key }) => [key, num(row?.[key])])),
      };
    }),
  };
}

export const personName = (first: unknown, last: unknown) =>
  first ? `${String(first)} ${String(last)}` : null;

/** Raw queries return timestamptz as Postgres text (`2026-03-15 13:00:00+00`); answers ISO UTC. */
export function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string' || value === '') return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** Share of `part` in `whole` as a percentage with one decimal; 0 when there is nothing. */
export const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
