import type { AttendanceDto, MemberDto } from '@gms/shared';
import { CalendarCheck, ShieldCheck, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Pagination } from '../../components/ui/pagination';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { useCan } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDateTime, formatDuration, formatTime } from '../../lib/format';
import { DecisionBadge, SourceBadge } from '../access/access-badges';
import { useMemberAccessAttempts } from '../access/access-api';
import { useCheckOut, useMemberAttendance } from './attendance-api';
import { AttendanceDialog } from './attendance-dialog';
import { ManualCheckInDialog } from './manual-check-in-dialog';

const PAGE_SIZE = 10;

function CheckIns({ member }: { member: MemberDto }) {
  const can = useCan();
  const [page, setPage] = useState(1);
  const list = useMemberAttendance(member.id, { page, pageSize: PAGE_SIZE });
  const checkOut = useCheckOut();
  const [opened, setOpened] = useState<AttendanceDto | null>(null);
  const [leaving, setLeaving] = useState<AttendanceDto | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const canManual = can('attendance:manual-check-in') && !member.archivedAt;

  return (
    <Card>
      <CardHeader
        title="Check-ins"
        description="Granted entries, newest first"
        action={
          canManual && (
            <Button
              size="sm"
              variant="secondary"
              icon={<UserCheck aria-hidden />}
              onClick={() => setManualOpen(true)}
            >
              Manual check-in
            </Button>
          )
        }
      />
      {list.isPending ? (
        <ListSkeleton rows={4} label="Loading check-ins" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck aria-hidden />}
          title="No check-ins yet"
          description="Their scans and manual check-ins will be listed here."
        />
      ) : (
        <>
          <ul className={cn('divide-y divide-border', list.isPlaceholderData && 'opacity-60')}>
            {list.data.data.map((record) => (
              <li
                key={record.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5"
              >
                <span className="min-w-0 flex-1 text-13">
                  <span
                    className={cn(
                      'block font-medium text-fg tabular-nums',
                      record.status === 'VOIDED' && 'text-fg-muted line-through',
                    )}
                  >
                    {formatDateTime(record.checkInAt)}
                    <span className="font-normal text-fg-muted">
                      {' '}
                      → {record.checkOutAt ? formatTime(record.checkOutAt) : 'still in'}
                    </span>
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {record.planName}
                    {record.checkOutAt &&
                      ` · ${formatDuration(record.checkInAt, record.checkOutAt)}`}
                  </span>
                </span>
                <SourceBadge source={record.source} />
                {record.status === 'VOIDED' && <Badge tone="danger">Voided</Badge>}
                {can('attendance:check-out') && !record.checkOutAt && record.status === 'VALID' && (
                  <Button size="sm" variant="secondary" onClick={() => setLeaving(record)}>
                    Check out
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setOpened(record)}>
                  Details
                </Button>
              </li>
            ))}
          </ul>
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            noun="check-ins"
            onPageChange={setPage}
          />
        </>
      )}
      <AttendanceDialog
        record={opened}
        canCorrect={can('attendance:correct')}
        onOpenChange={(open) => !open && setOpened(null)}
      />
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={`Check out ${member.firstName}?`}
        description="Records the time they left. It does not affect their membership or next entry."
        confirmLabel="Check out"
        loading={checkOut.isPending}
        onConfirm={() =>
          leaving &&
          checkOut.mutate(leaving.id, {
            onSuccess: () => toast.success(`${member.firstName} checked out`),
            onError: (error) => toast.error(errorMessage(error)),
            onSettled: () => setLeaving(null),
          })
        }
      />
      {canManual && (
        <ManualCheckInDialog open={manualOpen} onOpenChange={setManualOpen} member={member} />
      )}
    </Card>
  );
}

function EntryAttempts({ memberId }: { memberId: string }) {
  const [page, setPage] = useState(1);
  const attempts = useMemberAccessAttempts(memberId, { page, pageSize: PAGE_SIZE });
  return (
    <Card>
      <CardHeader title="Entry attempts" description="Every scan or check-in, granted or denied" />
      {attempts.isPending ? (
        <ListSkeleton rows={4} label="Loading entry attempts" />
      ) : attempts.isError ? (
        <ErrorState error={attempts.error} onRetry={() => attempts.refetch()} />
      ) : attempts.data.data.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck aria-hidden />}
          title="No entry attempts yet"
          description="Denied attempts are listed here too, with the reason."
        />
      ) : (
        <>
          <ul className={cn('divide-y divide-border', attempts.isPlaceholderData && 'opacity-60')}>
            {attempts.data.data.map((attempt) => (
              <li
                key={attempt.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5"
              >
                <span className="min-w-0 flex-1 text-13">
                  <span className="block text-fg tabular-nums">
                    {formatDateTime(attempt.occurredAt)}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {attempt.device?.name ?? 'Front desk'}
                    {attempt.verifiedByName && ` · by ${attempt.verifiedByName}`}
                    {attempt.duplicate && ' · repeat scan'}
                  </span>
                </span>
                <DecisionBadge reason={attempt.reason} />
                <SourceBadge source={attempt.source} />
              </li>
            ))}
          </ul>
          <Pagination
            page={attempts.data.page}
            pageSize={attempts.data.pageSize}
            total={attempts.data.total}
            noun="attempts"
            onPageChange={setPage}
          />
        </>
      )}
    </Card>
  );
}

export function MemberAttendanceTab({ member }: { member: MemberDto }) {
  return (
    <div className="flex flex-col gap-6">
      <CheckIns member={member} />
      <EntryAttempts memberId={member.id} />
    </div>
  );
}
