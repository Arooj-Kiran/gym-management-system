import { permissionScope, type ClassBookingDto, type ClassSessionDto } from '@gms/shared';
import {
  ArrowLeft,
  CalendarX2,
  Check,
  Clock,
  DoorOpen,
  Pencil,
  UserRound,
  UserRoundPlus,
  UsersRound,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { MemberAvatar } from '../members/member-avatar';
import { MemberPicker, type PickedMember } from '../members/member-picker';
import { EditSessionDialog } from './class-dialogs';
import { FormProblem } from './form-parts';
import { formatDayHeading, formatTimeRange, gymDateOf } from './schedule-format';
import {
  useBookMember,
  useCancelBooking,
  useCancelSession,
  useClassSession,
  useMarkAttendance,
  useRoster,
} from './scheduling-api';
import { BookingStatusBadge, SessionAvailability } from './session-badges';
import { useNow } from './use-now';

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    // dt/dd must be direct children of the group; the icon sits inside the dt, the value is
    // indented to line up with the label (16px icon + 12px gap).
    <div className="min-w-0">
      <dt className="flex items-center gap-3 text-xs font-medium tracking-wide text-fg-muted uppercase">
        <span className="flex [&_svg]:size-4">{icon}</span>
        {label}
      </dt>
      <dd className="pl-7 text-sm text-fg">{children}</dd>
    </div>
  );
}

function AddBookingDialog({
  session,
  open,
  onOpenChange,
}: {
  session: ClassSessionDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [member, setMember] = useState<PickedMember | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const book = useBookMember();
  const full = session.spotsLeft === 0;

  const close = (next: boolean) => {
    if (!next) {
      setMember(null);
      setProblem(null);
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (!member) {
      setProblem('Choose a member to book.');
      return;
    }
    setProblem(null);
    book.mutate(
      { sessionId: session.id, memberId: member.id },
      {
        onSuccess: (booking) => {
          toast.success(
            booking.status === 'WAITLISTED'
              ? `${fullName(member)} added to the waitlist (#${booking.waitlistPosition})`
              : `${fullName(member)} booked`,
          );
          close(false);
        },
        onError: (error) => setProblem(errorMessage(error)),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Book ${session.className}`}
      description={
        full
          ? 'The class is full. The member goes on the waitlist and moves up automatically when a place frees.'
          : `${session.spotsLeft} of ${session.capacity} places left. The member needs a membership that is active on the day and covers the class time.`
      }
      busy={book.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={book.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={book.isPending}>
            {full ? 'Add to waitlist' : 'Book place'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormProblem message={problem} />
        <MemberPicker name="booking-member" selected={member} onSelect={setMember} />
      </div>
    </Dialog>
  );
}

function RosterRow({
  booking,
  canCancel,
  canMark,
  onCancel,
}: {
  booking: ClassBookingDto;
  canCancel: boolean;
  canMark: boolean;
  onCancel: () => void;
}) {
  const mark = useMarkAttendance();
  const markAs = (status: 'ATTENDED' | 'NO_SHOW') =>
    mark.mutate(
      { id: booking.id, status },
      {
        onSuccess: () =>
          toast.success(
            `${fullName(booking.member)} marked ${status === 'ATTENDED' ? 'attended' : 'no-show'}`,
          ),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  const seated = ['BOOKED', 'ATTENDED', 'NO_SHOW'].includes(booking.status);

  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <MemberAvatar member={booking.member} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg">{fullName(booking.member)}</p>
          <p className="text-13 text-fg-muted">
            <span className="font-mono text-xs">{booking.member.memberCode}</span> · booked{' '}
            {formatRelative(booking.bookedAt).toLowerCase()}
            {booking.bookedByName ? ` by ${booking.bookedByName}` : ' online'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <BookingStatusBadge status={booking.status} waitlistPosition={booking.waitlistPosition} />
        {canMark && seated && (
          <div
            role="group"
            aria-label={`Attendance for ${fullName(booking.member)}`}
            className="flex gap-1.5"
          >
            <Button
              size="sm"
              variant={booking.status === 'ATTENDED' ? 'primary' : 'secondary'}
              icon={<Check aria-hidden />}
              aria-pressed={booking.status === 'ATTENDED'}
              disabled={mark.isPending}
              onClick={() => markAs('ATTENDED')}
            >
              Attended
            </Button>
            <Button
              size="sm"
              variant={booking.status === 'NO_SHOW' ? 'danger' : 'secondary'}
              icon={<X aria-hidden />}
              aria-pressed={booking.status === 'NO_SHOW'}
              disabled={mark.isPending}
              onClick={() => markAs('NO_SHOW')}
            >
              No-show
            </Button>
          </div>
        )}
        {canCancel && (booking.status === 'BOOKED' || booking.status === 'WAITLISTED') && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel<span className="sr-only"> booking for {fullName(booking.member)}</span>
          </Button>
        )}
      </div>
    </li>
  );
}

function Roster({ session }: { session: ClassSessionDto }) {
  const can = useCan();
  const { user } = useSession();
  const roster = useRoster(session.id);
  const cancel = useCancelBooking();
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<ClassBookingDto | null>(null);
  const now = useNow();
  const open = session.effectiveStatus === 'SCHEDULED' && Date.parse(session.startsAt) > now;
  const started = Date.parse(session.startsAt) <= now;
  const canBook = can('bookings:manage') && open;
  const markScope = permissionScope(user.role, 'classes:mark-attendance');
  const canMark =
    session.effectiveStatus !== 'CANCELLED' &&
    started &&
    (markScope === 'ALL' || (markScope === 'OWN_SESSIONS' && session.trainer.id === user.id));

  const bookings = roster.data ?? [];
  const seated = bookings.filter((b) => b.status !== 'WAITLISTED' && b.status !== 'CANCELLED');
  const waiting = bookings
    .filter((b) => b.status === 'WAITLISTED')
    .sort((a, b) => (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0));
  const cancelled = bookings.filter((b) => b.status === 'CANCELLED');

  const section = (title: string, rows: ClassBookingDto[]) =>
    rows.length > 0 && (
      <section aria-label={title}>
        <h3 className="bg-surface-muted/60 px-4 py-2 text-xs font-semibold tracking-wide text-fg-muted uppercase sm:px-5">
          {title} <span className="tabular-nums">({rows.length})</span>
        </h3>
        <ul className="divide-y divide-border">
          {rows.map((booking) => (
            <RosterRow
              key={booking.id}
              booking={booking}
              canCancel={can('bookings:manage') && open}
              canMark={canMark}
              onCancel={() => setCancelling(booking)}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <Card>
      <CardHeader
        title="Roster"
        description={
          canMark
            ? 'Mark who came. You can change a mark if it was wrong.'
            : started
              ? 'This class has started; bookings are closed.'
              : 'Members with a place, then the waitlist in order.'
        }
        action={
          canBook && (
            <Button size="sm" icon={<UserRoundPlus aria-hidden />} onClick={() => setAdding(true)}>
              {session.spotsLeft === 0 ? 'Add to waitlist' : 'Book a member'}
            </Button>
          )
        }
      />
      {roster.isPending ? (
        <ListSkeleton rows={4} label="Loading the roster" />
      ) : roster.isError ? (
        <ErrorState error={roster.error} onRetry={() => roster.refetch()} />
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={<UsersRound aria-hidden />}
          title="No bookings yet"
          description={
            open
              ? 'Members can book from their portal, or the front desk can book for them.'
              : undefined
          }
        />
      ) : (
        <div className="divide-y divide-border border-t border-border">
          {section('Places', seated)}
          {section('Waitlist', waiting)}
          {section('Cancelled', cancelled)}
        </div>
      )}
      {canBook && <AddBookingDialog session={session} open={adding} onOpenChange={setAdding} />}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(next) => !next && setCancelling(null)}
        title={`Cancel ${cancelling ? fullName(cancelling.member) : 'this'} booking?`}
        description={
          cancelling?.status === 'BOOKED' && waiting.length > 0
            ? `The place goes to ${fullName(waiting[0]!.member)}, first on the waitlist.`
            : 'The place becomes free for someone else.'
        }
        confirmLabel="Cancel booking"
        tone="danger"
        loading={cancel.isPending}
        onConfirm={() => {
          if (!cancelling) return;
          cancel.mutate(cancelling.id, {
            onSuccess: () => {
              toast.success('Booking cancelled');
              setCancelling(null);
            },
            onError: (error) => toast.error(errorMessage(error)),
          });
        }}
      />
    </Card>
  );
}

export function SessionPage() {
  const { id = '' } = useParams();
  const can = useCan();
  const { user } = useSession();
  const session = useClassSession(id);
  const cancelSession = useCancelSession();
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const now = useNow();

  const back = (
    <Link
      to="/classes"
      className="inline-flex items-center gap-1.5 text-13 text-fg-secondary hover:text-fg"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      Classes
    </Link>
  );

  if (session.isPending)
    return (
      <>
        <PageHeader eyebrow={back} title="Class" />
        <Card className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-3 h-4 w-72" />
        </Card>
      </>
    );
  if (session.isError)
    return (
      <>
        <PageHeader eyebrow={back} title="Class" />
        <Card>
          <ErrorState error={session.error} onRetry={() => session.refetch()} />
        </Card>
      </>
    );

  const s = session.data;
  const upcoming = s.effectiveStatus === 'SCHEDULED' && Date.parse(s.startsAt) > now;
  const canManage = can('classes:manage') && upcoming;
  const rosterScope = permissionScope(user.role, 'bookings:read');
  const seesRoster =
    rosterScope === 'ALL' || (rosterScope === 'OWN_SESSIONS' && s.trainer.id === user.id);

  return (
    <>
      <PageHeader
        eyebrow={back}
        title={s.className}
        description={s.description ?? undefined}
        actions={
          canManage && (
            <>
              <Button
                variant="secondary"
                icon={<Pencil aria-hidden />}
                onClick={() => setEditing(true)}
              >
                Edit session
              </Button>
              <Button
                variant="danger"
                icon={<CalendarX2 aria-hidden />}
                onClick={() => setCancelling(true)}
              >
                Cancel session
              </Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 lg:order-1">
          {seesRoster ? (
            <Roster session={s} />
          ) : (
            <Card>
              <EmptyState
                icon={<UsersRound aria-hidden />}
                title="Roster not shown"
                description="Only the trainer teaching this class and the front desk can see who is booked."
              />
            </Card>
          )}
        </div>
        <Card className="order-1 h-fit p-5 lg:order-2">
          <div className="mb-4">
            <SessionAvailability session={s} />
          </div>
          {s.effectiveStatus === 'CANCELLED' && s.cancelReason && (
            <p className="mb-4 rounded-md bg-danger-subtle px-3 py-2 text-13 text-danger-text">
              Cancelled: {s.cancelReason}
            </p>
          )}
          <dl className="flex flex-col gap-4">
            <Fact icon={<Clock aria-hidden />} label="When">
              {formatDayHeading(gymDateOf(s.startsAt))} · {formatTimeRange(s.startsAt, s.endsAt)}
              <span className="block text-13 text-fg-muted">{s.durationMinutes} minutes</span>
            </Fact>
            <Fact icon={<UserRound aria-hidden />} label="Trainer">
              {fullName(s.trainer)}
            </Fact>
            <Fact icon={<DoorOpen aria-hidden />} label="Room">
              {s.room ?? <span className="text-fg-muted">Not set</span>}
            </Fact>
            <Fact icon={<UsersRound aria-hidden />} label="Places">
              <span className="tabular-nums">
                {s.bookedCount} of {s.capacity} taken
              </span>
              {s.waitlistCount > 0 && (
                <span className="block text-13 text-fg-muted">
                  {s.waitlistCount} on the waitlist
                </span>
              )}
            </Fact>
          </dl>
          <div
            className={cn('mt-5 h-1.5 overflow-hidden rounded-full bg-surface-muted')}
            role="presentation"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.min(100, (s.bookedCount / s.capacity) * 100)}%` }}
            />
          </div>
          {s.effectiveStatus === 'COMPLETED' && (
            <div className="mt-4">
              <Badge tone="neutral">Finished</Badge>
            </div>
          )}
        </Card>
      </div>
      {canManage && editing && <EditSessionDialog session={s} onOpenChange={setEditing} />}
      {canManage && (
        <ConfirmDialog
          open={cancelling}
          onOpenChange={setCancelling}
          title={`Cancel ${s.className}?`}
          description={
            s.bookedCount + s.waitlistCount > 0
              ? `${s.bookedCount + s.waitlistCount} booked and waitlisted members lose their places. Tell them before you confirm.`
              : 'Nobody is booked yet. The session stays on record as cancelled.'
          }
          confirmLabel="Cancel session"
          tone="danger"
          reason="required"
          reasonLabel="Why is it cancelled?"
          loading={cancelSession.isPending}
          onConfirm={(reason) => {
            if (!reason) return;
            cancelSession.mutate(
              { id: s.id, reason },
              {
                onSuccess: () => {
                  toast.success(`${s.className} cancelled`);
                  setCancelling(false);
                },
                onError: (error) => toast.error(errorMessage(error)),
              },
            );
          }}
        />
      )}
    </>
  );
}
