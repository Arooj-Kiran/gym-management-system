import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_CONDITION_LABELS,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_STATUS_LABELS,
  EQUIPMENT_STATUSES,
  type EquipmentDto,
  type EquipmentListQuery,
} from '@gms/shared';
import { ChevronRight, Plus, Wrench } from 'lucide-react';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { useCan } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import { useUrlFilters } from '../billing/use-url-filters';
import { useEquipmentList, useMaintenanceDue } from './equipment-api';
import { EquipmentFormDialog } from './equipment-dialogs';
import { CONDITION_TONES, DUE_SOON_DAYS, maintenanceDue, STATUS_TONES } from './equipment-format';

const PAGE_SIZE = 25;
const DUE_PREVIEW = 4;

function subtitle(item: EquipmentDto) {
  return [
    EQUIPMENT_CATEGORY_LABELS[item.category],
    [item.brand, item.model].filter(Boolean).join(' '),
    item.location,
  ]
    .filter(Boolean)
    .join(' · ');
}

function EquipmentRow({ item }: { item: EquipmentDto }) {
  const due = maintenanceDue(item);
  const retired = item.status === 'RETIRED';
  return (
    <li>
      <Link
        to={`/equipment/${item.id}`}
        className={cn(
          'group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover sm:px-5 md:grid-cols-[6.5rem_minmax(0,1fr)_auto_auto]',
          retired && 'bg-surface-muted/40',
        )}
      >
        <span className="hidden font-mono text-xs text-fg-muted md:block">{item.assetTag}</span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'truncate text-sm font-medium',
                retired ? 'text-fg-secondary' : 'text-fg',
              )}
            >
              {item.name}
            </span>
            {item.status !== 'IN_SERVICE' && (
              <Badge tone={STATUS_TONES[item.status]} dot>
                {EQUIPMENT_STATUS_LABELS[item.status]}
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block truncate text-13 text-fg-muted">
            <span className="font-mono md:hidden">{item.assetTag} · </span>
            {subtitle(item)}
          </span>
        </span>
        <span className="col-start-1 flex flex-wrap items-center gap-2 md:col-start-auto md:justify-end">
          {!retired && (
            <Badge tone={CONDITION_TONES[item.condition]}>
              {EQUIPMENT_CONDITION_LABELS[item.condition]}
            </Badge>
          )}
          {due ? (
            <Badge tone={due.tone}>
              {due.urgent ? due.label : `Service ${formatDate(item.nextMaintenanceDate)}`}
            </Badge>
          ) : (
            !retired && <span className="text-13 text-fg-muted">No service date</span>
          )}
        </span>
        <ChevronRight
          className="col-start-2 row-span-2 row-start-1 size-4 text-fg-muted transition-transform duration-150 group-hover:translate-x-0.5 md:col-start-4 md:row-span-1"
          aria-hidden
        />
      </Link>
    </li>
  );
}

/** Overdue and upcoming service, so nothing slips. Hidden when nothing is due. */
function MaintenanceDueCard({ onShowAll }: { onShowAll: () => void }) {
  const due = useMaintenanceDue(DUE_SOON_DAYS);
  if (!due.data || due.data.length === 0) return null;
  const overdue = due.data.filter((item) => (item.daysUntilMaintenance ?? 0) < 0).length;
  return (
    <Card className="mb-6">
      <CardHeader
        id="maintenance-due-heading"
        title="Maintenance due"
        description={
          overdue > 0
            ? `${overdue} overdue · ${due.data.length - overdue} due in the next ${DUE_SOON_DAYS} days`
            : `${due.data.length} due in the next ${DUE_SOON_DAYS} days`
        }
        action={
          due.data.length > DUE_PREVIEW && (
            <Button variant="ghost" size="sm" onClick={onShowAll}>
              Show all {due.data.length}
            </Button>
          )
        }
      />
      <ul aria-labelledby="maintenance-due-heading" className="divide-y divide-border">
        {due.data.slice(0, DUE_PREVIEW).map((item) => {
          const info = maintenanceDue(item);
          return (
            <li key={item.id}>
              <Link
                to={`/equipment/${item.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors duration-150 hover:bg-surface-hover sm:px-5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{item.name}</span>
                  <span className="block truncate text-13 text-fg-muted">
                    <span className="font-mono">{item.assetTag}</span>
                    {item.location && ` · ${item.location}`}
                  </span>
                </span>
                {info && <Badge tone={info.tone}>{info.label}</Badge>}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function EquipmentPage() {
  const can = useCan();
  const canManage = can('equipment:manage');
  const { text, oneOf, page, update } = useUrlFilters();
  const query: EquipmentListQuery = {
    page,
    pageSize: PAGE_SIZE,
    q: text('q'),
    category: oneOf('category', EQUIPMENT_CATEGORIES),
    status: oneOf('status', EQUIPMENT_STATUSES),
    condition: oneOf('condition', EQUIPMENT_CONDITIONS),
    maintenanceDue: text('due') === '1' ? 'true' : undefined,
  };
  const creating = text('new') === '1';
  const list = useEquipmentList(query);
  const filtered = Boolean(
    query.q || query.category || query.status || query.condition || query.maintenanceDue,
  );
  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const openCreate = (open: boolean) => update({ new: open ? '1' : null }, false);
  const clearAll = () =>
    update({ q: null, category: null, status: null, condition: null, due: null });

  return (
    <>
      <PageHeader
        title="Equipment"
        description="Every machine and piece of kit on the floor, its condition and when it is next serviced."
        actions={
          canManage && (
            <Button icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
              Add equipment
            </Button>
          )
        }
      />

      {!query.maintenanceDue && <MaintenanceDueCard onShowAll={() => update({ due: '1' })} />}

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5 xl:flex-row xl:items-center">
          <div className="xl:max-w-xs xl:flex-1">
            <SearchInput
              value={query.q ?? ''}
              onChange={setSearch}
              label="Search equipment"
              placeholder="Name, asset tag, serial or location"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:ml-auto xl:flex">
            <Select
              aria-label="Filter by category"
              value={query.category ?? ''}
              onChange={(event) => update({ category: event.target.value })}
              className="xl:w-44"
            >
              <option value="">All categories</option>
              {EQUIPMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {EQUIPMENT_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by status"
              value={query.status ?? ''}
              onChange={(event) => update({ status: event.target.value })}
              className="xl:w-40"
            >
              <option value="">Any status</option>
              {EQUIPMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {EQUIPMENT_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by condition"
              value={query.condition ?? ''}
              onChange={(event) => update({ condition: event.target.value })}
              className="xl:w-40"
            >
              <option value="">Any condition</option>
              {EQUIPMENT_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {EQUIPMENT_CONDITION_LABELS[condition]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Filter by maintenance"
              value={query.maintenanceDue ? 'due' : ''}
              onChange={(event) => update({ due: event.target.value === 'due' ? '1' : null })}
              className="xl:w-48"
            >
              <option value="">Any service date</option>
              <option value="due">Due within {DUE_SOON_DAYS} days</option>
            </Select>
          </div>
        </div>

        {list.isPending ? (
          <ListSkeleton rows={6} label="Loading equipment" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<Wrench aria-hidden />}
              title={
                query.maintenanceDue && !query.q
                  ? 'Nothing is due for maintenance'
                  : 'No equipment matches these filters'
              }
              action={
                <Button variant="secondary" size="sm" onClick={clearAll}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Wrench aria-hidden />}
              title="The register is empty"
              description={
                canManage
                  ? 'Add your machines and kit to track their condition and service dates.'
                  : 'A Manager or Admin adds equipment here.'
              }
              action={
                canManage && (
                  <Button size="sm" icon={<Plus aria-hidden />} onClick={() => openCreate(true)}>
                    Add equipment
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ul
              aria-label="Equipment"
              aria-busy={list.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              {list.data.data.map((item) => (
                <EquipmentRow key={item.id} item={item} />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="items"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>

      {canManage && <EquipmentFormDialog open={creating} onOpenChange={openCreate} />}
    </>
  );
}
