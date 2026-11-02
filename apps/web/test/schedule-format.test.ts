import type { AvailabilitySlotDto, TrainerAvailabilityDto } from '@gms/shared';
import { describe, expect, it } from 'vitest';
import { splitServerError, parseWhole } from '../src/features/scheduling/form-utils';
import {
  formatDayHeading,
  formatTimeRange,
  formatWeekRange,
  gymDateOf,
  groupByGymDate,
  isIsoDate,
  hoursOn,
  isoWeekday,
  nextWorkingDay,
  weekdayName,
  weekStart,
  whyNoTimes,
} from '../src/features/scheduling/schedule-format';
import { ApiError } from '../src/api/client';

describe('schedule weeks', () => {
  it('runs Monday to Sunday', () => {
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-11-01')).toBe(7);
    expect(weekStart('2026-10-22')).toBe('2026-10-19');
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    // A Sunday belongs to the week that started six days earlier, across a month end.
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
  });

  it('formats days and week ranges without shifting the date', () => {
    expect(formatDayHeading('2026-10-26')).toBe('Mon 26 Oct');
    expect(formatWeekRange('2026-10-26', '2026-11-01')).toBe('26 Oct – 1 Nov 2026');
  });

  it('accepts only real ISO dates from the URL', () => {
    expect(isIsoDate('2026-10-22')).toBe(true);
    expect(isIsoDate('2026-13-40')).toBe(false);
    expect(isIsoDate('next week')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('gym-time grouping (Asia/Karachi, UTC+5)', () => {
  it('puts an instant on the gym calendar date, not the UTC one', () => {
    // 20:30 UTC on Sunday is 01:30 on Monday at the gym.
    expect(gymDateOf('2026-10-25T20:30:00.000Z')).toBe('2026-10-26');
    expect(formatTimeRange('2026-10-26T02:00:00.000Z', '2026-10-26T03:00:00.000Z')).toBe(
      '07:00–08:00',
    );
  });

  it('lists every day of the range, items sorted by start, items outside dropped', () => {
    const items = [
      { id: 'late', startsAt: '2026-10-26T13:00:00.000Z' },
      { id: 'early', startsAt: '2026-10-26T02:00:00.000Z' },
      { id: 'after-midnight', startsAt: '2026-10-25T20:30:00.000Z' },
      { id: 'outside', startsAt: '2026-11-05T02:00:00.000Z' },
    ];
    const days = groupByGymDate(items, (item) => item.startsAt, '2026-10-26', '2026-10-28');
    expect(days.map((day) => day.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(days[0]!.items.map((item) => item.id)).toEqual(['after-midnight', 'early', 'late']);
    expect(days[1]!.items).toEqual([]);
  });
});

describe('scheduling form helpers', () => {
  it('reads whole numbers only', () => {
    expect(parseWhole('45')).toBe(45);
    expect(parseWhole(' 12 ')).toBe(12);
    expect(parseWhole('4.5')).toBeNull();
    expect(parseWhole('')).toBeNull();
    expect(parseWhole('ten')).toBeNull();
  });

  it('splits field errors from a general problem', () => {
    const validation = new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', [
      { path: 'capacity', message: 'Must be at least 1' },
    ]);
    expect(splitServerError(validation).fields).toEqual({ capacity: 'Must be at least 1' });

    const clash = new ApiError(409, 'SCHEDULE_CONFLICT', 'The trainer is already booked then.');
    expect(splitServerError(clash)).toEqual({
      fields: {},
      problem: 'The trainer is already booked then.',
    });
  });
});

const slot = (
  weekday: number,
  startTime: string,
  endTime: string,
  effectiveFrom = '2026-01-05',
  effectiveTo: string | null = null,
): AvailabilitySlotDto => ({
  id: `${weekday}-${startTime}-${effectiveFrom}`,
  weekday,
  startTime,
  endTime,
  effectiveFrom,
  effectiveTo,
});

const hours = (
  current: AvailabilitySlotDto[],
  upcoming: TrainerAvailabilityDto['upcoming'] = null,
): TrainerAvailabilityDto => ({ current, upcoming, timeOff: [] });

describe('why a day offers no appointment times', () => {
  // 2026-10-29 is a Thursday.
  const THU = '2026-10-29';

  it('names weekdays', () => {
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayName(4)).toBe('Thursday');
    expect(weekdayName(7)).toBe('Sunday');
  });

  it('a trainer with no weekly hours at all', () => {
    expect(whyNoTimes(hours([]), THU)).toEqual({ kind: 'NO_HOURS' });
  });

  it('a weekday the trainer does not work: their days and the next working day', () => {
    const week = hours([slot(1, '09:00', '13:00'), slot(5, '16:00', '20:00')]);
    expect(whyNoTimes(week, THU)).toEqual({
      kind: 'DAY_OFF',
      weekdays: [1, 5],
      next: '2026-10-30',
    });
    // From a Friday evening the next one is the Monday.
    expect(nextWorkingDay(week, '2026-10-30')).toBe('2026-11-02');
  });

  it('a working day that is fully taken returns the hours of that day, earliest first', () => {
    const week = hours([
      slot(4, '16:00', '20:00'),
      slot(4, '07:00', '10:00'),
      slot(1, '09:00', '13:00'),
    ]);
    const reason = whyNoTimes(week, THU);
    expect(reason.kind).toBe('FULL');
    expect(reason.kind === 'FULL' && reason.hours.map((s) => s.startTime)).toEqual([
      '07:00',
      '16:00',
    ]);
  });

  it('switches to the upcoming hours on their start date', () => {
    const changing = hours([slot(4, '09:00', '12:00', '2026-01-05', '2026-11-01')], {
      effectiveFrom: '2026-11-02',
      slots: [slot(1, '08:00', '12:00', '2026-11-02')],
    });
    expect(hoursOn(changing, THU).map((s) => s.endTime)).toEqual(['12:00']);
    // Thursdays stop after the change; Mondays start.
    expect(hoursOn(changing, '2026-11-05')).toEqual([]);
    expect(whyNoTimes(changing, '2026-11-05')).toMatchObject({
      kind: 'DAY_OFF',
      weekdays: [1],
      next: '2026-11-09',
    });
  });

  it('hours that start later: no hours apply yet, so offer the first day they do', () => {
    const later = hours([], {
      effectiveFrom: '2026-11-02',
      slots: [slot(2, '10:00', '14:00', '2026-11-02')],
    });
    expect(whyNoTimes(later, THU)).toEqual({ kind: 'DAY_OFF', weekdays: [], next: '2026-11-03' });
  });

  it('looks no more than two weeks ahead', () => {
    const later = hours([], {
      effectiveFrom: '2027-01-04',
      slots: [slot(1, '10:00', '14:00', '2027-01-04')],
    });
    expect(nextWorkingDay(later, THU)).toBeNull();
  });
});
