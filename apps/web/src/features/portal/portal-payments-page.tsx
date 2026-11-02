import { PAYMENT_METHOD_LABELS } from '@gms/shared';
import { CreditCard, FileText, Printer, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useMyInvoices, useMyPayments } from '../billing/billing-api';
import { isOpenInvoice, openReceipt } from '../billing/billing-format';
import { InvoiceStatusBadge } from '../billing/invoice-status-badge';

/** What the member owes, at a glance, and where to pay. Online payment is not set up (D8). */
function BalanceCard({
  outstandingMinor,
  overdueMinor,
  loading,
}: {
  outstandingMinor: number;
  overdueMinor: number;
  loading: boolean;
}) {
  const { gym } = useSession();
  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="text-13 text-fg-muted">Outstanding balance</p>
          {loading ? (
            <Skeleton className="mt-2 h-8 w-36" />
          ) : (
            <p className="mt-0.5 text-[1.75rem] leading-tight font-semibold tracking-tight text-fg tabular-nums">
              {formatMoney(outstandingMinor, gym.currencyCode)}
            </p>
          )}
          {!loading && overdueMinor > 0 && (
            <p className="mt-1 text-13 font-medium text-danger-text tabular-nums">
              {formatMoney(overdueMinor, gym.currencyCode)} of it is overdue
            </p>
          )}
          {!loading && outstandingMinor === 0 && (
            <p className="mt-1 text-13 text-fg-secondary">You are all paid up.</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 sm:items-end">
          <Button variant="secondary" icon={<CreditCard aria-hidden />} disabled>
            Pay online
          </Button>
          <span className="flex items-center gap-2 text-xs text-fg-muted">
            <Badge tone="warning">Requires configuration</Badge>
            Pay at the front desk for now.
          </span>
        </div>
      </div>
    </Card>
  );
}

/** The member's own invoices and receipts. No staff names or internal notes are shown. */
export function PortalPaymentsPage() {
  const { gym } = useSession();
  const currency = gym.currencyCode;
  const [invoicePage, setInvoicePage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const invoices = useMyInvoices(invoicePage);
  const payments = useMyPayments(paymentPage);

  return (
    <>
      <PageHeader
        title="My payments"
        description="What you have been billed and every payment you have made, with printable receipts."
      />
      <BalanceCard
        outstandingMinor={invoices.data?.summary.outstandingMinor ?? 0}
        overdueMinor={invoices.data?.summary.overdueMinor ?? 0}
        loading={invoices.isPending}
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Invoices" description="Newest first" />
          {invoices.isPending ? (
            <ListSkeleton rows={4} label="Loading your invoices" />
          ) : invoices.isError ? (
            <ErrorState error={invoices.error} onRetry={() => invoices.refetch()} />
          ) : invoices.data.data.length === 0 ? (
            <EmptyState
              icon={<FileText aria-hidden />}
              title="No invoices yet"
              description="When the gym bills you for a membership or another charge, it shows up here."
            />
          ) : (
            <>
              <ul
                aria-label="My invoices"
                aria-busy={invoices.isPlaceholderData}
                className={cn('divide-y divide-border', invoices.isPlaceholderData && 'opacity-60')}
              >
                {invoices.data.data.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5"
                  >
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block truncate text-sm font-medium text-fg">
                        {invoice.description}
                      </span>
                      <span className="block truncate text-xs text-fg-muted">
                        <span className="font-mono">{invoice.invoiceNumber}</span> · due{' '}
                        {formatDate(invoice.dueDate)}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-right text-13 tabular-nums">
                        <span className="block font-medium text-fg">
                          {formatMoney(invoice.amountDueMinor, currency)}
                        </span>
                        {isOpenInvoice(invoice.status) &&
                          invoice.balanceMinor !== invoice.amountDueMinor && (
                            <span className="block text-xs text-fg-muted">
                              {formatMoney(invoice.balanceMinor, currency)} left
                            </span>
                          )}
                      </span>
                      <InvoiceStatusBadge status={invoice.status} />
                    </span>
                  </li>
                ))}
              </ul>
              <Pagination
                page={invoices.data.page}
                pageSize={invoices.data.pageSize}
                total={invoices.data.total}
                noun="invoices"
                onPageChange={setInvoicePage}
              />
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Payment history" description="Newest first" />
          {payments.isPending ? (
            <ListSkeleton rows={4} label="Loading your payments" />
          ) : payments.isError ? (
            <ErrorState error={payments.error} onRetry={() => payments.refetch()} />
          ) : payments.data.data.length === 0 ? (
            <EmptyState
              icon={<Wallet aria-hidden />}
              title="No payments yet"
              description="Payments you make at the front desk appear here with a receipt."
            />
          ) : (
            <>
              <ul
                aria-label="My payments"
                aria-busy={payments.isPlaceholderData}
                className={cn('divide-y divide-border', payments.isPlaceholderData && 'opacity-60')}
              >
                {payments.data.data.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-4 py-3 sm:px-5"
                  >
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block text-sm font-medium text-fg tabular-nums">
                        {formatMoney(payment.amountMinor, currency)}
                        <span className="font-normal text-fg-secondary">
                          {' '}
                          · {PAYMENT_METHOD_LABELS[payment.method]}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-fg-muted">
                        {formatDateTime(payment.receivedAt)} · {payment.description}
                      </span>
                      {payment.refundedMinor > 0 && (
                        <span className="block text-xs text-fg-secondary tabular-nums">
                          {formatMoney(payment.refundedMinor, currency)} refunded to you
                        </span>
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Printer aria-hidden />}
                      onClick={() => openReceipt(payment.id, true)}
                      aria-label={`Receipt ${payment.receiptNumber}`}
                    >
                      Receipt
                    </Button>
                  </li>
                ))}
              </ul>
              <Pagination
                page={payments.data.page}
                pageSize={payments.data.pageSize}
                total={payments.data.total}
                noun="payments"
                onPageChange={setPaymentPage}
              />
            </>
          )}
        </Card>
      </div>
    </>
  );
}
