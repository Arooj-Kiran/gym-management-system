import {
  ACCESS_REASON_LABELS,
  ACCESS_REASONS,
  ACCESS_SOURCE_LABELS,
  ACCESS_SOURCES,
  type AccessAttemptDto,
  type AccessAttemptListQuery,
  type AccessReason,
  type AccessSource,
} from '@gms/shared';
import { ShieldCheck } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Input, Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDateTime, gymTodayIso } from '../../lib/format';
import { DecisionBadge, SourceBadge } from './access-badges';
import { useAccessAttempts, useAccessDevices } from './access-api';

const PAGE_SIZE = 25;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const oneOf = <T extends string>(values: readonly T[], value: string | null) =>
  values.includes(value as T) ? (value as T) : undefined;
const dateParam = (value: string | null) => (value && ISO_DATE.test(value) ? value : undefined);

/** Filters live in the URL so a filtered view (e.g. today's denials) can be shared. */
function useAttemptFilters() {
  const [params, setParams] = useSearchParams();
  const result = params.get('result');
  const query: AccessAttemptListQuery = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    q: params.get('q') || undefined,
    result: result === 'GRANTED' || result === 'DENIED' ? result : undefined,
    reason: oneOf<AccessReason>(ACCESS_REASONS, params.get('reason')),
    source: oneOf<AccessSource>(ACCESS_SOURCES, params.get('source')),
    deviceId: UUID.test(params.get('device') ?? '') ? params.get('device')! : undefined,
    from: dateParam(params.get('from')),
    to: dateParam(params.get('to')),
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
  return { query, update };
}

function AttemptNotes({ attempt }: { attempt: AccessAttemptDto }) {
  const notes = [
    attempt.duplicate && 'Repeat scan, not counted again',
    attempt.uploadedFromOutbox && 'Uploaded later by the scanner (server was unreachable)',
    attempt.verifiedByName && `Checked in by ${attempt.verifiedByName}`,
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return <span className="block text-xs text-fg-muted">{notes.join(' · ')}</span>;
}

const GRID = 'lg:grid-cols-[150px_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]';

function AttemptRow({ attempt }: { attempt: AccessAttemptDto }) {
  return (
    <li
      className={cn('grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 lg:items-center', GRID)}
    >
      <time dateTime={attempt.occurredAt} className="text-13 text-fg-secondary tabular-nums">
        {formatDateTime(attempt.occurredAt)}
      </time>
      <span className="min-w-0">
        {attempt.member ? (
          <>
            <Link
              to={`/members/${attempt.member.id}?tab=attendance`}
              className="block truncate text-sm font-medium text-fg hover:underline"
            >
              {fullName(attempt.member)}
            </Link>
            <span className="block font-mono text-xs text-fg-muted">
              {attempt.member.memberCode}
            </span>
          </>
        ) : (
          <span className="text-sm text-fg-muted">Not identified</span>
        )}
      </span>
      <span className="min-w-0">
        <DecisionBadge reason={attempt.reason} />
        <AttemptNotes attempt={attempt} />
      </span>
      <span>
        <SourceBadge source={attempt.source} />
      </span>
      <span className="truncate text-13 text-fg-secondary">
        {attempt.device?.name ?? 'Front desk (manual)'}
      </span>
    </li>
  );
}

export function AccessLogPage() {
  const { query, update } = useAttemptFilters();
  const attempts = useAccessAttempts(query);
  const devices = useAccessDevices();
  const today = gymTodayIso();
  const filtered = Boolean(
    query.q ||
    query.result ||
    query.reason ||
    query.source ||
    query.deviceId ||
    query.from ||
    query.to,
  );
  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const rangeInvalid = Boolean(query.from && query.to && query.from > query.to);

  return (
    <>
      <PageHeader
        title="Access log"
        description="Every entry attempt, granted or denied, with the reason. Records cannot be edited or deleted."
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search attempts"
              placeholder="Member name or code"
            />
            <Select
              aria-label="Filter by result"
              value={query.reason ? `reason:${query.reason}` : (query.result ?? '')}
              onChange={(event) => {
                const value = event.target.value;
                if (value.startsWith('reason:')) update({ reason: value.slice(7), result: null });
                else update({ result: value, reason: null });
              }}
            >
              <option value="">Any result</option>
              <option value="GRANTED">Granted</option>
              <option value="DENIED">All denials</option>
              <optgroup label="Denied because">
                {ACCESS_REASONS.filter((reason) => reason !== 'GRANTED').map((reason) => (
                  <option key={reason} value={`reason:${reason}`}>
                    {ACCESS_REASON_LABELS[reason]}
                  </option>
                ))}
              </optgroup>
            </Select>
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
              aria-label="Filter by scanner"
              value={query.deviceId ?? ''}
              onChange={(event) => update({ device: event.target.value })}
            >
              <option value="">Any scanner</option>
              {(devices.data ?? []).map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-1">
              <Input
                type="date"
                aria-label="From date"
                value={query.from ?? ''}
                max={today}
                onChange={(event) => update({ from: event.target.value })}
              />
              <Input
                type="date"
                aria-label="To date"
                value={query.to ?? ''}
                max={today}
                onChange={(event) => update({ to: event.target.value })}
              />
            </div>
          </div>
          {rangeInvalid && (
            <p role="alert" className="text-13 text-danger-text">
              The “from” date must be on or before the “to” date.
            </p>
          )}
        </div>

        <div
          aria-hidden
          className={cn(
            'hidden gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid',
            GRID,
          )}
        >
          <span>Time</span>
          <span>Member</span>
          <span>Decision</span>
          <span>Source</span>
          <span>Scanner</span>
        </div>

        {attempts.isPending ? (
          <ListSkeleton rows={8} label="Loading access attempts" />
        ) : attempts.isError ? (
          <ErrorState error={attempts.error} onRetry={() => attempts.refetch()} />
        ) : attempts.data.data.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck aria-hidden />}
            title={filtered ? 'No attempts match these filters' : 'No entry attempts yet'}
            description={
              filtered
                ? 'Try a wider date range or clear the filters.'
                : 'Scans and manual check-ins appear here as they happen.'
            }
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    update({
                      q: null,
                      result: null,
                      reason: null,
                      source: null,
                      device: null,
                      from: null,
                      to: null,
                    })
                  }
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul
              aria-label="Access attempts"
              aria-busy={attempts.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                attempts.isPlaceholderData && 'opacity-60',
              )}
            >
              {attempts.data.data.map((attempt) => (
                <AttemptRow key={attempt.id} attempt={attempt} />
              ))}
            </ul>
            <Pagination
              page={attempts.data.page}
              pageSize={attempts.data.pageSize}
              total={attempts.data.total}
              noun="attempts"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>
    </>
  );
}
