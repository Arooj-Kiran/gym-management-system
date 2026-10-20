import type { AccessSource } from '@gms/shared';
import { CalendarCheck } from 'lucide-react';
import { useState } from 'react';
import { Card, CardHeader } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { cn } from '../../lib/cn';
import { formatDate, formatDuration, formatTime, toGymDateTimeInput } from '../../lib/format';
import { useMyAttendance } from './portal-api';

/** Plain words for members; staff screens use the full source labels. */
const HOW: Record<AccessSource, string> = {
  REAL: 'Fingerprint',
  SIMULATED: 'Test scanner',
  MANUAL: 'At the front desk',
};

const PAGE_SIZE = 20;

export function PortalAttendancePage() {
  const [page, setPage] = useState(1);
  const list = useMyAttendance(page, PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Your visits to the gym, newest first. Times are in gym time."
      />
      <Card>
        <CardHeader title="Check-ins" />
        {list.isPending ? (
          <ListSkeleton rows={6} label="Loading your check-ins" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          <EmptyState
            icon={<CalendarCheck aria-hidden />}
            title="No visits yet"
            description="Each time you check in at the entrance, the visit shows up here."
          />
        ) : (
          <>
            <ul
              aria-label="My check-ins"
              aria-busy={list.isPlaceholderData}
              className={cn('divide-y divide-border', list.isPlaceholderData && 'opacity-60')}
            >
              {list.data.data.map((visit) => (
                <li
                  key={visit.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-fg">
                      {formatDate(toGymDateTimeInput(visit.checkInAt).slice(0, 10))}
                    </span>
                    <span className="block text-13 text-fg-muted">{HOW[visit.source]}</span>
                  </span>
                  <span className="text-right text-13 tabular-nums">
                    <span className="block text-fg">
                      {formatTime(visit.checkInAt)}
                      <span className="text-fg-muted">
                        {' '}
                        → {visit.checkOutAt ? formatTime(visit.checkOutAt) : '—'}
                      </span>
                    </span>
                    {visit.checkOutAt && (
                      <span className="block text-xs text-fg-muted">
                        {formatDuration(visit.checkInAt, visit.checkOutAt)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="visits"
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
