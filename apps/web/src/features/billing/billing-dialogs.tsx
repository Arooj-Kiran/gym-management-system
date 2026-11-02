import {
  addDays,
  BILLING_LIMITS,
  COUNTER_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type CounterPaymentMethod,
  type InvoiceDto,
  type PaymentDto,
} from '@gms/shared';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { fullName, useSession } from '../../lib/auth';
import { formatDate, formatDateTime, formatMoney, gymTodayIso } from '../../lib/format';
import { MemberAvatar } from '../members/member-avatar';
import { MemberPicker, type PickedMember } from '../members/member-picker';
import { useCreateInvoice, useRefundPayment, useVoidInvoice } from './billing-api';
import { moneyInputValue, parseMoneyInput } from './billing-format';

type Errors = Partial<Record<string, string>>;

/** Server field errors (400 details) keyed by path; other errors become a toast. */
function serverFieldErrors(error: unknown): Errors | null {
  if (!(error instanceof ApiError) || error.details.length === 0) return null;
  return Object.fromEntries(error.details.map((detail) => [detail.path, detail.message]));
}

function FixedMember({ member }: { member: PickedMember }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface-muted/50 px-3 py-2.5">
      <MemberAvatar member={member} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{fullName(member)}</p>
        <p className="font-mono text-xs text-fg-muted">{member.memberCode}</p>
      </div>
    </div>
  );
}

/**
 * A charge that is not a membership: locker rent, a personal training session, a lost card.
 * Manual charges can always be paid in parts.
 */
export function CreateInvoiceDialog({
  open,
  onOpenChange,
  member: fixedMember,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member?: PickedMember;
}) {
  const { gym } = useSession();
  const today = gymTodayIso();
  const [picked, setPicked] = useState<PickedMember | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(today);
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const create = useCreateInvoice();
  const member = fixedMember ?? picked;
  const earliest = addDays(today, -BILLING_LIMITS.maxDueAdvanceDays);
  const latest = addDays(today, BILLING_LIMITS.maxDueAdvanceDays);

  const amountMinor = parseMoneyInput(amount);
  const errors: Errors = {};
  if (!member) errors.memberId = 'Choose a member.';
  if (description.trim().length < 2) errors.description = 'Describe the charge';
  if (amountMinor === null) errors.amountDueMinor = 'Enter an amount such as 1500 or 1500.50';
  if (!dueDate) errors.dueDate = 'Choose a due date';
  else if (dueDate < earliest || dueDate > latest)
    errors.dueDate = `Choose a date between ${formatDate(earliest)} and ${formatDate(latest)}`;
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const close = (next: boolean) => {
    if (!next) {
      setPicked(null);
      setDescription('');
      setAmount('');
      setDueDate(today);
      setTouched(false);
      setServerErrors({});
    }
    onOpenChange(next);
  };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    if (!member || amountMinor === null || Object.keys(errors).length > 0) return;
    create.mutate(
      {
        memberId: member.id,
        description: description.trim(),
        amountDueMinor: amountMinor,
        dueDate,
      },
      {
        onSuccess: (invoice) => {
          toast.success(
            `${invoice.invoiceNumber} created · ${formatMoney(invoice.amountDueMinor, gym.currencyCode)}`,
          );
          close(false);
        },
        onError: (error) => {
          const fields = serverFieldErrors(error);
          if (fields) setServerErrors(fields);
          else toast.error(errorMessage(error));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="New charge"
      description="Bill a member for something other than their membership. It can be paid in parts."
      busy={create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending}>
            Create invoice
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
        {fixedMember ? (
          <FixedMember member={fixedMember} />
        ) : (
          <>
            <MemberPicker name="invoice-member" selected={picked} onSelect={setPicked} />
            {shown.memberId && (
              <p role="alert" className="-mt-3 text-13 text-danger-text">
                {shown.memberId}
              </p>
            )}
          </>
        )}
        <FormField
          label="Description"
          error={shown.description}
          hint="Printed on the invoice and the receipt, e.g. “Locker rent — November”."
        >
          <Input
            value={description}
            maxLength={BILLING_LIMITS.descriptionMax}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label={`Amount (${gym.currencyCode})`} error={shown.amountDueMinor}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </FormField>
          <FormField label="Due date" error={shown.dueDate}>
            <Input
              type="date"
              value={dueDate}
              min={earliest}
              max={latest}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </FormField>
        </div>
      </form>
    </Dialog>
  );
}

/** Admin/Manager only. Void is for invoices raised by mistake; refund money first. */
export function VoidInvoiceDialog({
  invoice,
  onOpenChange,
}: {
  invoice: InvoiceDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { gym } = useSession();
  const voidInvoice = useVoidInvoice();
  return (
    <ConfirmDialog
      open={invoice !== null}
      onOpenChange={onOpenChange}
      title={`Void ${invoice?.invoiceNumber ?? 'invoice'}?`}
      description="The invoice stays on record marked Void and no longer counts as owed. This cannot be undone."
      confirmLabel="Void invoice"
      tone="danger"
      reason="required"
      reasonLabel="Why is it being voided?"
      loading={voidInvoice.isPending}
      onConfirm={(reason) => {
        if (!invoice || !reason) return;
        voidInvoice.mutate(
          { id: invoice.id, reason },
          {
            onSuccess: (voided) => {
              toast.success(`${voided.invoiceNumber} voided`);
              onOpenChange(false);
            },
            onError: (error) => toast.error(errorMessage(error)),
          },
        );
      }}
    >
      {invoice && (
        <p className="rounded-md bg-surface-muted px-3 py-2.5 text-13 text-fg-secondary">
          {invoice.description} · {formatMoney(invoice.amountDueMinor, gym.currencyCode)} ·{' '}
          {fullName(invoice.member)}
        </p>
      )}
    </ConfirmDialog>
  );
}

/**
 * Admin/Manager only. Returns part or all of a payment; the payment itself is never changed and
 * the refund gets its own number. The server rejects anything above what is left to refund.
 */
export function RefundPaymentDialog({
  payment,
  onOpenChange,
}: {
  payment: PaymentDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { gym } = useSession();
  const currency = gym.currencyCode;
  const refund = useRefundPayment();
  const [forId, setForId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CounterPaymentMethod>('CASH');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});

  // Reset the form for each payment opened.
  if (payment && forId !== payment.id) {
    setForId(payment.id);
    setAmount(moneyInputValue(payment.refundableMinor));
    setMethod(payment.method === 'ONLINE' ? 'CASH' : payment.method);
    setReason('');
    setTouched(false);
    setServerErrors({});
  }

  const close = (next: boolean) => {
    if (!next) setForId(null);
    onOpenChange(next);
  };

  const amountMinor = parseMoneyInput(amount);
  const errors: Errors = {};
  if (amountMinor === null) errors.amountMinor = 'Enter an amount such as 1500 or 1500.50';
  else if (payment && amountMinor > payment.refundableMinor)
    errors.amountMinor = `At most ${formatMoney(payment.refundableMinor, currency)} can be refunded`;
  if (reason.trim().length < 3) errors.reason = 'Give a short reason (at least 3 characters)';
  const shown: Errors = { ...(touched ? errors : {}), ...serverErrors };

  const submit = () => {
    setTouched(true);
    setServerErrors({});
    if (!payment || amountMinor === null || Object.keys(errors).length > 0) return;
    refund.mutate(
      { paymentId: payment.id, amountMinor, method, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(
            `${formatMoney(amountMinor, currency)} refunded from ${payment.receiptNumber}`,
          );
          close(false);
        },
        onError: (error) => {
          const fields = serverFieldErrors(error);
          if (fields) setServerErrors(fields);
          else if (error instanceof ApiError && error.code === 'REFUND_EXCEEDS_PAYMENT')
            setServerErrors({ amountMinor: error.message });
          else toast.error(errorMessage(error));
        },
      },
    );
  };

  return (
    <Dialog
      open={payment !== null}
      onOpenChange={close}
      title={`Refund ${payment?.receiptNumber ?? 'payment'}`}
      description={
        payment
          ? `${fullName(payment.member)} paid ${formatMoney(payment.amountMinor, currency)} on ${formatDateTime(payment.receivedAt)}.`
          : undefined
      }
      size="sm"
      busy={refund.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={refund.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={refund.isPending}>
            {amountMinor ? `Refund ${formatMoney(amountMinor, currency)}` : 'Refund'}
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
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-md border border-warning-text/25 bg-warning-subtle px-3 py-2.5 text-13 text-warning-text"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Hand the money back before confirming. A refund cannot be edited or deleted, and the
            invoice balance goes up by the same amount.
          </p>
        </div>
        <FormField
          label={`Amount (${currency})`}
          error={shown.amountMinor}
          hint={
            payment
              ? `Up to ${formatMoney(payment.refundableMinor, currency)}${payment.refundedMinor > 0 ? ` (${formatMoney(payment.refundedMinor, currency)} already refunded)` : ''}.`
              : undefined
          }
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </FormField>
        <FormField label="Returned by" error={shown.method}>
          <Select
            value={method}
            onChange={(event) => setMethod(event.target.value as CounterPaymentMethod)}
          >
            {COUNTER_PAYMENT_METHODS.map((choice) => (
              <option key={choice} value={choice}>
                {PAYMENT_METHOD_LABELS[choice]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Reason" error={shown.reason} hint="Saved in the audit log.">
          <Textarea
            value={reason}
            maxLength={500}
            rows={2}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </form>
    </Dialog>
  );
}
