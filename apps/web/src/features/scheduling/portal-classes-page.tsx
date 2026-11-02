import type { MyClassSessionDto } from '@gms/shared';
import { CalendarCheck2, Dumbbell } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDayHeading, formatTimeRange, gymDateOf, groupByGymDate } from './schedule-format';
import { useBookMyClass, useCancelMyBooking, useMyClassSessions } from './scheduling-api';
import { BookingStatusBadge, SessionAvailability } from './session-badges';
import { useWeek } from './use-week';
import { WeekNav } from './week-nav';

function SessionCard({
  session,
  onBook,
  onCancel,
  booking,
}: {
  session: MyClassSessionDto;
  onBook: () => void;
  onCancel: () => void;
  booking: boolean;
}) {
  const mine = session.myBooking;
  const active = mine && (mine.status === 'BOOKED' || mine.status === 'WAITLISTED');
  const full = session.spotsLeft === 0;
  return (
    <li
      className={cn(
        'flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5',
        session.effectiveStatus === 'CANCELLED' && 'opacity-60',
      )}
    >
      <p className="w-28 shrink-0 text-13 font-medium text-fg tabular-nums">
        {formatTimeRange(session.startsAt, session.endsAt)}
      </p>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
          {session.className}
          {mine && (
            <BookingStatusBadge status={mine.status} waitlistPosition={mine.waitlistPosition} />
          )}
        </p>
        <p className="text-13 text-fg-muted">
          with {fullName(session.trainer)}
          {session.room && ` · ${session.room}`}
          {` · ${session.durationMinutes} min`}
        </p>
        {session.description && (
          <p className="mt-1 line-clamp-2 text-13 text-fg-secondary">{session.description}</p>
        )}
        {!active && !session.bookable && session.notBookableReason && (
          <p className="mt-1 text-13 text-fg-muted">{session.notBookableReason}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 sm:justify-end">
        {!mine && <SessionAvailability session={session} />}
        {active ? (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {mine.status === 'WAITLISTED' ? 'Leave waitlist' : 'Cancel booking'}
            <span className="sr-only"> for {session.className}</span>
          </Button>
        ) : (
          session.bookable && (
            <Button size="sm" onClick={onBook} loading={booking}>
              {full ? 'Join waitlist' : 'Book'}
              <span className="sr-only">
                {' '}
                {session.className} on {formatDayHeading(gymDateOf(session.startsAt))}
              </span>
            </Button>
          )
        )}
      </div>
    </li>
  );
}

/** The week's classes with the member's own booking on each; booking and cancelling inline. */
export function PortalClassesPage() {
  const week = useWeek();
  const sessions = useMyClassSessions({ from: week.from, to: week.to });
  const book = useBookMyClass();
  const cancel = useCancelMyBooking();
  const [cancelling, setCancelling] = useState<MyClassSessionDto | null>(null);

  const onBook = (session: MyClassSessionDto) =>
    book.mutate(session.id, {
      onSuccess: () =>
        toast.success(
          session.spotsLeft === 0
            ? `You’re on the waitlist for ${session.className}`
            : `Booked: ${session.className}, ${formatDayHeading(gymDateOf(session.startsAt))}`,
        ),
      onError: (error) => toast.error(errorMessage(error)),
    });

  return (
    <>
      <PageHeader
        title="Classes"
        description="Book a place, join a waitlist or cancel. If a place opens up, the first person on the waitlist gets it automatically."
      />
      <Card>
        <div className="border-b border-border p-4 sm:px-5">
          <WeekNav week={week} />
        </div>
        {sessions.isPending ? (
          <ListSkeleton rows={6} label="Loading classes" />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : sessions.data.length === 0 ? (
          <EmptyState
            icon={<Dumbbell aria-hidden />}
            title="No classes this week"
            description="Try the next week, or ask the front desk about the timetable."
          />
        ) : (
          <ol
            aria-label="Classes by day"
            aria-busy={sessions.isPlaceholderData}
            className={cn('divide-y divide-border', sessions.isPlaceholderData && 'opacity-60')}
          >
            {groupByGymDate(sessions.data, (s) => s.startsAt, week.from, week.to)
              .filter((day) => day.items.length > 0)
              .map((day) => (
                <li key={day.date}>
                  <h2
                    className={cn(
                      'bg-surface-muted/60 px-4 py-2 text-xs font-semibold tracking-wide uppercase sm:px-5',
                      day.date === week.today ? 'text-primary-text' : 'text-fg-muted',
                    )}
                  >
                    {formatDayHeading(day.date)}
                    {day.date === week.today && <span className="normal-case"> · Today</span>}
                  </h2>
                  <ul className="divide-y divide-border">
                    {day.items.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        booking={book.isPending && book.variables === session.id}
                        onBook={() => onBook(session)}
                        onCancel={() => setCancelling(session)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
          </ol>
        )}
      </Card>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={
          cancelling?.myBooking?.status === 'WAITLISTED'
            ? 'Leave the waitlist?'
            : 'Cancel your booking?'
        }
        description={
          cancelling
            ? `${cancelling.className}, ${formatDayHeading(gymDateOf(cancelling.startsAt))} ${formatTimeRange(cancelling.startsAt, cancelling.endsAt)}. Your place goes to the next person waiting.`
            : undefined
        }
        confirmLabel={
          cancelling?.myBooking?.status === 'WAITLISTED' ? 'Leave waitlist' : 'Cancel booking'
        }
        tone="danger"
        loading={cancel.isPending}
        onConfirm={() => {
          const id = cancelling?.myBooking?.id;
          if (!id) return;
          cancel.mutate(id, {
            onSuccess: () => {
              toast.success('Booking cancelled');
              setCancelling(null);
            },
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
      />
      <p className="mt-4 flex items-center gap-2 text-13 text-fg-muted">
        <CalendarCheck2 className="size-4" aria-hidden />
        Your bookings and appointments are listed under My schedule.
      </p>
    </>
  );
}
