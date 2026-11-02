import type { ScheduleItemDto, ScheduleItemKind } from '@gms/shared';
import { BriefcaseBusiness, CalendarOff, Dumbbell, UserRound, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { cn } from '../../lib/cn';
import { formatDayHeading, formatTimeRange, gymDateOf, groupByGymDate } from './schedule-format';

const KIND: Record<ScheduleItemKind, { label: string; icon: LucideIcon; tone: BadgeTone }> = {
  CLASS: { label: 'Class', icon: Dumbbell, tone: 'primary' },
  APPOINTMENT: { label: 'Personal training', icon: UserRound, tone: 'success' },
  TIME_OFF: { label: 'Time off', icon: CalendarOff, tone: 'warning' },
  SHIFT: { label: 'Shift', icon: BriefcaseBusiness, tone: 'neutral' },
};

/** Status words that mean the item is not happening as planned. */
const INACTIVE = new Set(['CANCELLED', 'NO_SHOW']);

function ScheduleRow({ item, showDate = false }: { item: ScheduleItemDto; showDate?: boolean }) {
  const kind = KIND[item.kind];
  const inactive = INACTIVE.has(item.status);
  const title =
    item.kind === 'CLASS' ? (
      <Link
        to={`/classes/sessions/${item.id}`}
        className="font-medium text-fg hover:text-primary-text hover:underline"
      >
        {item.title}
      </Link>
    ) : (
      <span className="font-medium text-fg">{item.title}</span>
    );
  return (
    <li className={cn('flex items-start gap-3 px-4 py-3 sm:px-5', inactive && 'opacity-60')}>
      <span
        className={cn(
          'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
          item.kind === 'TIME_OFF'
            ? 'bg-warning-subtle text-warning-text'
            : item.kind === 'SHIFT'
              ? 'bg-surface-muted text-fg-secondary'
              : 'bg-primary-subtle text-primary-text',
        )}
      >
        <kind.icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {title}
          {inactive && (
            <Badge tone="danger">{item.status === 'NO_SHOW' ? 'No-show' : 'Cancelled'}</Badge>
          )}
        </p>
        <p className="text-13 text-fg-muted">
          <span className="sr-only">{kind.label}. </span>
          {item.detail ?? kind.label}
          {item.capacity !== undefined && (
            <span className="tabular-nums">
              {' '}
              · {item.booked ?? 0}/{item.capacity} booked
            </span>
          )}
        </p>
      </div>
      <p className="shrink-0 text-right text-13 text-fg-secondary tabular-nums">
        {showDate && (
          <span className="block text-xs text-fg-muted">
            {formatDayHeading(gymDateOf(item.startsAt))}
          </span>
        )}
        {formatTimeRange(item.startsAt, item.endsAt)}
      </p>
    </li>
  );
}

/**
 * A calendar as a list: one heading per day from `from` to `to`, items in time order. Days with
 * nothing on them collapse into a single quiet line so a week stays short.
 */
export function ScheduleList({
  items,
  from,
  to,
  today,
  label,
}: {
  items: ScheduleItemDto[];
  from: string;
  to: string;
  today: string;
  label: string;
}) {
  const days = groupByGymDate(items, (item) => item.startsAt, from, to);
  return (
    <ol aria-label={label} className="divide-y divide-border">
      {days.map((day) => (
        <li key={day.date}>
          <h3
            className={cn(
              'flex items-center gap-1 bg-surface-muted/60 px-4 py-2 text-xs font-semibold tracking-wide uppercase sm:px-5',
              day.date === today ? 'text-primary-text' : 'text-fg-muted',
            )}
          >
            {formatDayHeading(day.date)}
            {day.date === today && <span className="normal-case">· Today</span>}
          </h3>
          {day.items.length === 0 ? (
            <p className="px-4 py-2.5 text-13 text-fg-muted sm:px-5">Nothing scheduled</p>
          ) : (
            <ul className="divide-y divide-border">
              {day.items.map((item) => (
                <ScheduleRow key={`${item.kind}-${item.id}`} item={item} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/** A flat, short list (dashboard): no day headings, date shown on each row instead. */
export function CompactScheduleList({
  items,
  label,
  showDate = false,
}: {
  items: ScheduleItemDto[];
  label: string;
  showDate?: boolean;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-border">
      {items.map((item) => (
        <ScheduleRow key={`${item.kind}-${item.id}`} item={item} showDate={showDate} />
      ))}
    </ul>
  );
}
