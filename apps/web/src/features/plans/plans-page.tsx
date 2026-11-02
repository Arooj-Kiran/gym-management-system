import {
  PLAN_TYPE_LABELS,
  PLAN_TYPES,
  type PlanDto,
  type PlanListQuery,
  type PlanType,
} from '@gms/shared';
import { Archive, ArchiveRestore, Check, Pencil, Plus, Tags } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/format';
import { planDays, planDuration, planHours } from './plan-format';
import { PlanFormDialog } from './plan-form-dialog';
import { useArchivePlan, usePlanList } from './plans-api';

const PAGE_SIZE = 20;
const STATUSES = [
  { value: 'active', label: 'Active plans' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'Active and archived' },
] as const;

const isPlanType = (value: string | null): value is PlanType =>
  PLAN_TYPES.includes(value as PlanType);

function usePlanFilters() {
  const [params, setParams] = useSearchParams();
  const type = params.get('type');
  const status =
    STATUSES.find((option) => option.value === params.get('status'))?.value ?? 'active';
  const query: PlanListQuery = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    q: params.get('q') || undefined,
    status,
    planType: isPlanType(type) ? type : undefined,
    sort: 'price',
    order: 'asc',
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
  return { query, update, creating: params.get('new') === '1' };
}

function PlanRow({
  plan,
  currency,
  canManage,
  onEdit,
  onArchive,
}: {
  plan: PlanDto;
  currency: string;
  canManage: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] lg:items-center',
        !plan.isActive && 'bg-surface-muted/40',
      )}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
          <span className="truncate">{plan.name}</span>
          <Badge tone={plan.planType === 'CUSTOM' ? 'warning' : 'neutral'}>
            {PLAN_TYPE_LABELS[plan.planType]}
          </Badge>
          {!plan.isActive && <Badge tone="danger">Archived</Badge>}
        </p>
        {plan.description && (
          <p className="mt-0.5 line-clamp-2 text-13 text-fg-muted">{plan.description}</p>
        )}
        {plan.benefits.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-13 text-fg-secondary">
            {plan.benefits.map((benefit) => (
              <li key={benefit} className="inline-flex items-center gap-1">
                <Check className="size-3.5 text-success" aria-hidden />
                {benefit}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="justify-self-end text-right text-sm font-semibold text-fg tabular-nums lg:order-4 lg:justify-self-end">
        {formatMoney(plan.priceMinor, currency)}
        {plan.allowPartialPayment && (
          <span className="block text-xs font-normal text-fg-muted">Partial payment allowed</span>
        )}
      </p>
      <p className="col-span-2 text-13 text-fg-secondary lg:order-2 lg:col-span-1">
        <span className="text-fg-muted lg:hidden">Runs </span>
        {planDuration(plan)}
      </p>
      <p className="col-span-2 text-13 text-fg-secondary lg:order-3 lg:col-span-1">
        {planDays(plan.accessDays)}
        <span className="block text-fg-muted">{planHours(plan)}</span>
      </p>
      {canManage ? (
        <div className="col-span-2 flex gap-2 lg:order-5 lg:col-span-1 lg:w-44 lg:justify-end">
          <Button variant="secondary" size="sm" icon={<Pencil aria-hidden />} onClick={onEdit}>
            Edit<span className="sr-only"> {plan.name}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={plan.isActive ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />}
            onClick={onArchive}
          >
            {plan.isActive ? 'Archive' : 'Restore'}
            <span className="sr-only"> {plan.name}</span>
          </Button>
        </div>
      ) : (
        <span className="hidden lg:order-5 lg:block" />
      )}
    </li>
  );
}

export function PlansPage() {
  const { gym } = useSession();
  const can = useCan();
  const canManage = can('plans:manage');
  const { query, update, creating } = usePlanFilters();
  const list = usePlanList(query);
  const archive = useArchivePlan();
  const [editing, setEditing] = useState<PlanDto | null>(null);
  const [archiving, setArchiving] = useState<PlanDto | null>(null);
  const filtered = Boolean(query.q || query.planType || query.status !== 'active');

  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const openCreate = (open: boolean) => update({ new: open ? '1' : null }, false);

  const toggleArchive = (reason: string | undefined) => {
    if (!archiving) return;
    const archiveIt = archiving.isActive;
    archive.mutate(
      { id: archiving.id, archive: archiveIt, reason },
      {
        onSuccess: (plan) => {
          toast.success(archiveIt ? `${plan.name} archived` : `${plan.name} restored`);
          setArchiving(null);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <>
      <PageHeader
        title="Membership plans"
        description={
          canManage
            ? 'What the gym sells. Archived plans stay on existing memberships but cannot be sold.'
            : 'What the gym sells. Only an Admin can change plans.'
        }
        actions={
          canManage && (
            <Button icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
              New plan
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
              label="Search plans"
              placeholder="Search plan name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 md:ml-auto md:flex">
            <Select
              aria-label="Filter by plan type"
              value={query.planType ?? ''}
              onChange={(event) => update({ type: event.target.value })}
              className="md:w-40"
            >
              <option value="">All types</option>
              {PLAN_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PLAN_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Show"
              value={query.status}
              onChange={(event) =>
                update({ status: event.target.value === 'active' ? null : event.target.value })
              }
              className="md:w-48"
            >
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_auto] gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid"
        >
          <span>Plan</span>
          <span>Duration</span>
          <span>Access</span>
          <span className="text-right">Price</span>
          {/* As wide as the row buttons ("Edit" and "Archive"), so the columns line up. */}
          <span className={canManage ? 'w-44' : undefined} />
        </div>

        {list.isPending ? (
          <ListSkeleton rows={5} label="Loading plans" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Tags aria-hidden />}
              title="No plans match these filters"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ q: null, type: null, status: null })}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Tags aria-hidden />}
              title="No membership plans yet"
              description={
                canManage
                  ? 'Create the plans you sell, such as Monthly or Annual, with their price and access hours.'
                  : 'An Admin has not set up any plans yet.'
              }
              action={
                canManage && (
                  <Button size="sm" icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
                    New plan
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ul
              aria-label="Membership plans"
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
              aria-busy={list.isPlaceholderData}
            >
              {list.data.data.map((plan) => (
                <PlanRow
                  key={plan.id}
                  plan={plan}
                  currency={gym.currencyCode}
                  canManage={canManage}
                  onEdit={() => setEditing(plan)}
                  onArchive={() => setArchiving(plan)}
                />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="plans"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>

      {canManage && (
        <>
          <PlanFormDialog open={creating} onOpenChange={openCreate} />
          {editing && (
            <PlanFormDialog
              key={editing.id}
              plan={editing}
              open
              onOpenChange={(open) => !open && setEditing(null)}
            />
          )}
          <ConfirmDialog
            open={archiving !== null}
            onOpenChange={(open) => !open && setArchiving(null)}
            title={
              archiving?.isActive ? `Archive ${archiving.name}?` : `Restore ${archiving?.name}?`
            }
            description={
              archiving?.isActive
                ? 'It can no longer be sold and disappears from the member portal. Nothing already sold changes.'
                : 'It can be sold again and members see it in the portal.'
            }
            confirmLabel={archiving?.isActive ? 'Archive plan' : 'Restore plan'}
            tone={archiving?.isActive ? 'danger' : 'primary'}
            reason="optional"
            loading={archive.isPending}
            onConfirm={toggleArchive}
          />
        </>
      )}
    </>
  );
}
