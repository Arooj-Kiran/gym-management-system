import { PAYMENT_STATUS_LABELS } from '@gms/shared';
import { ArrowLeft, Printer, SearchX } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button, ButtonLink } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';
import { useReceipt } from './billing-api';
import { methodLabel } from './billing-format';
import { InvoiceStatusBadge } from './invoice-status-badge';

/** Paper is white: switch a dark-themed screen to light for the print job only. */
function usePrintInLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    let wasDark = false;
    const before = () => {
      wasDark = root.classList.contains('dark');
      root.classList.remove('dark');
    };
    const after = () => {
      if (wasDark) root.classList.add('dark');
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
}

function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5">
      <dt className="text-13 text-fg-secondary">{label}</dt>
      <dd
        className={
          strong
            ? 'text-sm font-semibold text-fg tabular-nums'
            : 'text-13 text-fg tabular-nums text-right'
        }
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * A printable receipt, outside the app shell so only the receipt prints. Staff open it from any
 * payment; members open their own from the portal (anyone else's is "not found").
 */
export function ReceiptPage({ portal = false }: { portal?: boolean }) {
  const { id = '' } = useParams();
  const receipt = useReceipt(id, portal);
  usePrintInLightTheme();
  const backTo = portal ? '/portal/payments' : '/payments';
  const data = receipt.data;

  useEffect(() => {
    if (data) document.title = `Receipt ${data.receiptNumber} · ${data.gymName}`;
  }, [data]);

  const refundedMinor = data?.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0) ?? 0;

  return (
    <div className="min-h-dvh bg-bg px-4 py-6 sm:py-10 print:min-h-0 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[640px] items-center justify-between gap-3 print:hidden">
        <ButtonLink to={backTo} variant="ghost" size="sm" icon={<ArrowLeft aria-hidden />}>
          {portal ? 'My payments' : 'Payments'}
        </ButtonLink>
        <Button
          size="sm"
          icon={<Printer aria-hidden />}
          onClick={() => window.print()}
          disabled={!data}
        >
          Print
        </Button>
      </div>

      <main className="mx-auto max-w-[640px] rounded-xl border border-border bg-surface shadow-sm print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        {receipt.isPending ? (
          <div role="status" aria-label="Loading receipt" className="space-y-4 p-8">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : receipt.isError ? (
          receipt.error instanceof ApiError && receipt.error.status === 404 ? (
            <EmptyState
              icon={<SearchX aria-hidden />}
              title="Receipt not found"
              description="It may belong to another account, or the link is wrong."
              action={
                <ButtonLink to={backTo} variant="secondary" size="sm">
                  Back to {portal ? 'my payments' : 'payments'}
                </ButtonLink>
              }
            />
          ) : (
            <ErrorState error={receipt.error} onRetry={() => receipt.refetch()} />
          )
        ) : (
          data && (
            <article aria-label={`Receipt ${data.receiptNumber}`} className="p-6 sm:p-10 print:p-0">
              <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-lg font-semibold tracking-tight text-fg">{data.gymName}</p>
                  <h1 className="mt-0.5 text-13 font-medium tracking-wide text-fg-muted uppercase">
                    Payment receipt
                  </h1>
                </div>
                <dl className="text-13 sm:text-right">
                  <dt className="sr-only">Receipt number</dt>
                  <dd className="font-mono text-sm font-semibold text-fg">{data.receiptNumber}</dd>
                  <dt className="sr-only">Received</dt>
                  <dd className="text-fg-secondary">
                    {formatDateTime(data.receivedAt, data.timezone)}
                  </dd>
                </dl>
              </header>

              <section className="grid gap-6 border-b border-border py-6 sm:grid-cols-2">
                <div>
                  <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                    Received from
                  </h2>
                  <p className="mt-1.5 text-sm font-medium text-fg">{fullName(data.member)}</p>
                  <p className="font-mono text-13 text-fg-secondary">{data.member.memberCode}</p>
                </div>
                <div className="sm:text-right">
                  <h2 className="text-xs font-medium tracking-wide text-fg-muted uppercase">
                    Amount received
                  </h2>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-fg tabular-nums">
                    {formatMoney(data.amountMinor, data.currencyCode)}
                  </p>
                  <p className="text-13 text-fg-secondary">
                    {methodLabel(data.method, data.reference)}
                  </p>
                  {data.status !== 'COMPLETED' && (
                    <span className="mt-1.5 inline-block">
                      <Badge tone="warning">{PAYMENT_STATUS_LABELS[data.status]}</Badge>
                    </span>
                  )}
                </div>
              </section>

              <section className="border-b border-border py-6" aria-labelledby="receipt-for">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    id="receipt-for"
                    className="text-xs font-medium tracking-wide text-fg-muted uppercase"
                  >
                    Payment for
                  </h2>
                  <InvoiceStatusBadge status={data.invoice.status} />
                </div>
                <p className="mt-1.5 text-sm font-medium text-fg">{data.invoice.description}</p>
                <p className="font-mono text-13 text-fg-secondary">
                  Invoice {data.invoice.invoiceNumber} · due {formatDate(data.invoice.dueDate)}
                </p>
                <dl className="mt-4 divide-y divide-border border-y border-border">
                  <Row label="Invoice amount">
                    {formatMoney(data.invoice.amountDueMinor, data.currencyCode)}
                  </Row>
                  <Row label="Paid to date">
                    {formatMoney(data.invoice.paidMinor, data.currencyCode)}
                  </Row>
                  <Row label="Balance now" strong>
                    {formatMoney(data.invoice.balanceMinor, data.currencyCode)}
                  </Row>
                </dl>
                <p className="mt-2 text-xs text-fg-muted">
                  Invoice figures are as of when this receipt was printed and include later payments
                  and refunds.
                </p>
              </section>

              {data.refunds.length > 0 && (
                <section className="border-b border-border py-6" aria-labelledby="receipt-refunds">
                  <h2
                    id="receipt-refunds"
                    className="text-xs font-medium tracking-wide text-fg-muted uppercase"
                  >
                    Refunded from this payment
                  </h2>
                  <dl className="mt-2 divide-y divide-border">
                    {data.refunds.map((refund) => (
                      <Row
                        key={refund.refundNumber}
                        label={`${refund.refundNumber} · ${formatDateTime(refund.refundedAt, data.timezone)} · ${methodLabel(refund.method)}`}
                      >
                        −{formatMoney(refund.amountMinor, data.currencyCode)}
                      </Row>
                    ))}
                    <Row label="Kept from this payment" strong>
                      {formatMoney(data.amountMinor - refundedMinor, data.currencyCode)}
                    </Row>
                  </dl>
                </section>
              )}

              <footer className="flex flex-col gap-1 pt-6 text-xs text-fg-muted sm:flex-row sm:justify-between">
                <span>{data.recordedByName && `Received by ${data.recordedByName}`}</span>
                <span>Printed {formatDateTime(new Date().toISOString(), data.timezone)}</span>
              </footer>
            </article>
          )
        )}
      </main>
    </div>
  );
}
