import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  type InvoiceDto,
  type InvoiceListQuery,
  type PaymentDto,
} from '@gms/shared';
import { FilePlus2, FileText, ReceiptText } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { SearchInput } from '../../components/ui/search-input';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDate, formatMoney } from '../../lib/format';
import { useInvoiceList } from './billing-api';
import { CreateInvoiceDialog, RefundPaymentDialog, VoidInvoiceDialog } from './billing-dialogs';
import { isOpenInvoice } from './billing-format';
import { DateRangeFilter } from './date-range-filter';
import { InvoiceDetailDialog } from './invoice-detail-dialog';
import { InvoiceStatusBadge } from './invoice-status-badge';
import { RecordPaymentDialog } from './record-payment-dialog';
import { useUrlFilters } from './use-url-filters';

const PAGE_SIZE = 25;
const GRID =
  'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]';
/**
 * Every row is its own grid, so the actions column gets one fixed width (its widest buttons,
 * "Record payment" and "Details") in each row and in the header; otherwise rows with fewer
 * buttons shift their columns.
 */
const ACTIONS_WIDTH = 'lg:w-58';

function InvoiceRow({
  invoice,
  currency,
  canRecord,
  onPay,
  onOpen,
}: {
  invoice: InvoiceDto;
  currency: string;
  canRecord: boolean;
  onPay: () => void;
  onOpen: () => void;
}) {
  const open = isOpenInvoice(invoice.status);
  return (
    <li
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5',
        GRID,
      )}
    >
      <span className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className="block max-w-full cursor-pointer truncate text-left text-sm font-medium text-fg hover:underline"
        >
          {invoice.description}
        </button>
        <span className="block truncate font-mono text-xs text-fg-muted">
          {invoice.invoiceNumber}
        </span>
      </span>
      <span className="justify-self-end lg:hidden">
        <InvoiceStatusBadge status={invoice.status} />
      </span>
      <span className="min-w-0">
        <Link
          to={`/members/${invoice.member.id}?tab=payments`}
          className="block truncate text-13 text-fg hover:underline"
        >
          {fullName(invoice.member)}
        </Link>
        <span className="block truncate font-mono text-xs text-fg-muted">
          {invoice.member.memberCode}
        </span>
      </span>
      <span className="text-13 text-fg-secondary tabular-nums max-lg:justify-self-end">
        <span className="lg:hidden">Due </span>
        {formatDate(invoice.dueDate)}
      </span>
      <span className="text-13 tabular-nums">
        <span className="font-medium text-fg">{formatMoney(invoice.amountDueMinor, currency)}</span>
        {open && invoice.balanceMinor !== invoice.amountDueMinor && (
          <span className="block text-xs text-fg-muted">
            {formatMoney(invoice.balanceMinor, currency)} left
          </span>
        )}
      </span>
      <span className="hidden lg:block">
        <InvoiceStatusBadge status={invoice.status} />
      </span>
      <span
        className={cn(
          'col-span-2 flex gap-2 lg:col-span-1 lg:justify-end',
          canRecord && ACTIONS_WIDTH,
        )}
      >
        {canRecord && open && (
          <Button size="sm" variant="secondary" icon={<ReceiptText aria-hidden />} onClick={onPay}>
            Record payment
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Details
        </Button>
      </span>
    </li>
  );
}

export function InvoicesPage() {
  const can = useCan();
  const { gym } = useSession();
  const filters = useUrlFilters();
  const query: InvoiceListQuery = {
    page: filters.page,
    pageSize: PAGE_SIZE,
    q: filters.text('q'),
    status: filters.oneOf('status', INVOICE_STATUSES),
    from: filters.date('from'),
    to: filters.date('to'),
  };
  const list = useInvoiceList(query);
  const { update } = filters;
  const setSearch = useCallback((q: string) => update({ q }), [update]);
  const filtered = Boolean(query.q || query.status || query.from || query.to);

  const [openedId, setOpenedId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [quickPay, setQuickPay] = useState(false);
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<InvoiceDto | null>(null);
  const [refunding, setRefunding] = useState<PaymentDto | null>(null);

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Everything billed to members: memberships and manual charges. Balances and statuses are worked out by the server."
        actions={
          can('payments:record') && (
            <>
              <Button
                variant="secondary"
                icon={<FilePlus2 aria-hidden />}
                onClick={() => setCreating(true)}
              >
                New charge
              </Button>
              <Button icon={<ReceiptText aria-hidden />} onClick={() => setQuickPay(true)}>
                Record payment
              </Button>
            </>
          )
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-3 border-b border-border p-4 sm:grid-cols-2 sm:px-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]">
          <SearchInput
            value={query.q ?? ''}
            onChange={setSearch}
            label="Search invoices"
            placeholder="Invoice number, description, member name or code"
          />
          <Select
            aria-label="Filter by status"
            value={query.status ?? ''}
            onChange={(event) => update({ status: event.target.value })}
          >
            <option value="">Any status</option>
            {INVOICE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {INVOICE_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
          <DateRangeFilter
            label="Due"
            from={query.from}
            to={query.to}
            onChange={(from, to) => update({ from, to })}
            className="sm:col-span-2 xl:col-span-1"
          />
        </div>

        <div
          aria-hidden
          className={cn(
            'hidden gap-x-4 border-b border-border bg-surface-muted/60 px-5 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase lg:grid',
            GRID,
          )}
        >
          <span>Invoice</span>
          <span>Member</span>
          <span>Due</span>
          <span>Amount</span>
          <span>Status</span>
          <span className={can('payments:record') ? ACTIONS_WIDTH : undefined} />
        </div>

        {list.isPending ? (
          <ListSkeleton rows={8} label="Loading invoices" />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data.data.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden />}
            title={filtered ? 'No invoices match these filters' : 'No invoices yet'}
            description={
              filtered
                ? 'Try another search, status or date range.'
                : 'Assigning or renewing a paid membership creates its invoice automatically.'
            }
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => update({ q: null, status: null, from: null, to: null })}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul
              aria-label="Invoices"
              aria-busy={list.isPlaceholderData}
              className={cn(
                'divide-y divide-border transition-opacity',
                list.isPlaceholderData && 'opacity-60',
              )}
            >
              {list.data.data.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  currency={gym.currencyCode}
                  canRecord={can('payments:record')}
                  onPay={() => setPayingId(invoice.id)}
                  onOpen={() => setOpenedId(invoice.id)}
                />
              ))}
            </ul>
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              noun="invoices"
              onPageChange={(page) => update({ page: page > 1 ? String(page) : null }, false)}
            />
          </>
        )}
      </Card>

      <InvoiceDetailDialog
        invoiceId={openedId}
        onOpenChange={(open) => !open && setOpenedId(null)}
        onRecordPayment={(invoice) => {
          setOpenedId(null);
          setPayingId(invoice.id);
        }}
        onRefund={(payment) => {
          setOpenedId(null);
          setRefunding(payment);
        }}
        onVoid={(invoice) => {
          setOpenedId(null);
          setVoiding(invoice);
        }}
      />
      {can('payments:record') && (
        <>
          <RecordPaymentDialog
            open={payingId !== null}
            onOpenChange={(open) => !open && setPayingId(null)}
            invoiceId={payingId ?? undefined}
          />
          <RecordPaymentDialog open={quickPay} onOpenChange={setQuickPay} />
          <CreateInvoiceDialog open={creating} onOpenChange={setCreating} />
        </>
      )}
      {can('payments:void') && (
        <VoidInvoiceDialog invoice={voiding} onOpenChange={(open) => !open && setVoiding(null)} />
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
