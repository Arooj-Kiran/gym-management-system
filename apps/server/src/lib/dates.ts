import { sql } from 'drizzle-orm';
import { config } from '../config/env';

/** Today's calendar date in the gym's timezone, as YYYY-MM-DD. */
export function gymToday(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.gymTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Start of a calendar day in the gym's timezone, as timestamptz. */
export const gymDayStart = (isoDate: string, offsetDays = 0) =>
  sql`((${isoDate}::date + ${offsetDays}::int)::timestamp at time zone ${config.gymTimezone})`;
