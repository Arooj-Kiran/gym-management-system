import {
  ACCESS_SOURCE_LABELS,
  ACCESS_SOURCES,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUSES,
  type AccessSource,
  type AttendanceDto,
  type AttendanceListQuery,
  type AttendanceStatus,
} from '@gms/shared';
import { CalendarCheck, LogOut, UserCheck } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Input, Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan } from '../../lib/auth';
import { cn } from '../../lib/cn';
import {
  formatDate,
  formatDuration,
  formatTime,
  gymTodayIso,
  toGymDateTimeInput,
} from '../../lib/format';
import { SourceBadge } from '../access/access-badges';
import { MemberAvatar } from '../members/member-avatar';
import { useAttendanceList, useCheckOut } from './attendance-api';
import { AttendanceDialog } from './attendance-dialog';
import { ManualCheckInDialog } from './manual-check-in-dialog';

const PAGE_SIZE = 25;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateParam = (value: string | null) => (value && ISO_DATE.test(value) ? value : undefined);
const oneOf = <T extends string>(values: readonly T[], value: string | null) =>
  values.includes(value as T) ? (value as T) : undefined;

/** One day (default today, gym time) or an inclusive range; kept in the URL. */
function useAttendanceFilters() {
  const [params, setParams] = useSearchParams();
  const today = gymTodayIso();
  const from = dateParam(params.get('from')) ?? today;
  const to = dateParam(params.get('to')) ?? from;
  const query: AttendanceListQuery = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    q: params.get('q') || undefined,
    source: oneOf<AccessSource>(ACCESS_SOURCES, params.get('source')),
    status: oneOf<AttendanceStatus>(ATTENDANCE_STATUSES, params.get('status')),
    ...(from === to ? { date: from } : { from, to }),
  };
  const update = useCallback(
    (changes: Record<string, string | null>, resetPage = true) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { query, from, to, today, update };
}

const GRID = 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_auto]';

function AttendanceRow({
  record,
  showDate,
  canCheckOut,
  onCheckOut,
  onOpen,
}: {
  record: AttendanceDto;
  showDate: boolean;
  canCheckOut: boolean;
  onCheckOut: () => void;
  onOpen: () => void;
}) {
  const voided = record.status === 'VOIDED';
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5',
        GRID,
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <MemberAvatar member={record.member} />
        <span className="min-w-0">
          <Link
            to={`/members/${record.member.id}?tab=attendance`}
            className={cn(
              'block truncate text-sm font-medium text-fg hover:underline',
              voided && 'text-fg-muted line-through',
            )}
          >
            {fullName(record.member)}
          </Link>
          <span className="block truncate text-xs text-fg-muted">
            <span className="font-mono">{record.member.memberCode}</span> · {record.planName}
          </span>
        </span>
      </span>
      <span className="justify-self-end text-right text-13 tabular-nums lg:justify-self-start lg:text-left">
        {showDate && (
          <span className="block text-xs text-fg-muted">
            {formatDate(toGymDateTimeInput(record.checkInAt).slice(0, 10))}
          </span>
        )}
        <span className="text-fg">{formatTime(record.checkInAt)}</span>
        <span className="text-fg-muted">
          {' '}
          → {record.checkOutAt ? formatTime(record.checkOutAt) : 'in'}
        </span>
        {record.checkOutAt && (
          <span className="block text-xs text-fg-muted">
            {formatDuration(record.checkInAt, record.checkOutAt)}
          </span>
        )}
      </span>
      <span className="col-span-2 flex flex-wrap items-center gap-1.5 pl-11 lg:col-span-1 lg:pl-0">
        <SourceBadge source={record.source} />
        {voided && <Badge tone="danger">{ATTENDANCE_STATUS_LABELS.VOIDED}</Badge>}
        {record.correctionCount > 0 && (
          <Badge>
            {record.correctionCount} correction{record.correctionCount === 1 ? '' : 's'}
          </Badge>
        )}
      </span>
      <span className="col-span-2 pl-11 text-13 lg:col-span-1 lg:pl-0">
        {record.checkOutAt ? (
          <span className="text-fg-muted">Checked out</span>
        ) : voided ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <Badge tone="success" dot>
            In the gym
          </Badge>
        )}
      </span>
      <span className="col-span-2 flex gap-2 pl-11 lg:col-span-1 lg:justify-end lg:pl-0">
        {canCheckOut && !record.checkOutAt && !voided && (
          <Button size="sm" variant="secondary" icon={<LogOut aria-hidden />} onClick={onCheckOut}>
            Check out
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Details
        </Button>
      </span>
    </li>
  );
}

export function AttendancePage() {
  const can = useCan();
  const { query, from, to, today, update } = useAttendanceFilters();
  const list = useAttendanceList(query);
  const checkOut = useCheckOut();
  const [opened, setOpened] = useState<AttendanceDto | null>(null);
  const [leaving, setLeaving] = useState<AttendanceDto | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const singleDay = from === to;
  const filtered = Boolean(query.q || query.source || query.status);

  const confirmCheckOut = () =>
    leaving &&
    checkOut.mutate(leaving.id, {
      onSuccess: () => {
        toast.success(`${fullName(leaving.member)} checked out`);
        setLeaving(null);
      },
      onError: (error) => {
        toast.error(errorMessage(error));
        setLeaving(null);
      },
    });

  return (
    <>
      <PageHeader
        title="Attendance"
        description={
          singleDay
            ? from === today
              ? 'Everyone who checked in today, by scanner or at the desk.'
              : `Check-ins on ${formatDate(from)}.`
            : `Check-ins from ${formatDate(from)} to ${formatDate(to)}.`
        }
        actions={
          can('attendance:manual-check-in') && (
            <Button icon={<UserCheck aria-hidden />} onClick={() => setManualOpen(true)}>
              Manual check-in
            </Button>
          )
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,0.8fr))_minmax(0,1.3fr)]">
          <SearchInput
            value={query.q ?? ''}
            onChange={setSearch}
            label="Search attendance"
            placeholder="Member name or code"
          />
          <Select
            aria-label="Filter by source"
            value={query.source ?? ''}
            onChange={(event) => update({ source: event.target.value })}
          >
            <option value="">Any source</option>
            {ACCESS_SOURCES.map((source) => (
              <option key={source} value={source}>
                {ACCESS_SOURCE_LABELS[source]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by status"
            value={query.status ?? ''}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">Valid and voided</option>
            {ATTENDANCE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ATTENDANCE_STATUS_LABELS[status]} only
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="date"
              aria-label="From date"
              value={from}
              max={today}
              onChange={(event) => {
                const value = event.target.value || today;
                update({ from: value, to: value > to ? value : to });
              }}
            />
            <Input
              type="date"
              aria-label="To date"
              value={to}
              min={from}
              max={today}
              onChange={(event) => update({ to: event.target.value || from })}
            />
          </div>
        </div>

        <div
          aria-hidden
          className={cn(
            'hidden gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid',
            GRID,
          )}
        >
          <span>Member</span>
          <span>In → out</span>
          <span>Source</span>
          <span>Now</span>
          <span className="sr-only">Actions</span>
        </div>

        {list.isPending ? (
          <ListSkeleton rows={8} label="Loading attendance" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck aria-hidden />}
            title={filtered ? 'No check-ins match these filters' : 'No check-ins for this period'}
            description={
              filtered
                ? 'Try another name or code, or clear the filters.'
                : 'Granted scans and manual check-ins appear here as they happen.'
            }
            action={
              filtered || from !== today ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    update({ q: null, source: null, status: null, from: null, to: null })
                  }
                >
                  Show today, all check-ins
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul
              aria-label="Check-ins"
              aria-busy={list.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              {list.data.data.map((record) => (
                <AttendanceRow
                  key={record.id}
                  record={record}
                  showDate={!singleDay}
                  canCheckOut={can('attendance:check-out')}
                  onCheckOut={() => setLeaving(record)}
                  onOpen={() => setOpened(record)}
                />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="check-ins"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>

      <AttendanceDialog
        record={opened}
        canCorrect={can('attendance:correct')}
        onOpenChange={(open) => !open && setOpened(null)}
      />
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={leaving ? `Check out ${fullName(leaving.member)}?` : 'Check out'}
        description="Records the time they left. It does not affect their membership or next entry."
        confirmLabel="Check out"
        loading={checkOut.isPending}
        onConfirm={confirmCheckOut}
      />
      {can('attendance:manual-check-in') && (
        <ManualCheckInDialog open={manualOpen} onOpenChange={setManualOpen} />
      )}
    </>
  );
}
