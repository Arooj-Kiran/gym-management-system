import type { InvoiceDto, MemberDto, PaymentDto } from '@gms/shared';
import { FilePlus2, FileText, Printer, ReceiptText, Undo2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { Pagination } from '../../components/ui/pagination';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useMemberInvoices, useMemberPayments } from './billing-api';
import { CreateInvoiceDialog, RefundPaymentDialog, VoidInvoiceDialog } from './billing-dialogs';
import { isOpenInvoice, methodLabel, openReceipt } from './billing-format';
import { InvoiceDetailDialog } from './invoice-detail-dialog';
import { InvoiceStatusBadge } from './invoice-status-badge';
import { RecordPaymentDialog } from './record-payment-dialog';

const PAGE_SIZE = 10;

function SummaryTile({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: string;
  tone?: 'danger';
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3.5 shadow-xs">
      <p className="text-13 text-fg-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-24" />
      ) : (
        <p
          className={cn(
            'mt-0.5 text-lg font-semibold tracking-tight tabular-nums',
            tone === 'danger' ? 'text-danger-text' : 'text-fg',
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

/** The member page "Payments" tab: what they owe, every invoice and every payment. */
export function MemberBillingTab({ member }: { member: MemberDto }) {
  const can = useCan();
  const { gym } = useSession();
  const currency = gym.currencyCode;
  const [invoicePage, setInvoicePage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const invoices = useMemberInvoices(member.id, { page: invoicePage, pageSize: PAGE_SIZE });
  const payments = useMemberPayments(member.id, { page: paymentPage, pageSize: PAGE_SIZE });
  const canRecord = can('payments:record') && !member.archivedAt;

  const [openedId, setOpenedId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [quickPay, setQuickPay] = useState(false);
  const [creating, setCreating] = useState(false);
  const [voiding, setVoiding] = useState<InvoiceDto | null>(null);
  const [refunding, setRefunding] = useState<PaymentDto | null>(null);
  const summary = invoices.data?.summary;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3">
        <SummaryTile
          label="Outstanding"
          value={formatMoney(summary?.outstandingMinor ?? 0, currency)}
          loading={invoices.isPending}
        />
        <SummaryTile
          label="Overdue"
          value={formatMoney(summary?.overdueMinor ?? 0, currency)}
          tone={summary && summary.overdueMinor > 0 ? 'danger' : undefined}
          loading={invoices.isPending}
        />
      </div>

      <Card>
        <CardHeader
          title="Invoices"
          description="Membership invoices are created on assign and renew"
          action={
            canRecord && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<FilePlus2 aria-hidden />}
                  onClick={() => setCreating(true)}
                >
                  New charge
                </Button>
                <Button
                  size="sm"
                  icon={<ReceiptText aria-hidden />}
                  onClick={() => setQuickPay(true)}
                  disabled={!summary || summary.outstandingMinor === 0}
                >
                  Record payment
                </Button>
              </div>
            )
          }
        />
        {invoices.isPending ? (
          <ListSkeleton rows={3} label="Loading invoices" />
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => invoices.refetch()} />
        ) : invoices.data.data.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden />}
            title="No invoices"
            description="Nothing has been billed to this member yet."
          />
        ) : (
          <>
            <ul
              aria-label="Invoices"
              className={cn('divide-y divide-border', invoices.isPlaceholderData && 'opacity-60')}
            >
              {invoices.data.data.map((invoice) => {
                const open = isOpenInvoice(invoice.status);
                return (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                  >
                    <span className="min-w-0 flex-1 basis-56">
                      <button
                        type="button"
                        onClick={() => setOpenedId(invoice.id)}
                        className="block max-w-full cursor-pointer truncate text-left text-sm font-medium text-fg hover:underline"
                      >
                        {invoice.description}
                      </button>
                      <span className="block truncate text-xs text-fg-muted">
                        <span className="font-mono">{invoice.invoiceNumber}</span> · due{' '}
                        {formatDate(invoice.dueDate)}
                      </span>
                    </span>
                    <span className="text-right text-13 tabular-nums">
                      <span className="block font-medium text-fg">
                        {formatMoney(invoice.amountDueMinor, currency)}
                      </span>
                      {open && invoice.balanceMinor !== invoice.amountDueMinor && (
                        <span className="block text-xs text-fg-muted">
                          {formatMoney(invoice.balanceMinor, currency)} left
                        </span>
                      )}
                    </span>
                    <InvoiceStatusBadge status={invoice.status} />
                    <span className="flex gap-1">
                      {canRecord && open && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPayingId(invoice.id)}
                        >
                          Pay
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setOpenedId(invoice.id)}>
                        Details
                      </Button>
                    </span>
                  </li>
                );
              })}
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
        <CardHeader title="Payment history" description="Receipts, newest first" />
        {payments.isPending ? (
          <ListSkeleton rows={3} label="Loading payments" />
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={() => payments.refetch()} />
        ) : payments.data.data.length === 0 ? (
          <EmptyState
            icon={<Wallet aria-hidden />}
            title="No payments yet"
            description="Payments recorded at the counter will be listed here with their receipts."
          />
        ) : (
          <>
            <ul
              aria-label="Payments"
              className={cn('divide-y divide-border', payments.isPlaceholderData && 'opacity-60')}
            >
              {payments.data.data.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
                >
                  <span className="min-w-0 flex-1 basis-56 text-13">
                    <span className="block font-medium text-fg tabular-nums">
                      {formatMoney(payment.amountMinor, currency)}
                      <span className="font-normal text-fg-secondary">
                        {' '}
                        · {methodLabel(payment.method, payment.reference)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      <span className="font-mono">{payment.receiptNumber}</span> ·{' '}
                      {formatDateTime(payment.receivedAt)} · {payment.invoiceDescription}
                    </span>
                    {payment.refundedMinor > 0 && (
                      <span className="block text-xs text-danger-text">
                        −{formatMoney(payment.refundedMinor, currency)} refunded
                      </span>
                    )}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Printer aria-hidden />}
                      onClick={() => openReceipt(payment.id)}
                    >
                      Receipt
                    </Button>
                    {can('payments:refund') && payment.refundableMinor > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Undo2 aria-hidden />}
                        onClick={() => setRefunding(payment)}
                      >
                        Refund
                      </Button>
                    )}
                  </span>
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
      {canRecord && (
        <>
          <RecordPaymentDialog
            open={payingId !== null}
            onOpenChange={(open) => !open && setPayingId(null)}
            invoiceId={payingId ?? undefined}
          />
          <RecordPaymentDialog open={quickPay} onOpenChange={setQuickPay} member={member} />
          <CreateInvoiceDialog open={creating} onOpenChange={setCreating} member={member} />
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
    </div>
  );
}
