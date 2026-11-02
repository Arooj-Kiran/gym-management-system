import {
  addDays,
  REPORT_INTERVALS,
  resolveReportRange,
  type ReportInterval,
  type ReportRange,
} from '@gms/shared';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { gymTodayIso } from '../../lib/format';

/**
 * The period shared by the dashboard and the reports: inclusive gym-time dates kept in the URL
 * (`?from=&to=&interval=`) so a view can be bookmarked or passed on. No dates means the server
 * default, the last 30 days.
 */

export const PERIOD_PRESETS = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'month', label: 'This month' },
  { value: '12m', label: '12 months' },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]['value'];

/** The default period when the URL has no dates (matches REPORT_LIMITS.defaultRangeDays). */
export const DEFAULT_PRESET: PeriodPreset = '30d';

export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case '12m': {
      // The first of the month eleven months back: twelve whole calendar months, at most 366 days.
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7)) - 11;
      const start =
        month < 1
          ? `${year - 1}-${String(month + 12).padStart(2, '0')}`
          : `${year}-${String(month).padStart(2, '0')}`;
      return { from: `${start}-01`, to: today };
    }
  }
}

export function matchPreset(from: string, to: string, today: string): PeriodPreset | null {
  for (const { value } of PERIOD_PRESETS) {
    const range = presetRange(value, today);
    if (range.from === from && range.to === to) return value;
  }
  return null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string | null) =>
  value && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    ? value
    : undefined;

export interface PeriodState {
  /** What the inputs show: the URL dates, or the default period. */
  from: string;
  to: string;
  /** Chosen grouping; undefined lets the server pick (by day up to 92 days, then by month). */
  interval: ReportInterval | undefined;
  /** The checked period, or null with a message when the dates do not make a valid period. */
  range: ReportRange | null;
  error: string | null;
  preset: PeriodPreset | null;
  /** Query parameters for the API: only what the URL holds, so the server applies its default. */
  query: { from?: string; to?: string; interval?: ReportInterval };
  setDates: (from: string, to: string) => void;
  setPreset: (preset: PeriodPreset) => void;
  setInterval: (interval: ReportInterval | undefined) => void;
}

export function usePeriodParams(): PeriodState {
  const [params, setParams] = useSearchParams();
  const today = gymTodayIso();
  const urlFrom = validDate(params.get('from'));
  const urlTo = validDate(params.get('to'));
  const rawInterval = params.get('interval');
  const interval = REPORT_INTERVALS.includes(rawInterval as ReportInterval)
    ? (rawInterval as ReportInterval)
    : undefined;

  const fallback = presetRange(DEFAULT_PRESET, urlTo ?? today);
  const from = urlFrom ?? fallback.from;
  const to = urlTo ?? today;
  const resolved = resolveReportRange({ from, to, interval }, today);

  const update = useCallback(
    (changes: Record<string, string | undefined>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return {
    from,
    to,
    interval,
    range: resolved.ok ? resolved.range : null,
    error: resolved.ok ? null : resolved.message,
    preset: matchPreset(from, to, today),
    query: { from: urlFrom, to: urlTo, interval },
    setDates: (nextFrom, nextTo) => update({ from: nextFrom, to: nextTo }),
    // The default preset clears the dates, so the URL stays clean and follows "today".
    setPreset: (preset) =>
      preset === DEFAULT_PRESET
        ? update({ from: undefined, to: undefined })
        : update(presetRange(preset, today)),
    setInterval: (next) => update({ interval: next }),
  };
}

/** "1 Oct – 26 Oct 2026", short when both ends share a year. */
export function formatPeriod(from: string, to: string) {
  const format = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: withYear ? 'numeric' : undefined,
      timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  if (from === to) return format(from, true);
  return `${format(from, from.slice(0, 4) !== to.slice(0, 4))} – ${format(to, true)}`;
}
