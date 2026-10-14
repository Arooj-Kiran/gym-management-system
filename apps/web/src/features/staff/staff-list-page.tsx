import {
  ROLE_LABELS,
  STAFF_ROLES,
  type STAFF_SORT_FIELDS,
  type StaffDto,
  type StaffListQuery,
  type StaffRole,
} from '@gms/shared';
import { ChevronRight, Lock, UserPlus, UsersRound } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Avatar } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatRelative } from '../../lib/format';
import { CreateStaffDialog } from './create-staff-dialog';
import { ROLE_TONES } from './role-meta';
import { useStaffList } from './staff-api';

const PAGE_SIZE = 20;
type SortField = (typeof STAFF_SORT_FIELDS)[number];

const SORT_OPTIONS: { value: `${SortField}:${'asc' | 'desc'}`; label: string }[] = [
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'role:asc', label: 'Role' },
  { value: 'lastLoginAt:desc', label: 'Last sign-in' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
];

const isRole = (value: string | null): value is StaffRole =>
  STAFF_ROLES.includes(value as StaffRole);

/** Filters live in the URL so the list can be bookmarked and survives a refresh. */
function useStaffFilters() {
  const [params, setParams] = useSearchParams();
  const role = params.get('role');
  const status = params.get('status');
  const sortParam = params.get('sort') ?? 'name:asc';
  const sort = SORT_OPTIONS.some((option) => option.value === sortParam) ? sortParam : 'name:asc';
  const [sortField, order] = sort.split(':') as [SortField, 'asc' | 'desc'];

  const query: StaffListQuery = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    q: params.get('q') || undefined,
    role: isRole(role) ? role : undefined,
    status: status === 'active' || status === 'inactive' ? status : undefined,
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

function StatusBadge({ staff }: { staff: StaffDto }) {
  if (!staff.isActive)
    return (
      <Badge tone="danger" dot>
        Deactivated
      </Badge>
    );
  if (staff.isLocked)
    return (
      <Badge tone="warning">
        <Lock className="size-3" aria-hidden /> Locked
      </Badge>
    );
  return (
    <Badge tone="success" dot>
      Active
    </Badge>
  );
}

function StaffRow({ staff, isSelf }: { staff: StaffDto; isSelf: boolean }) {
  return (
    <li className="relative">
      <Link
        to={`/staff/${staff.id}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_16px]"
      >
        <span className={cn('flex min-w-0 items-center gap-3', !staff.isActive && 'opacity-70')}>
          <Avatar user={staff} />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-medium text-fg">
              <span className="truncate">{fullName(staff)}</span>
              {isSelf && <span className="text-13 font-normal text-fg-muted">(you)</span>}
            </span>
            <span className="block truncate text-13 text-fg-muted">{staff.email}</span>
          </span>
        </span>
        <span className="justify-self-end lg:justify-self-start">
          <Badge tone={ROLE_TONES[staff.role]}>{ROLE_LABELS[staff.role]}</Badge>
        </span>
        <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-11 text-13 text-fg-muted lg:contents">
          <span className="lg:pl-0">
            <StatusBadge staff={staff} />
          </span>
          <span className="tabular-nums lg:text-fg-secondary">
            <span className="lg:hidden">Last sign-in </span>
            {staff.lastLoginAt ? formatRelative(staff.lastLoginAt) : 'Never signed in'}
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

export function StaffListPage() {
  const session = useSession();
  const can = useCan();
  const canManage = can('staff:manage');
  const { query, sort, update, creating } = useStaffFilters();
  const list = useStaffList(query);
  const filtered = Boolean(query.q || query.role || query.status);

  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const openCreate = (open: boolean) => update({ new: open ? '1' : null }, false);

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone who signs in to the dashboard. Deactivated accounts keep their history."
        actions={
          canManage && (
            <Button icon={<UserPlus aria-hidden />} onClick={() => openCreate(true)}>
              Add staff
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5 md:flex-row md:items-center">
          <div className="md:max-w-xs md:flex-1">
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search staff"
              placeholder="Search name or email"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:ml-auto md:flex md:w-auto">
            <Select
              aria-label="Filter by role"
              value={query.role ?? ''}
              onChange={(event) => update({ role: event.target.value })}
              className="md:w-40"
            >
              <option value="">All roles</option>
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              value={query.status ?? ''}
              onChange={(event) => update({ status: event.target.value })}
              className="md:w-40"
            >
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </Select>
            <Select
              aria-label="Sort by"
              value={sort}
              onChange={(event) =>
                update({ sort: event.target.value === 'name:asc' ? null : event.target.value })
              }
              className="col-span-2 md:w-44"
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
          className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_16px] gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid"
        >
          <span>Name</span>
          <span>Role</span>
          <span>Status</span>
          <span>Last sign-in</span>
          <span />
        </div>

        {list.isPending ? (
          <ListSkeleton rows={6} label="Loading staff" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<UsersRound aria-hidden />}
              title="No staff match these filters"
              description="Try a different name, or clear the filters to see everyone."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ q: null, role: null, status: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<UsersRound aria-hidden />}
              title="No staff accounts yet"
              description="Add your managers, front-desk team and trainers so each person signs in with their own account."
              action={
                canManage && (
                  <Button
                    size="sm"
                    icon={<UserPlus aria-hidden />}
                    onClick={() => openCreate(true)}
                  >
                    Add staff
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ul
              aria-label="Staff members"
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
              aria-busy={list.isPlaceholderData}
            >
              {list.data.data.map((staff) => (
                <StaffRow key={staff.id} staff={staff} isSelf={staff.id === session.user.id} />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="staff"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>

      {canManage && <CreateStaffDialog open={creating} onOpenChange={openCreate} />}
    </>
  );
}
