import { describe, expect, it } from 'vitest';
import {
  canViewReport,
  dashboardRangeQuerySchema,
  FINANCIAL_REPORT_TYPES,
  OPERATIONAL_REPORT_TYPES,
  REPORT_TYPES,
  reportBuckets,
  reportPermission,
  reportQuerySchema,
  reportTypesForRole,
  resolveReportRange,
} from '../src';

const TODAY = '2026-10-26';

describe('report permissions (PLAN §4.9, §5)', () => {
  it('splits the 11 types into operational and financial', () => {
    expect(REPORT_TYPES).toHaveLength(11);
    for (const type of OPERATIONAL_REPORT_TYPES) {
      expect(reportPermission(type)).toBe('reports:operational');
    }
    for (const type of FINANCIAL_REPORT_TYPES) {
      expect(reportPermission(type)).toBe('reports:financial');
    }
  });

  it('gives Admin and Manager every report', () => {
    expect(reportTypesForRole('ADMIN')).toEqual([...REPORT_TYPES]);
    expect(reportTypesForRole('MANAGER')).toEqual([...REPORT_TYPES]);
  });

  it('limits the Receptionist to attendance and denied access', () => {
    expect(reportTypesForRole('RECEPTIONIST')).toEqual(['attendance', 'denied-access']);
    expect(canViewReport('RECEPTIONIST', 'payments')).toBe(false);
    expect(canViewReport('RECEPTIONIST', 'registrations')).toBe(false);
  });

  it('gives Trainers and Members no reports', () => {
    expect(reportTypesForRole('TRAINER')).toEqual([]);
    expect(reportTypesForRole('MEMBER')).toEqual([]);
  });
});

describe('resolveReportRange', () => {
  it('defaults to the last 30 days, today included, per day', () => {
    expect(resolveReportRange({}, TODAY)).toEqual({
      ok: true,
      range: { from: '2026-09-27', to: TODAY, interval: 'day' },
    });
  });

  it('counts back 30 days from a given end date', () => {
    const result = resolveReportRange({ to: '2026-03-31' }, TODAY);
    expect(result).toEqual({
      ok: true,
      range: { from: '2026-03-02', to: '2026-03-31', interval: 'day' },
    });
  });

  it('accepts a single day', () => {
    const result = resolveReportRange({ from: TODAY, to: TODAY }, TODAY);
    expect(result.ok && result.range.from === result.range.to).toBe(true);
  });

  it('switches to months after 92 days unless an interval is given', () => {
    const daily = resolveReportRange({ from: '2026-01-01', to: '2026-04-02' }, TODAY);
    const monthly = resolveReportRange({ from: '2026-01-01', to: '2026-04-03' }, TODAY);
    const forced = resolveReportRange(
      { from: '2026-01-01', to: '2026-04-03', interval: 'day' },
      TODAY,
    );
    expect(daily.ok && daily.range.interval).toBe('day');
    expect(monthly.ok && monthly.range.interval).toBe('month');
    expect(forced.ok && forced.range.interval).toBe('day');
  });

  it('rejects an end before the start', () => {
    expect(resolveReportRange({ from: '2026-10-10', to: '2026-10-09' }, TODAY)).toMatchObject({
      ok: false,
      path: 'to',
    });
    // Only "from", in the future: "to" defaults to today, which is earlier.
    expect(resolveReportRange({ from: '2026-11-01' }, TODAY).ok).toBe(false);
  });

  it('allows at most 366 days', () => {
    expect(resolveReportRange({ from: '2025-10-26', to: '2026-10-26' }, TODAY).ok).toBe(true);
    expect(resolveReportRange({ from: '2025-10-25', to: '2026-10-26' }, TODAY).ok).toBe(false);
  });
});

describe('reportBuckets', () => {
  it('lists every day, inclusive', () => {
    expect(reportBuckets({ from: '2026-02-27', to: '2026-03-02', interval: 'day' })).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });

  it('lists every month across a year end', () => {
    expect(reportBuckets({ from: '2025-11-15', to: '2026-02-03', interval: 'month' })).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('report query schemas', () => {
  it('defaults the format to json and rejects unknown keys', () => {
    expect(reportQuerySchema.parse({})).toEqual({ format: 'json' });
    expect(reportQuerySchema.safeParse({ format: 'xlsx' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ memberId: 'x' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: '26/10/2026' }).success).toBe(false);
  });

  it('takes a period and interval on the dashboard, but no format', () => {
    expect(dashboardRangeQuerySchema.parse({ from: TODAY, interval: 'month' })).toEqual({
      from: TODAY,
      interval: 'month',
    });
    expect(dashboardRangeQuerySchema.safeParse({ format: 'csv' }).success).toBe(false);
  });
});
