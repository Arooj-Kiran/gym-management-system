import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentDto,
  type PaymentListQuery,
  type RefundDto,
  type RefundListQuery,
} from '@gms/shared';
import { Printer, ReceiptText, Undo2, Wallet } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { TabPanel, Tabs } from '../../components/ui/tabs';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDateTime, formatMoney, gymTodayIso } from '../../lib/format';
import { usePaymentList, useRefundList } from './billing-api';
import { RefundPaymentDialog } from './billing-dialogs';
import { methodLabel, openReceipt } from './billing-format';
import { DateRangeFilter } from './date-range-filter';
import { RecordPaymentDialog } from './record-payment-dialog';
import { useUrlFilters } from './use-url-filters';

const PAGE_SIZE = 25;
const VIEWS = ['payments', 'refunds'] as const;
type View = (typeof VIEWS)[number];

const PAYMENT_GRID =
  'lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto]';
/**
 * Every row is its own grid, so the actions column gets one fixed width (its widest buttons,
 * "Receipt" and "Refund") in each row and in the header; otherwise the columns shift per row.
 */
const paymentActionsWidth = (canRefund: boolean) => (canRefund ? 'lg:w-50' : 'lg:w-25');
const REFUND_GRID =
  'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,0.8fr)]';

function MemberCell({ member }: { member: PaymentDto['member'] }) {
  return (
    <span className="min-w-0">
      <Link
        to={`/members/${member.id}?tab=payments`}
        className="block truncate text-13 text-fg hover:underline"
      >
        {fullName(member)}
      </Link>
      <span className="block truncate font-mono text-xs text-fg-muted">{member.memberCode}</span>
    </span>
  );
}

function PaymentRow({
  payment,
  currency,
  canRefund,
  onRefund,
}: {
  payment: PaymentDto;
  currency: string;
  canRefund: boolean;
  onRefund: () => void;
}) {
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5',
        PAYMENT_GRID,
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-mono text-13 font-medium text-fg">
          {payment.receiptNumber}
        </span>
        <span className="block truncate text-xs text-fg-muted">
          {payment.invoiceNumber} · {payment.invoiceDescription}
        </span>
      </span>
      <span className="text-right text-13 tabular-nums lg:hidden">
        <span className="font-semibold text-fg">{formatMoney(payment.amountMinor, currency)}</span>
      </span>
      <MemberCell member={payment.member} />
      <span className="text-13 text-fg-secondary tabular-nums max-lg:justify-self-end">
        {formatDateTime(payment.receivedAt)}
      </span>
      <span className="min-w-0 truncate text-13 text-fg-secondary">
        {methodLabel(payment.method, payment.reference)}
        {payment.recordedByName && (
          <span className="block truncate text-xs text-fg-muted">by {payment.recordedByName}</span>
        )}
      </span>
      <span className="hidden text-13 tabular-nums lg:block">
        <span className="font-semibold text-fg">{formatMoney(payment.amountMinor, currency)}</span>
        {payment.refundedMinor > 0 && (
          <span className="block text-xs text-danger-text">
            −{formatMoney(payment.refundedMinor, currency)} refunded
          </span>
        )}
      </span>
      <span
        className={cn(
          'col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-end',
          paymentActionsWidth(canRefund),
        )}
      >
        {payment.refundedMinor > 0 && (
          <span className="mr-auto text-xs text-danger-text lg:hidden">
            −{formatMoney(payment.refundedMinor, currency)} refunded
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<Printer aria-hidden />}
          onClick={() => openReceipt(payment.id)}
        >
          Receipt
        </Button>
        {canRefund && payment.refundableMinor > 0 && (
          <Button size="sm" variant="ghost" icon={<Undo2 aria-hidden />} onClick={onRefund}>
            Refund
          </Button>
        )}
      </span>
    </li>
  );
}

function RefundRow({ refund, currency }: { refund: RefundDto; currency: string }) {
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5',
        REFUND_GRID,
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-mono text-13 font-medium text-fg">
          {refund.refundNumber}
        </span>
        <span className="block truncate text-xs text-fg-muted">
          from {refund.receiptNumber} · {refund.invoiceNumber}
        </span>
      </span>
      <span className="text-right text-13 font-semibold text-danger-text tabular-nums lg:order-last">
        −{formatMoney(refund.amountMinor, currency)}
      </span>
      <MemberCell member={refund.member} />
      <span className="text-13 text-fg-secondary tabular-nums max-lg:justify-self-end">
        {formatDateTime(refund.refundedAt)}
      </span>
      <span className="col-span-2 min-w-0 text-13 text-fg-secondary lg:col-span-1">
        <span className="line-clamp-2">“{refund.reason}”</span>
        <span className="block truncate text-xs text-fg-muted">
          {methodLabel(refund.method)}
          {refund.recordedByName && ` · by ${refund.recordedByName}`}
        </span>
      </span>
    </li>
  );
}

/** Column titles; an empty title is the actions column, `actionsClassName` sets its width. */
function ListHead({
  grid,
  columns,
  actionsClassName,
}: {
  grid: string;
  columns: string[];
  actionsClassName?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'hidden gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid',
        grid,
      )}
    >
      {columns.map((column, index) => (
        <span key={index} className={column ? undefined : actionsClassName}>
          {column}
        </span>
      ))}
    </div>
  );
}

export function PaymentsPage() {
  const can = useCan();
  const { gym } = useSession();
  const currency = gym.currencyCode;
  const today = gymTodayIso();
  const filters = useUrlFilters();
  const { update } = filters;
  const view: View = filters.oneOf('view', VIEWS) ?? 'payments';
  const base = {
    page: filters.page,
    pageSize: PAGE_SIZE,
    q: filters.text('q'),
    from: filters.date('from'),
    to: filters.date('to'),
  };
  const paymentQuery: PaymentListQuery = {
    ...base,
    method: filters.oneOf('method', PAYMENT_METHODS),
  };
  const refundQuery: RefundListQuery = base;
  const paymentList = usePaymentList(paymentQuery, view === 'payments');
  const refundList = useRefundList(refundQuery, view === 'refunds');
  const list = view === 'payments' ? paymentList : refundList;
  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const filtered = Boolean(
    base.q || base.from || base.to || (view === 'payments' && paymentQuery.method),
  );
  const [refunding, setRefunding] = useState<PaymentDto | null>(null);
  const [recording, setRecording] = useState(false);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Money received at the counter and money handed back, newest first."
        actions={
          can('payments:record') && (
            <Button icon={<ReceiptText aria-hidden />} onClick={() => setRecording(true)}>
              Record payment
            </Button>
          )
        }
      />

      <Tabs
        label="Payments and refunds"
        idPrefix="money"
        tabs={[
          { value: 'payments', label: 'Payments' },
          { value: 'refunds', label: 'Refunds' },
        ]}
        value={view}
        onChange={(next) => update({ view: next === 'payments' ? null : next, method: null })}
        className="mb-4"
      />

      <TabPanel idPrefix="money" value={view}>
        <Card>
          <div
            className={cn(
              'grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-2 sm:px-5',
              view === 'payments'
                ? 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]'
                : 'xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)]',
            )}
          >
            <SearchInput
              value={base.q ?? ''}
              onChange={setSearch}
              label={view === 'payments' ? 'Search payments' : 'Search refunds'}
              placeholder={
                view === 'payments'
                  ? 'Receipt, invoice, reference, member name or code'
                  : 'Refund or receipt number, member name or code'
              }
            />
            {view === 'payments' && (
              <Select
                aria-label="Filter by method"
                value={paymentQuery.method ?? ''}
                onChange={(event) => update({ method: event.target.value })}
              >
                <option value="">Any method</option>
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {PAYMENT_METHOD_LABELS[method]}
                  </option>
                ))}
              </Select>
            )}
            <DateRangeFilter
              label={view === 'payments' ? 'Received' : 'Refunded'}
              from={base.from}
              to={base.to}
              max={today}
              onChange={(from, to) => update({ from, to })}
              className={view === 'payments' ? 'sm:col-span-2 xl:col-span-1' : undefined}
            />
          </div>

          {view === 'payments' ? (
            <ListHead
              grid={PAYMENT_GRID}
              columns={['Receipt', 'Member', 'Received', 'Method', 'Amount', '']}
              actionsClassName={paymentActionsWidth(can('payments:refund'))}
            />
          ) : (
            <ListHead
              grid={REFUND_GRID}
              columns={['Refund', 'Member', 'Refunded', 'Reason', 'Amount']}
            />
          )}

          {list.isPending ? (
            <ListSkeleton rows={8} label={`Loading ${view}`} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : list.data.data.length === 0 ? (
            <EmptyState
              icon={view === 'payments' ? <Wallet aria-hidden /> : <Undo2 aria-hidden />}
              title={
                filtered
                  ? `No ${view} match these filters`
                  : view === 'payments'
                    ? 'No payments recorded yet'
                    : 'No refunds issued'
              }
              description={
                filtered
                  ? 'Try another search, method or date range.'
                  : view === 'payments'
                    ? 'Payments taken at the counter appear here with their receipt numbers.'
                    : 'Refunds issued by an Admin or Manager appear here.'
              }
              action={
                filtered ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => update({ q: null, method: null, from: null, to: null })}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul
                aria-label={view === 'payments' ? 'Payments' : 'Refunds'}
                aria-busy={list.isPlaceholderData}
                className={cn(
                  'divide-y divide-border transition-opacity',
                  list.isPlaceholderData && 'opacity-60',
                )}
              >
                {view === 'payments'
                  ? paymentList.data?.data.map((payment) => (
                      <PaymentRow
                        key={payment.id}
                        payment={payment}
                        currency={currency}
                        canRefund={can('payments:refund')}
                        onRefund={() => setRefunding(payment)}
                      />
                    ))
                  : refundList.data?.data.map((refund) => (
                      <RefundRow key={refund.id} refund={refund} currency={currency} />
                    ))}
              </ul>
              <Pagination
                page={list.data.page}
                pageSize={list.data.pageSize}
                total={list.data.total}
                noun={view}
                onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
              />
            </>
          )}
        </Card>
      </TabPanel>

      {can('payments:record') && (
        <RecordPaymentDialog open={recording} onOpenChange={setRecording} />
      )}
      {can('payments:refund') && (
        <RefundPaymentDialog
          payment={refunding}
          onOpenChange={(open) => !open && setRefunding(null)}
        />
      )}
    </>
  );
}
