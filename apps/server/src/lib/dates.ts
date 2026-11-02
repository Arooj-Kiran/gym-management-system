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

/** Gym-time calendar date, wall-clock time (HH:MM) and ISO weekday (Mon = 1) of an instant. */
export function gymWallClock(instant: Date): { date: string; time: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.gymTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, weekday: isoWeekday(date) };
}

/** ISO weekday of a YYYY-MM-DD date: Monday = 1 … Sunday = 7. */
export function isoWeekday(isoDate: string): number {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Offset of the gym timezone from UTC at an instant, in milliseconds. */
function gymOffsetMs(at: Date): number {
  const { date, time } = gymWallClock(at);
  const wall = Date.parse(`${date}T${time}:00Z`);
  return wall - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The instant a gym-time wall clock shows `time` (HH:MM) on `isoDate`. */
export function gymLocalToInstant(isoDate: string, time: string): Date {
  const naive = Date.parse(`${isoDate}T${time}:00Z`);
  // Two passes settle the offset even across a DST change (none in Asia/Karachi today).
  let guess = naive - gymOffsetMs(new Date(naive));
  guess = naive - gymOffsetMs(new Date(guess));
  return new Date(guess);
}
