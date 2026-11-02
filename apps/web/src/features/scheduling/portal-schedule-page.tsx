import {
  APPOINTMENT_STATUS_LABELS,
  BOOKING_STATUS_LABELS,
  type AppointmentStatus,
  type BookingStatus,
  type MyScheduleItemDto,
} from '@gms/shared';
import { CalendarDays, Dumbbell, UserRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { ButtonLink, Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDayHeading, formatTimeRange, gymDateOf } from './schedule-format';
import {
  useCancelMyAppointment,
  useCancelMyBooking,
  useMyAppointments,
  useMySchedule,
} from './scheduling-api';
import { BookingStatusBadge } from './session-badges';
import { useNow } from './use-now';

const APPOINTMENT_TONES: Record<AppointmentStatus, BadgeTone> = {
  BOOKED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

function statusBadge(item: MyScheduleItemDto) {
  if (item.kind === 'CLASS' && item.status in BOOKING_STATUS_LABELS)
    return (
      <BookingStatusBadge
        status={item.status as BookingStatus}
        waitlistPosition={item.waitlistPosition}
      />
    );
  if (item.kind === 'APPOINTMENT' && item.status in APPOINTMENT_STATUS_LABELS) {
    const status = item.status as AppointmentStatus;
    return (
      <Badge tone={APPOINTMENT_TONES[status]} dot>
        {APPOINTMENT_STATUS_LABELS[status]}
      </Badge>
    );
  }
  return null;
}

/** The member's upcoming classes and personal training, and their recent appointments. */
export function PortalSchedulePage() {
  const now = useNow();
  const schedule = useMySchedule();
  const appointments = useMyAppointments();
  const cancelBooking = useCancelMyBooking();
  const cancelAppointment = useCancelMyAppointment();
  const [cancelling, setCancelling] = useState<MyScheduleItemDto | null>(null);
  const pending = cancelBooking.isPending || cancelAppointment.isPending;
  const past = (appointments.data ?? [])
    .filter((item) => Date.parse(item.startsAt) <= now)
    .slice(0, 10);

  return (
    <>
      <PageHeader
        title="My schedule"
        description="Classes you have booked or are waiting for, and personal-training sessions. Times are in gym time."
        actions={
          <ButtonLink to="/portal/classes" variant="secondary" icon={<Dumbbell aria-hidden />}>
            Browse classes
          </ButtonLink>
        }
      />
      <Card className="mb-6">
        <CardHeader title="Coming up" />
        {schedule.isPending ? (
          <ListSkeleton rows={4} label="Loading your schedule" />
        ) : schedule.isError ? (
          <ErrorState error={schedule.error} onRetry={() => schedule.refetch()} />
        ) : schedule.data.length === 0 ? (
          <EmptyState
            icon={<CalendarDays aria-hidden />}
            title="Nothing booked yet"
            description="Book a class from the timetable. Personal training is booked through the front desk or your trainer."
          />
        ) : (
          <ul aria-label="Coming up" className="divide-y divide-border">
            {schedule.data.map((item) => {
              const started = Date.parse(item.startsAt) <= now;
              const cancellable =
                !started && (item.status === 'BOOKED' || item.status === 'WAITLISTED');
              const Icon = item.kind === 'CLASS' ? Dumbbell : UserRound;
              return (
                <li
                  key={`${item.kind}-${item.id}`}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-text">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                        {item.title}
                        {statusBadge(item)}
                      </p>
                      <p className="text-13 text-fg-muted">
                        <span className="tabular-nums">
                          {formatDayHeading(gymDateOf(item.startsAt))} ·{' '}
                          {formatTimeRange(item.startsAt, item.endsAt)}
                        </span>{' '}
                        · with {item.trainerName}
                        {item.room && ` · ${item.room}`}
                      </p>
                    </div>
                  </div>
                  {cancellable && (
                    <div className="pl-11 sm:pl-0">
                      <Button variant="secondary" size="sm" onClick={() => setCancelling(item)}>
                        {item.status === 'WAITLISTED' ? 'Leave waitlist' : 'Cancel'}
                        <span className="sr-only"> {item.title}</span>
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader title="Recent personal training" />
          <ul aria-label="Recent personal training" className="divide-y divide-border">
            {past.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5',
                  item.status === 'CANCELLED' && 'opacity-70',
                )}
              >
                <p className="min-w-0 flex-1 text-13 text-fg">
                  {formatDayHeading(gymDateOf(item.startsAt))} ·{' '}
                  <span className="tabular-nums">
                    {formatTimeRange(item.startsAt, item.endsAt)}
                  </span>{' '}
                  <span className="text-fg-muted">with {fullName(item.trainer)}</span>
                </p>
                <Badge tone={APPOINTMENT_TONES[item.status]} dot>
                  {APPOINTMENT_STATUS_LABELS[item.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={
          cancelling?.kind === 'APPOINTMENT'
            ? 'Cancel this personal-training session?'
            : cancelling?.status === 'WAITLISTED'
              ? 'Leave the waitlist?'
              : 'Cancel your class booking?'
        }
        description={
          cancelling
            ? `${cancelling.title} with ${cancelling.trainerName}, ${formatDayHeading(gymDateOf(cancelling.startsAt))} ${formatTimeRange(cancelling.startsAt, cancelling.endsAt)}.`
            : undefined
        }
        confirmLabel={cancelling?.status === 'WAITLISTED' ? 'Leave waitlist' : 'Cancel it'}
        tone="danger"
        loading={pending}
        onConfirm={() => {
          if (!cancelling) return;
          const options = {
            onSuccess: () => {
              toast.success(
                cancelling.kind === 'APPOINTMENT' ? 'Appointment cancelled' : 'Booking cancelled',
              );
              setCancelling(null);
            },
            onError: (error: unknown) => toast.error(errorMessage(error)),
          };
          if (cancelling.kind === 'APPOINTMENT') cancelAppointment.mutate(cancelling.id, options);
          else cancelBooking.mutate(cancelling.id, options);
        }}
      />
    </>
  );
}
