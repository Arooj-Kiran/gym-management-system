import {
  BILLING_LIMITS,
  PAYMENT_METHOD_LABELS,
  paymentReferenceRequired,
  type InvoiceDto,
  type PaymentMethod,
} from '@gms/shared';
import { FileWarning, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Textarea } from '../../components/ui/form-field';
import { ListSkeleton } from '../../components/ui/states';
import { fullName, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import {
  formatDate,
  formatMoney,
  gymDateTimeInputToIso,
  toGymDateTimeInput,
} from '../../lib/format';
import { MemberAvatar } from '../members/member-avatar';
import { MemberPicker, type PickedMember } from '../members/member-picker';
import { useInvoice, useMemberInvoices, useRecordPayment } from './billing-api';
import { isOpenInvoice, moneyInputValue, openReceipt, parseMoneyInput } from './billing-format';
import { InvoiceStatusBadge } from './invoice-status-badge';

/** Order of the method choices at the counter. Online is listed but cannot be chosen (D8). */
const METHOD_CHOICES: PaymentMethod[] = ['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER', 'ONLINE'];

type FieldName = 'amountMinor' | 'method' | 'reference' | 'receivedAt' | 'notes';
type FieldErrors = Partial<Record<FieldName, string>>;

/** The invoice being paid: its numbers and the rule for partial amounts. */
function InvoiceFacts({ invoice, currency }: { invoice: InvoiceDto; currency: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted/50 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-13 font-medium text-fg">{invoice.invoiceNumber}</span>
        <InvoiceStatusBadge status={invoice.status} />
        <span className="ml-auto text-xs text-fg-muted">Due {formatDate(invoice.dueDate)}</span>
      </div>
      <p className="mt-1 truncate text-13 text-fg-secondary">{invoice.description}</p>
      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 text-13">
        <div>
          <dt className="text-xs text-fg-muted">Amount</dt>
          <dd className="font-medium text-fg tabular-nums">
            {formatMoney(invoice.amountDueMinor, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Paid</dt>
          <dd className="font-medium text-fg tabular-nums">
            {formatMoney(invoice.paidMinor - invoice.refundedMinor, currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">Balance</dt>
          <dd className="font-semibold text-fg tabular-nums">
            {formatMoney(invoice.balanceMinor, currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** A member's open invoices as a radio list, newest first. */
function OpenInvoiceChoice({
  memberId,
  selectedId,
  onSelect,
  currency,
}: {
  memberId: string;
  selectedId: string | null;
  onSelect: (invoice: InvoiceDto) => void;
  currency: string;
}) {
  const list = useMemberInvoices(memberId, { pageSize: 100 });
  const open = list.data?.data.filter((invoice) => isOpenInvoice(invoice.status)) ?? [];

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-13 font-medium text-fg">Invoice</legend>
      <div className="max-h-56 overflow-y-auto rounded-md border border-border">
        {list.isPending ? (
          <ListSkeleton rows={2} label="Loading invoices" />
        ) : list.isError ? (
          <p role="alert" className="px-3 py-4 text-13 text-danger-text">
            {errorMessage(list.error)}
          </p>
        ) : open.length === 0 ? (
          <p className="flex items-center gap-2 px-3 py-4 text-13 text-fg-muted">
            <FileWarning className="size-4" aria-hidden /> Nothing is owed. Create a charge from the
            member’s Payments tab first.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {open.map((invoice) => {
              const checked = invoice.id === selectedId;
              return (
                <li key={invoice.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-hover has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-focus',
                      checked && 'bg-primary-subtle hover:bg-primary-subtle',
                    )}
                  >
                    <input
                      type="radio"
                      name="payment-invoice"
                      className="sr-only"
                      checked={checked}
                      onChange={() => onSelect(invoice)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {invoice.description}
                      </span>
                      <span className="block truncate font-mono text-xs text-fg-muted">
                        {invoice.invoiceNumber} · due {formatDate(invoice.dueDate)}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-13 font-semibold text-fg tabular-nums">
                        {formatMoney(invoice.balanceMinor, currency)}
                      </span>
                      <InvoiceStatusBadge status={invoice.status} />
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Record money taken at the counter (cash, card terminal, bank transfer). The server decides
 * whether the amount is acceptable (balance, the plan's partial-payment rule) inside a locked
 * transaction; the checks here only save a round trip.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceId: fixedInvoiceId,
  member: fixedMember,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pay this invoice (invoice rows, membership cards). */
  invoiceId?: string;
  /** Choose among this member's open invoices (member page). Otherwise staff search. */
  member?: PickedMember;
}) {
  const { gym } = useSession();
  const currency = gym.currencyCode;
  const [pickedMember, setPickedMember] = useState<PickedMember | null>(null);
  const [pickedInvoice, setPickedInvoice] = useState<InvoiceDto | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const record = useRecordPayment();

  const fixed = useInvoice(open && fixedInvoiceId ? fixedInvoiceId : null);
  const invoice = fixedInvoiceId ? (fixed.data ?? null) : pickedInvoice;
  const member = fixedMember ?? pickedMember;

  const chooseInvoice = (next: InvoiceDto | null) => {
    setPickedInvoice(next);
    setAmount(next ? moneyInputValue(next.balanceMinor) : '');
    setServerErrors({});
  };

  // Prefill the full balance once the fixed invoice arrives.
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  if (fixed.data && prefilledFor !== fixed.data.id) {
    setPrefilledFor(fixed.data.id);
    setAmount(moneyInputValue(fixed.data.balanceMinor));
  }

  const close = (next: boolean) => {
    if (!next) {
      setPickedMember(null);
      setPickedInvoice(null);
      setAmount('');
      setMethod('CASH');
      setReference('');
      setReceivedAt('');
      setNotes('');
      setTouched(false);
      setServerErrors({});
      setPrefilledFor(null);
    }
    onOpenChange(next);
  };

  const amountMinor = parseMoneyInput(amount);
  const nowInput = toGymDateTimeInput(new Date().toISOString());
  const errors: FieldErrors = {};
  if (invoice) {
    if (amountMinor === null) errors.amountMinor = 'Enter an amount such as 4500 or 4500.50';
    else if (amountMinor > invoice.balanceMinor)
      errors.amountMinor = `More than the balance of ${formatMoney(invoice.balanceMinor, currency)}`;
    else if (!invoice.allowPartialPayment && amountMinor < invoice.balanceMinor)
      errors.amountMinor = `This plan is paid in full: ${formatMoney(invoice.balanceMinor, currency)}`;
  }
  if (paymentReferenceRequired(method) && !reference.trim())
    errors.reference =
      method === 'CARD' ? 'Enter the card terminal reference' : 'Enter the bank transfer reference';
  if (receivedAt && receivedAt > nowInput) errors.receivedAt = 'Cannot be in the future';
  const shown: FieldErrors = { ...(touched ? errors : {}), ...serverErrors };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    if (!invoice || amountMinor === null || Object.keys(errors).length > 0) return;
    record.mutate(
      {
        invoiceId: invoice.id,
        amountMinor,
        method,
        reference: reference.trim() || undefined,
        receivedAt: receivedAt ? gymDateTimeInputToIso(receivedAt) : undefined,
        notes: notes.trim() || undefined,
      },
      {
        onSuccess: (payment) => {
          toast.success(
            `${formatMoney(payment.amountMinor, currency)} received · ${payment.receiptNumber}`,
            {
              action: {
                label: 'Receipt',
                onClick: () => openReceipt(payment.id),
              },
            },
          );
          close(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.details.length > 0) {
            const next: FieldErrors = {};
            for (const detail of error.details) next[detail.path as FieldName] = detail.message;
            setServerErrors(next);
          } else if (error instanceof ApiError && error.code === 'OVERPAYMENT') {
            setServerErrors({ amountMinor: error.message });
          } else if (error instanceof ApiError && error.code === 'PARTIAL_PAYMENT_NOT_ALLOWED') {
            setServerErrors({ amountMinor: error.message });
          } else {
            toast.error(errorMessage(error));
          }
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Record payment"
      description="Money received at the counter. A numbered receipt is issued straight away."
      busy={record.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={record.isPending}
            disabled={!invoice}
            icon={<ReceiptText aria-hidden />}
          >
            Record payment
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {fixedInvoiceId ? (
          fixed.isPending ? (
            <ListSkeleton rows={1} label="Loading invoice" />
          ) : fixed.isError ? (
            <p role="alert" className="text-13 text-danger-text">
              {errorMessage(fixed.error)}
            </p>
          ) : null
        ) : (
          <>
            {fixedMember ? (
              <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted/50 px-3 py-2.5">
                <MemberAvatar member={fixedMember} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-fg">{fullName(fixedMember)}</p>
                  <p className="font-mono text-xs text-fg-muted">{fixedMember.memberCode}</p>
                </div>
              </div>
            ) : (
              <MemberPicker
                name="payment-member"
                selected={pickedMember}
                onSelect={(next) => {
                  setPickedMember(next);
                  chooseInvoice(null);
                }}
              />
            )}
            {member && (
              <OpenInvoiceChoice
                memberId={member.id}
                selectedId={pickedInvoice?.id ?? null}
                onSelect={chooseInvoice}
                currency={currency}
              />
            )}
            {touched && !invoice && (
              <p role="alert" className="-mt-3 text-13 text-danger-text">
                {member ? 'Choose the invoice being paid.' : 'Choose a member.'}
              </p>
            )}
          </>
        )}

        {invoice && fixedInvoiceId && <InvoiceFacts invoice={invoice} currency={currency} />}

        {invoice && !isOpenInvoice(invoice.status) ? (
          <p
            role="status"
            className="rounded-md bg-surface-muted px-3 py-2.5 text-13 text-fg-secondary"
          >
            Nothing is owed on this invoice.
          </p>
        ) : (
          invoice && (
            <>
              <FormField
                label={`Amount (${currency})`}
                error={shown.amountMinor}
                hint={
                  invoice.allowPartialPayment
                    ? `Up to ${formatMoney(invoice.balanceMinor, currency)}. A smaller amount leaves the rest owing.`
                    : 'This plan does not allow part payments — take the full balance.'
                }
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </FormField>

              <fieldset>
                <legend className="mb-1.5 text-13 font-medium text-fg">Method</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {METHOD_CHOICES.map((choice) => {
                    const online = choice === 'ONLINE';
                    const checked = method === choice;
                    return (
                      <label
                        key={choice}
                        className={cn(
                          'flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-13 transition-colors duration-150',
                          'has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-focus',
                          online
                            ? 'col-span-2 cursor-not-allowed border-dashed border-border text-fg-muted sm:col-span-2'
                            : 'cursor-pointer border-border-strong text-fg hover:bg-surface-hover',
                          checked && 'border-primary bg-primary-subtle hover:bg-primary-subtle',
                        )}
                      >
                        <input
                          type="radio"
                          name="payment-method"
                          className="size-3.5 accent-primary"
                          checked={checked}
                          disabled={online}
                          onChange={() => setMethod(choice)}
                        />
                        <span className="font-medium">{PAYMENT_METHOD_LABELS[choice]}</span>
                        {online && (
                          <span className="ml-auto">
                            <Badge tone="warning">Requires configuration</Badge>
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <FormField
                label="Reference"
                optional={!paymentReferenceRequired(method)}
                error={shown.reference}
                hint={
                  method === 'CARD'
                    ? 'The approval code on the card terminal slip.'
                    : method === 'BANK_TRANSFER'
                      ? 'The transaction ID from the bank or app.'
                      : 'Anything that helps find this payment later.'
                }
              >
                <Input
                  value={reference}
                  maxLength={BILLING_LIMITS.referenceMax}
                  autoComplete="off"
                  onChange={(event) => setReference(event.target.value)}
                />
              </FormField>

              <FormField
                label="Received at"
                optional
                error={shown.receivedAt}
                hint="Leave empty for now. Set it when entering a payment taken earlier."
              >
                <Input
                  type="datetime-local"
                  value={receivedAt}
                  max={nowInput}
                  onChange={(event) => setReceivedAt(event.target.value)}
                />
              </FormField>

              <FormField
                label="Notes"
                optional
                error={shown.notes}
                hint="Staff only; not printed on the receipt."
              >
                <Textarea
                  value={notes}
                  maxLength={BILLING_LIMITS.notesMax}
                  rows={2}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </>
          )
        )}
      </form>
    </Dialog>
  );
}
