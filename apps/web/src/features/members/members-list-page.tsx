import {
  MEMBER_ACCOUNT_STATUS_LABELS,
  MEMBER_ACCOUNT_STATUSES,
  MEMBERSHIP_STATUS_LABELS,
  MEMBERSHIP_STATUSES,
  type MEMBER_SORT_FIELDS,
  type MemberAccountStatus,
  type MemberListQuery,
  type MemberSummaryDto,
} from '@gms/shared';
import { ChevronRight, Contact, UserPlus } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDate, formatPhone } from '../../lib/format';
import { MembershipStatusBadge } from '../memberships/membership-status-badge';
import { CreateMemberDialog } from './create-member-dialog';
import { MemberAvatar } from './member-avatar';
import { MemberStatusBadges } from './member-status';
import { useMemberList } from './members-api';

const PAGE_SIZE = 20;
const DEFAULT_SORT = 'createdAt:desc';
type SortField = (typeof MEMBER_SORT_FIELDS)[number];

const SORT_OPTIONS: { value: `${SortField}:${'asc' | 'desc'}`; label: string }[] = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'memberCode:asc', label: 'Member code' },
  { value: 'registrationDate:desc', label: 'Registration date' },
];

const VIEWS = [
  { value: 'current', label: 'Current members' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'Current and archived' },
] as const;

const isStatus = (value: string | null): value is MemberAccountStatus =>
  MEMBER_ACCOUNT_STATUSES.includes(value as MemberAccountStatus);

const MEMBERSHIP_FILTERS = [...MEMBERSHIP_STATUSES, 'NONE'] as const;
type MembershipFilter = (typeof MEMBERSHIP_FILTERS)[number];
const isMembershipFilter = (value: string | null): value is MembershipFilter =>
  MEMBERSHIP_FILTERS.includes(value as MembershipFilter);

/** Filters live in the URL so the list can be bookmarked and survives a refresh. */
function useMemberFilters() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status');
  const view = VIEWS.find((option) => option.value === params.get('view'))?.value ?? 'current';
  const access = params.get('access');
  const membership = params.get('membership');
  const sortParam = params.get('sort') ?? DEFAULT_SORT;
  const sort = SORT_OPTIONS.some((option) => option.value === sortParam) ? sortParam : DEFAULT_SORT;
  const [sortField, order] = sort.split(':') as [SortField, 'asc' | 'desc'];

  const query: MemberListQuery = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    q: params.get('q') || undefined,
    view,
    accountStatus: isStatus(status) ? status : undefined,
    accessBlocked: access === 'blocked' ? 'true' : undefined,
    membershipStatus: isMembershipFilter(membership) ? membership : undefined,
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

  return { query, sort, update, creating: params.get('new') === '1' };
}

function MemberRow({ member }: { member: MemberSummaryDto }) {
  return (
    <li>
      <Link
        to={`/members/${member.id}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_16px]"
      >
        <span className={cn('flex min-w-0 items-center gap-3', member.archivedAt && 'opacity-70')}>
          <MemberAvatar member={member} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-fg">{fullName(member)}</span>
            <span className="block truncate font-mono text-xs text-fg-muted">
              {member.memberCode}
            </span>
          </span>
        </span>
        <span className="justify-self-end text-13 text-fg-secondary tabular-nums lg:justify-self-start">
          {formatPhone(member.phone)}
        </span>
        <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-13 text-fg-muted lg:contents">
          {member.currentMembership ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-fg-secondary">
                {member.currentMembership.planName}
              </span>
              <MembershipStatusBadge status={member.currentMembership.effectiveStatus} />
            </span>
          ) : (
            <span>No membership</span>
          )}
          <MemberStatusBadges member={member} />
          <span className="tabular-nums lg:text-fg-secondary">
            <span className="lg:hidden">Registered </span>
            {formatDate(member.registrationDate)}
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

export function MembersListPage() {
  const can = useCan();
  const canCreate = can('members:create');
  const { query, sort, update, creating } = useMemberFilters();
  const list = useMemberList(query);
  const filtered = Boolean(
    query.q ||
    query.accountStatus ||
    query.accessBlocked ||
    query.membershipStatus ||
    query.view !== 'current',
  );

  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const openCreate = (open: boolean) => update({ new: open ? '1' : null }, false);

  return (
    <>
      <PageHeader
        title="Members"
        description="Everyone registered at the gym. Archived members keep their full history."
        actions={
          canCreate && (
            <Button icon={<UserPlus aria-hidden />} onClick={() => openCreate(true)}>
              Register member
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5 lg:flex-row lg:items-center">
          <div className="lg:max-w-xs lg:flex-1">
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search members"
              placeholder="Name, code, phone or email"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:ml-auto lg:flex">
            <Select
              aria-label="Show"
              value={query.view}
              onChange={(event) =>
                update({ view: event.target.value === 'current' ? null : event.target.value })
              }
              className="lg:w-48"
            >
              {VIEWS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by membership"
              value={query.membershipStatus ?? ''}
              onChange={(event) => update({ membership: event.target.value })}
              className="lg:w-40"
            >
              <option value="">Any membership</option>
              {MEMBERSHIP_STATUSES.map((status) => (
                <option key={status} value={status}>
                  Membership {MEMBERSHIP_STATUS_LABELS[status].toLowerCase()}
                </option>
              ))}
              <option value="NONE">No membership</option>
            </Select>
            <Select
              aria-label="Filter by account status"
              value={query.accountStatus ?? ''}
              onChange={(event) => update({ status: event.target.value })}
              className="lg:w-36"
            >
              <option value="">Any account</option>
              {MEMBER_ACCOUNT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {MEMBER_ACCOUNT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by entry"
              value={query.accessBlocked ? 'blocked' : ''}
              onChange={(event) => update({ access: event.target.value })}
              className="lg:w-36"
            >
              <option value="">Any entry</option>
              <option value="blocked">Entry blocked</option>
            </Select>
            <Select
              aria-label="Sort by"
              value={sort}
              onChange={(event) =>
                update({ sort: event.target.value === DEFAULT_SORT ? null : event.target.value })
              }
              className="lg:w-44"
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
          className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_16px] gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid"
        >
          <span>Member</span>
          <span>Phone</span>
          <span>Membership</span>
          <span>Account</span>
          <span>Registered</span>
          <span />
        </div>

        {list.isPending ? (
          <ListSkeleton rows={8} label="Loading members" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Contact aria-hidden />}
              title="No members match these filters"
              description="Try another name, code or phone number, or clear the filters."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    update({ q: null, status: null, access: null, membership: null, view: null })
                  }
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Contact aria-hidden />}
              title="No members yet"
              description="Register your first member to give them a member code and start tracking their visits."
              action={
                canCreate && (
                  <Button
                    size="sm"
                    icon={<UserPlus aria-hidden />}
                    onClick={() => openCreate(true)}
                  >
                    Register member
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ul
              aria-label="Members"
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
              aria-busy={list.isPlaceholderData}
            >
              {list.data.data.map((member) => (
                <MemberRow key={member.id} member={member} />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="members"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>

      {canCreate && <CreateMemberDialog open={creating} onOpenChange={openCreate} />}
    </>
  );
}
