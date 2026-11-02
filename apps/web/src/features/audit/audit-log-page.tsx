import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditAction,
  type AuditEntityType,
  type AuditListQuery,
} from '@gms/shared';
import { ScrollText, X } from 'lucide-react';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { FormField, Input, Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { cn } from '../../lib/cn';
import { useAuditLogs } from './audit-api';
import { AuditEvent } from './audit-event';

const PAGE_SIZE = 25;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_LABELS: Record<AuditEntityType, string> = {
  USER: 'User accounts',
  GYM_SETTINGS: 'Gym settings',
  MEMBER: 'Members',
  MEMBERSHIP_PLAN: 'Membership plans',
  MEMBERSHIP: 'Memberships',
  ACCESS_ATTEMPT: 'Access attempts',
  ATTENDANCE: 'Attendance',
  ACCESS_DEVICE: 'Access devices',
  BIOMETRIC_CONSENT: 'Biometric consent',
  BIOMETRIC_ENROLLMENT: 'Biometric enrollments',
  INVOICE: 'Invoices',
  PAYMENT: 'Payments',
  REFUND: 'Refunds',
  TRAINER: 'Trainers',
  TRAINER_ASSIGNMENT: 'Trainer assignments',
  TRAINER_TIME_OFF: 'Trainer time off',
  STAFF_SHIFT: 'Staff shifts',
  FITNESS_CLASS: 'Classes',
  CLASS_SESSION: 'Class sessions',
  CLASS_BOOKING: 'Class bookings',
  APPOINTMENT: 'Appointments',
  EXERCISE: 'Exercises',
  WORKOUT_PLAN: 'Workout plans',
  WORKOUT_ASSIGNMENT: 'Assigned workouts',
  PROGRESS_ENTRY: 'Progress entries',
  EQUIPMENT: 'Equipment',
  MAINTENANCE_RECORD: 'Maintenance records',
};

function useAuditFilters() {
  const [params, setParams] = useSearchParams();
  const action = params.get('action');
  const entityType = params.get('entityType');
  const from = params.get('from');
  const to = params.get('to');
  const entityId = params.get('entityId');

  const query: AuditListQuery = {
    page: Math.max(1, Number(params.get('page')) || 1),
    pageSize: PAGE_SIZE,
    q: params.get('q') || undefined,
    action: AUDIT_ACTIONS.includes(action as AuditAction) ? (action as AuditAction) : undefined,
    entityType: AUDIT_ENTITY_TYPES.includes(entityType as AuditEntityType)
      ? (entityType as AuditEntityType)
      : undefined,
    from: from && ISO_DATE.test(from) ? from : undefined,
    to: to && ISO_DATE.test(to) ? to : undefined,
    entityId: entityId && UUID.test(entityId) ? entityId : undefined,
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

export function AuditLogPage() {
  const { query, update } = useAuditFilters();
  const rangeInvalid = Boolean(query.from && query.to && query.from > query.to);
  const logs = useAuditLogs(query, !rangeInvalid);
  const filtered = Boolean(
    query.q || query.action || query.entityType || query.from || query.to || query.entityId,
  );
  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const clearAll = () =>
    update({ q: null, action: null, entityType: null, from: null, to: null, entityId: null });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, account change and settings change. Entries cannot be edited or deleted."
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:px-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] xl:items-end">
            <div className="flex flex-col gap-1.5 sm:col-span-2 xl:col-span-1">
              <span className="text-13 font-medium text-fg" aria-hidden>
                Search
              </span>
              <SearchInput
                value={query.q ?? ''}
                onChange={setSearch}
                label="Search audit log"
                placeholder="Name, email or reason"
              />
            </div>
            <FormField label="Action">
              <Select
                value={query.action ?? ''}
                onChange={(event) => update({ action: event.target.value })}
              >
                <option value="">All actions</option>
                {AUDIT_ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {AUDIT_ACTION_LABELS[action]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Area">
              <Select
                value={query.entityType ?? ''}
                onChange={(event) => update({ entityType: event.target.value })}
              >
                <option value="">Everything</option>
                {AUDIT_ENTITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {ENTITY_LABELS[type]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="From">
              <Input
                type="date"
                value={query.from ?? ''}
                max={query.to}
                onChange={(event) => update({ from: event.target.value })}
              />
            </FormField>
            <FormField
              label="To"
              error={rangeInvalid ? '“To” must be on or after “From”' : undefined}
            >
              <Input
                type="date"
                value={query.to ?? ''}
                min={query.from}
                onChange={(event) => update({ to: event.target.value })}
              />
            </FormField>
          </div>
          {(query.entityId || filtered) && (
            <div className="flex flex-wrap items-center gap-2">
              {query.entityId && (
                <span className="inline-flex items-center gap-1 rounded-sm bg-primary-subtle py-0.5 pr-1 pl-2 text-xs font-medium text-primary-text">
                  One account only
                  <button
                    type="button"
                    aria-label="Show all accounts"
                    onClick={() => update({ entityId: null })}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm hover:bg-primary/15"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              )}
              {filtered && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </div>

        {rangeInvalid ? (
          <EmptyState
            icon={<ScrollText aria-hidden />}
            title="Check the date range"
            description="Pick a “From” date on or before the “To” date."
          />
        ) : logs.isPending ? (
          <ListSkeleton rows={8} label="Loading audit log" />
        ) : logs.isError ? (
          <ErrorState
            error={logs.error}
            title={
              logs.error instanceof ApiError && logs.error.status === 400
                ? 'These filters are not valid'
                : undefined
            }
            onRetry={() => logs.refetch()}
          />
        ) : logs.data.data.length === 0 ? (
          <EmptyState
            icon={<ScrollText aria-hidden />}
            title={filtered ? 'No entries match these filters' : 'No entries yet'}
            description={
              filtered
                ? 'Widen the date range or clear the filters.'
                : 'Sign-ins and changes will appear here as they happen.'
            }
            action={
              filtered && (
                <Button variant="secondary" size="sm" onClick={clearAll}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <>
            <ul
              aria-label="Audit entries"
              aria-busy={logs.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                logs.isPlaceholderData && 'opacity-60',
              )}
            >
              {logs.data.data.map((event) => (
                <AuditEvent key={event.id} event={event} />
              ))}
            </ul>
            <Pagination
              page={logs.data.page}
              pageSize={logs.data.pageSize}
              total={logs.data.total}
              noun="entries"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>
    </>
  );
}
