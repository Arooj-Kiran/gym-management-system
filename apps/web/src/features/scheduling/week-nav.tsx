import { addDays } from '@gms/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, IconButton } from '../../components/ui/button';
import { formatWeekRange, weekStart } from './schedule-format';
import type { Week } from './use-week';

export function WeekNav({ week }: { week: Week }) {
  return (
    <div className="flex items-center gap-2">
      <IconButton label="Previous week" onClick={() => week.go(addDays(week.from, -7))}>
        <ChevronLeft aria-hidden />
      </IconButton>
      <p
        className="min-w-0 flex-1 text-center text-sm font-medium text-fg tabular-nums sm:min-w-44 sm:flex-none"
        aria-live="polite"
      >
        {formatWeekRange(week.from, week.to)}
      </p>
      <IconButton label="Next week" onClick={() => week.go(addDays(week.from, 7))}>
        <ChevronRight aria-hidden />
      </IconButton>
      <Button
        variant="secondary"
        size="sm"
        disabled={week.isThisWeek}
        onClick={() => week.go(weekStart(week.today))}
      >
        This week
      </Button>
    </div>
  );
}
