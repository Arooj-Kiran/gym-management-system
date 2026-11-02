import { PAYMENT_STATUS_LABELS, type InvoiceDto, type PaymentDto } from '@gms/shared';
import { Ban, Printer, ReceiptText, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { Button, ButtonLink } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName, useCan, useSession } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useInvoice } from './billing-api';
import { isOpenInvoice, methodLabel } from './billing-format';
import { InvoiceStatusBadge } from './invoice-status-badge';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-13 font-medium text-fg tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * One invoice with every payment and refund against it. Actions open the shared billing dialogs
 * owned by the page, so the detail view closes first and nothing stacks.
 */
export function InvoiceDetailDialog({
  invoiceId,
  onOpenChange,
  onRecordPayment,
  onRefund,
  onVoid,
}: {
  invoiceId: string | null;
  onOpenChange: (open: boolean) => void;
  onRecordPayment: (invoice: InvoiceDto) => void;
  onRefund: (payment: PaymentDto) => void;
  onVoid: (invoice: InvoiceDto) => void;
}) {
  const can = useCan();
  const { gym } = useSession();
  const currency = gym.currencyCode;
  const detail = useInvoice(invoiceId);
  const invoice = detail.data;
  const heldMinor = invoice ? invoice.paidMinor - invoice.refundedMinor : 0;

  return (
    <Dialog
      open={invoiceId !== null}
      onOpenChange={onOpenChange}
      title={invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice'}
      description={
        invoice ? `${fullName(invoice.member)} · ${invoice.member.memberCode}` : undefined
      }
      size="lg"
      footer={
        invoice && (
          <>
            {can('payments:void') && invoice.status !== 'VOID' && (
              <Button
                variant="ghost"
                icon={<Ban aria-hidden />}
                disabled={heldMinor > 0}
                title={heldMinor > 0 ? 'Refund the payments before voiding' : undefined}
                onClick={() => onVoid(invoice)}
                className="sm:mr-auto"
              >
                Void invoice
              </Button>
            )}
            {can('payments:record') && isOpenInvoice(invoice.status) && (
              <Button icon={<ReceiptText aria-hidden />} onClick={() => onRecordPayment(invoice)}>
                Record payment
              </Button>
            )}
          </>
        )
      }
    >
      {detail.isPending ? (
        <ListSkeleton rows={3} label="Loading invoice" />
      ) : detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
      ) : (
        invoice && (
          <div className="flex flex-col gap-6">
            <section aria-label="Summary">
              <div className="flex flex-wrap items-center gap-2">
                <InvoiceStatusBadge status={invoice.status} />
                {invoice.membershipId ? <Badge>Membership</Badge> : <Badge>Manual charge</Badge>}
                {!invoice.allowPartialPayment && <Badge>Paid in full only</Badge>}
              </div>
              <p className="mt-2 text-sm text-fg">{invoice.description}</p>
              <dl className="mt-4 grid grid-cols-2 gap-4 rounded-md border border-border bg-surface-muted/50 p-3.5 sm:grid-cols-4">
                <Fact label="Amount">{formatMoney(invoice.amountDueMinor, currency)}</Fact>
                <Fact label="Paid (net)">{formatMoney(heldMinor, currency)}</Fact>
                <Fact label="Balance">{formatMoney(invoice.balanceMinor, currency)}</Fact>
                <Fact label="Due">{formatDate(invoice.dueDate)}</Fact>
              </dl>
              <p className="mt-2 text-xs text-fg-muted">
                Created {formatDateTime(invoice.createdAt)}
                {invoice.createdByName ? ` by ${invoice.createdByName}` : ' automatically'}
                {invoice.membershipId && (
                  <>
                    {' · '}
                    <Link
                      to={`/members/${invoice.member.id}?tab=membership`}
                      className="text-primary-text hover:underline"
                    >
                      View membership
                    </Link>
                  </>
                )}
              </p>
              {invoice.status === 'VOID' && (
                <p className="mt-3 rounded-md bg-surface-muted px-3 py-2.5 text-13 text-fg-secondary">
                  Voided {formatDateTime(invoice.voidedAt)}
                  {invoice.voidedByName ? ` by ${invoice.voidedByName}` : ''}: “{invoice.voidReason}
                  ”
                </p>
              )}
            </section>

            <section aria-labelledby="invoice-payments">
              <h3 id="invoice-payments" className="text-13 font-semibold text-fg">
                Payments
              </h3>
              {invoice.payments.length === 0 ? (
                <p className="mt-2 text-13 text-fg-muted">No payments yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {invoice.payments.map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-13 font-medium text-fg">
                          <span className="tabular-nums">
                            {formatMoney(payment.amountMinor, currency)}
                          </span>{' '}
                          <span className="font-normal text-fg-secondary">
                            · {methodLabel(payment.method, payment.reference)}
                          </span>
                        </p>
                        <p className="text-xs text-fg-muted">
                          <span className="font-mono">{payment.receiptNumber}</span> ·{' '}
                          {formatDateTime(payment.receivedAt)}
                          {payment.recordedByName && ` · ${payment.recordedByName}`}
                          {payment.refundedMinor > 0 &&
                            ` · ${formatMoney(payment.refundedMinor, currency)} refunded`}
                        </p>
                        {payment.notes && (
                          <p className="mt-0.5 text-xs text-fg-secondary">“{payment.notes}”</p>
                        )}
                      </div>
                      {payment.status !== 'COMPLETED' && (
                        <Badge tone="warning">{PAYMENT_STATUS_LABELS[payment.status]}</Badge>
                      )}
                      <div className="flex gap-1">
                        <ButtonLink
                          to={`/payments/${payment.id}/receipt`}
                          target="_blank"
                          variant="ghost"
                          size="sm"
                          icon={<Printer aria-hidden />}
                        >
                          Receipt
                        </ButtonLink>
                        {can('payments:refund') && payment.refundableMinor > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Undo2 aria-hidden />}
                            onClick={() => onRefund(payment)}
                          >
                            Refund
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {invoice.refunds.length > 0 && (
              <section aria-labelledby="invoice-refunds">
                <h3 id="invoice-refunds" className="text-13 font-semibold text-fg">
                  Refunds
                </h3>
                <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                  {invoice.refunds.map((refund) => (
                    <li key={refund.id} className="px-3.5 py-2.5">
                      <p className="text-13 font-medium text-fg">
                        <span className="tabular-nums">
                          −{formatMoney(refund.amountMinor, currency)}
                        </span>{' '}
                        <span className="font-normal text-fg-secondary">
                          · {methodLabel(refund.method)} · from {refund.receiptNumber}
                        </span>
                      </p>
                      <p className="text-xs text-fg-muted">
                        <span className="font-mono">{refund.refundNumber}</span> ·{' '}
                        {formatDateTime(refund.refundedAt)}
                        {refund.recordedByName && ` · ${refund.recordedByName}`} · “{refund.reason}”
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )
      )}
    </Dialog>
  );
}
