import { addDays, type AvailabilitySlotDto, type TrainerAvailabilityDto } from '@gms/shared';
import { formatTime, toGymDateTimeInput } from '../../lib/format';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string | null): value is string =>
  value !== null && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));

/** ISO weekday of a calendar date: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** The Monday of the week holding `date`. */
export const weekStart = (date: string) => addDays(date, 1 - isoWeekday(date));

/** The calendar date (gym time) an instant falls on. */
export const gymDateOf = (iso: string) => toGymDateTimeInput(iso).slice(0, 10);

/** "Mon 26 Oct". */
export function formatDayHeading(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

/** "26 Oct – 1 Nov 2026". */
export function formatWeekRange(from: string, to: string) {
  const short = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year!, month! - 1, day!)));
  };
  return `${short(from)} – ${short(to)} ${to.slice(0, 4)}`;
}

/** "07:30–08:30" in gym time. */
export const formatTimeRange = (startsAt: string, endsAt: string) =>
  `${formatTime(startsAt)}–${formatTime(endsAt)}`;

/** Every date from `from` to `to` inclusive, each with the items that start on it. */
export function groupByGymDate<T>(
  items: T[],
  startOf: (item: T) => string,
  from: string,
  to: string,
): { date: string; items: T[] }[] {
  const days: { date: string; items: T[] }[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push({ date, items: [] });
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const item of items) byDate.get(gymDateOf(startOf(item)))?.items.push(item);
  for (const day of days) day.items.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  return days;
}

/** "Thursday" for an ISO weekday. */
export function weekdayName(weekday: number) {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, weekday)),
  );
}

const inForce = (slot: AvailabilitySlotDto, date: string) =>
  slot.effectiveFrom <= date && (slot.effectiveTo === null || slot.effectiveTo >= date);

/** Every weekly slot that applies on `date` (any weekday), from the current and upcoming sets. */
function slotsInForce(availability: TrainerAvailabilityDto, date: string) {
  return [...availability.current, ...(availability.upcoming?.slots ?? [])]
    .filter((slot) => inForce(slot, date))
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
}

/** The trainer's weekly hours on `date` itself, earliest first. */
export const hoursOn = (availability: TrainerAvailabilityDto, date: string) =>
  slotsInForce(availability, date).filter((slot) => slot.weekday === isoWeekday(date));

/** The first date after `date`, within `days`, on which the trainer has weekly hours. */
export function nextWorkingDay(availability: TrainerAvailabilityDto, date: string, days = 14) {
  for (let next = addDays(date, 1); next <= addDays(date, days); next = addDays(next, 1)) {
    if (hoursOn(availability, next).length > 0) return next;
  }
  return null;
}

/** Why a day offers no appointment start times, so the booking form can say so. */
export type NoTimesReason =
  | { kind: 'NO_HOURS' }
  | { kind: 'DAY_OFF'; weekdays: number[]; next: string | null }
  | { kind: 'FULL'; hours: AvailabilitySlotDto[] };

export function whyNoTimes(availability: TrainerAvailabilityDto, date: string): NoTimesReason {
  const all = [...availability.current, ...(availability.upcoming?.slots ?? [])];
  if (all.length === 0) return { kind: 'NO_HOURS' };
  const hours = hoursOn(availability, date);
  if (hours.length > 0) return { kind: 'FULL', hours };
  const weekdays = [...new Set(slotsInForce(availability, date).map((slot) => slot.weekday))];
  return { kind: 'DAY_OFF', weekdays, next: nextWorkingDay(availability, date) };
}
