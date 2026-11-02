import { addDays } from '@gms/shared';
import { gymTodayIso } from '../../lib/format';
import { useUrlFilters } from '../billing/use-url-filters';
import { weekStart } from './schedule-format';

/** The Monday–Sunday week shown, kept in `?week=` so it survives a reload or a shared link. */
export function useWeek() {
  const filters = useUrlFilters();
  const today = gymTodayIso();
  const thisWeek = weekStart(today);
  const asked = filters.date('week');
  const from = asked ? weekStart(asked) : thisWeek;
  const to = addDays(from, 6);
  const go = (monday: string) =>
    filters.update({ week: monday === thisWeek ? null : monday }, false);
  return { from, to, today, isThisWeek: from === thisWeek, go, filters };
}

export type Week = ReturnType<typeof useWeek>;
