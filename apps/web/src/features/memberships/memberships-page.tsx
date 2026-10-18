import {
  MEMBERSHIP_LIMITS,
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUSES,
  type MEMBERSHIP_SORT_FIELDS,
  type MembershipDto,
  type MembershipListQuery,
  type MembershipStatus,
} from '@gms/shared';
import { ChevronRight, Ticket } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { gymTodayIso } from '../../lib/format';
import { MemberAvatar } from '../members/member-avatar';
import { membershipPeriod, membershipTiming } from './membership-format';
import { MembershipStatusBadge } from './membership-status-badge';
import { useMembershipList } from './memberships-api';

const PAGE_SIZE = 20;
type SortField = (typeof MEMBERSHIP_SORT_FIELDS)[number];
const DEFAULT_SORT = 'endDate:asc';

const SORT_OPTIONS: { value: `${SortField}:${'asc' | 'desc'}`; label: string }[] = [
  { value: 'endDate:asc', label: 'Ending soonest' },
  { value: 'endDate:desc', label: 'Ending latest' },
  { value: 'startDate:desc', label: 'Newest start' },
  { value: 'createdAt:desc', label: 'Recently assigned' },
  { value: 'memberName:asc', label: 'Member (A–Z)' },
];

/** "Expiring soon" windows; the dashboard links here with the gym's own reminder window. */
const EXPIRING_OPTIONS = [7, 14, 30];

const isStatus = (value: string | null): value is MembershipStatus =>
  MEMBERSHIP_STATUSES.includes(value as MembershipStatus);

function parseExpiring(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const days = Number(value);
  return days <= MEMBERSHIP_LIMITS.maxExpiringWithinDays ? days : undefined;
}

/** Filters live in the URL so the expiring-soon list can be bookmarked and shared. */
function useMembershipFilters() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status');
  const expiring = parseExpiring(params.get('expiring'));
  const sortParam = params.get('sort') ?? DEFAULT_SORT;
  const sort = SORT_OPTIONS.some((option) => option.value === sortParam) ? sortParam : DEFAULT_SORT;
  const [sortField, order] = sort.split(':') as [SortField, 'asc' | 'desc'];

  const query: MembershipListQuery = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    q: params.get('q') || undefined,
    // "Expiring soon" means active, so it replaces the status filter.
    status: expiring === undefined && isStatus(status) ? status : undefined,
    expiringWithinDays: expiring,
    sort: sortField,
    order,
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

  return { query, sort, expiring, update };
}

function MembershipRow({ membership, today }: { membership: MembershipDto; today: string }) {
  const { member } = membership;
  const timing = membershipTiming(membership, today);
  return (
    <li>
      <Link
        to={`/members/${member.id}?tab=membership`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_16px]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <MemberAvatar member={member} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{fullName(member)}</span>
            <span className="block truncate font-mono text-xs text-fg-muted">
              {member.memberCode}
            </span>
          </span>
        </span>
        <span className="justify-self-end lg:hidden">
          <MembershipStatusBadge status={membership.effectiveStatus} />
        </span>
        <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-13 text-fg-muted lg:contents">
          <span className="truncate text-fg-secondary lg:text-fg">{membership.planName}</span>
          <span className="tabular-nums lg:text-fg-secondary">
            {membershipPeriod(membership)}
            {timing && <span className="block text-xs text-fg-muted">{timing}</span>}
          </span>
          <span className="hidden lg:block">
            <MembershipStatusBadge status={membership.effectiveStatus} />
          </span>
        </span>
        <ChevronRight
          className="hidden size-4 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5 lg:block"
          aria-hidden
        />
      </Link>
    </li>
  );
}

export function MembershipsPage() {
  const today = gymTodayIso();
  const { query, sort, expiring, update } = useMembershipFilters();
  const list = useMembershipList(query);
  const filtered = Boolean(query.q || query.status || expiring !== undefined);

  const setSearch = useCallback((q: string) => update({ q }), [update]);

  return (
    <>
      <PageHeader
        title={expiring === undefined ? 'Memberships' : 'Expiring soon'}
        description={
          expiring === undefined
            ? 'Every membership period across the gym. Open one to activate, renew or change it on the member’s page.'
            : `Active memberships ending in the next ${expiring} days with no renewal lined up.`
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5 xl:flex-row xl:items-center">
          <div className="xl:max-w-xs xl:flex-1">
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search memberships"
              placeholder="Member name, code or plan"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:ml-auto xl:flex">
            <Select
              aria-label="Show"
              value={expiring === undefined ? '' : String(expiring)}
              onChange={(event) =>
                update({ expiring: event.target.value, status: null, sort: null })
              }
              className="xl:w-48"
            >
              <option value="">All memberships</option>
              {[...new Set([...EXPIRING_OPTIONS, ...(expiring ? [expiring] : [])])]
                .sort((a, b) => a - b)
                .map((days) => (
                  <option key={days} value={days}>
                    Expiring in {days} days
                  </option>
                ))}
            </Select>
            <Select
              aria-label="Filter by status"
              value={query.status ?? ''}
              disabled={expiring !== undefined}
              onChange={(event) => update({ status: event.target.value })}
              className="xl:w-40"
            >
              <option value="">Any status</option>
              {MEMBERSHIP_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {MEMBERSHIP_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Sort by"
              value={sort}
              onChange={(event) =>
                update({ sort: event.target.value === DEFAULT_SORT ? null : event.target.value })
              }
              className="xl:w-44"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1.8fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_16px] gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid"
        >
          <span>Member</span>
          <span>Plan</span>
          <span>Period</span>
          <span>Status</span>
          <span />
        </div>

        {list.isPending ? (
          <ListSkeleton rows={8} label="Loading memberships" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          expiring !== undefined && !query.q ? (
            <EmptyState
              icon={<Ticket aria-hidden />}
              title={`Nothing expires in the next ${expiring} days`}
              description="Every active membership in this window already has a renewal lined up, or none end this soon."
            />
          ) : filtered ? (
            <EmptyState
              icon={<Ticket aria-hidden />}
              title="No memberships match these filters"
              description="Try another name, code or plan, or clear the filters."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ q: null, status: null, expiring: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Ticket aria-hidden />}
              title="No memberships yet"
              description="Open a member and assign them a plan from their Membership tab."
            />
          )
        ) : (
          <>
            <ul
              aria-label="Memberships"
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
              aria-busy={list.isPlaceholderData}
            >
              {list.data.data.map((membership) => (
                <MembershipRow key={membership.id} membership={membership} today={today} />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="memberships"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>
    </>
  );
}
