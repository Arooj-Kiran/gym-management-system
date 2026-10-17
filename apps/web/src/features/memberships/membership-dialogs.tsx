import { zodResolver } from '@hookform/resolvers/zod';
import {
  addDays,
  assignMembershipSchema,
  computeEndDate,
  extendMembershipSchema,
  MEMBERSHIP_LIMITS,
  reactivateMembershipSchema,
  renewalStartDate,
  renewMembershipSchema,
  suspendedDays,
  type MembershipDto,
  type PlanDto,
} from '@gms/shared';
import type { ReactNode } from 'react';
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { Skeleton } from '../../components/ui/states';
import { fullName, useSession } from '../../lib/auth';
import { formatDate, formatMoney, gymTodayIso } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { planDuration } from '../plans/plan-format';
import { usePlanList } from '../plans/plans-api';
import { gymDateOf, plural } from './membership-format';
import {
  useAssignMembership,
  useExtendMembership,
  useReactivateMembership,
  useRenewMembership,
} from './memberships-api';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Plans that can be assigned today, cheapest first. */
const useAssignablePlans = (enabled: boolean) =>
  usePlanList({ status: 'active', pageSize: 100, sort: 'price', order: 'asc' }, enabled);

function PlanOptions({ plans, currency }: { plans: PlanDto[]; currency: string }) {
  return plans.map((plan) => (
    <option key={plan.id} value={plan.id}>
      {plan.name} · {planDuration(plan)} · {formatMoney(plan.priceMinor, currency)}
    </option>
  ));
}

/** "1 Mar 2027 – 31 Mar 2027 · PKR 6,000": what the member gets, before it is saved. */
function PeriodPreview({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted/60 px-3.5 py-3">
      <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">{title}</p>
      <p className="mt-1 text-sm text-fg tabular-nums">{children}</p>
    </div>
  );
}

function ReasonField({
  error,
  optional,
  inputProps,
}: {
  error?: string;
  optional?: boolean;
  inputProps: UseFormRegisterReturn;
}) {
  return (
    <FormField label="Reason" optional={optional} error={error} hint="Saved in the history.">
      <Textarea rows={3} maxLength={500} {...inputProps} />
    </FormField>
  );
}

function DialogFooter({
  formId,
  label,
  busy,
  onCancel,
  disabled,
}: {
  formId: string;
  label: string;
  busy: boolean;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={busy} disabled={disabled}>
        {label}
      </Button>
    </>
  );
}

// --- Assign ---------------------------------------------------------------------------------

type AssignInput = z.input<typeof assignMembershipSchema>;
type AssignOutput = z.output<typeof assignMembershipSchema>;
const ASSIGN_FORM_ID = 'assign-membership-form';

export function AssignMembershipDialog({
  member,
  latestCurrentEndDate,
  open,
  onOpenChange,
}: DialogProps & {
  member: { id: string; firstName: string; lastName: string };
  /** End of the member's latest pending/active/suspended period: the new one starts after it. */
  latestCurrentEndDate: string | null;
}) {
  const { gym } = useSession();
  const today = gymTodayIso();
  const plans = useAssignablePlans(open);
  const assign = useAssignMembership();
  const defaults = {
    memberId: member.id,
    planId: '',
    startDate: renewalStartDate(latestCurrentEndDate, today),
  };
  const form = useForm<AssignInput, unknown, AssignOutput>({
    resolver: zodResolver(assignMembershipSchema),
    defaultValues: defaults,
  });
  const [planId, startDate] = useWatch({ control: form.control, name: ['planId', 'startDate'] });
  const plan = plans.data?.data.find((item) => item.id === planId);
  const validStart = typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate);

  const close = (next: boolean) => {
    if (!next) form.reset(defaults);
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    assign.mutate(values, {
      onSuccess: (membership) => {
        toast.success(`${membership.planName} assigned to ${fullName(member)}`, {
          description: 'It is pending until you activate it.',
        });
        close(false);
      },
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, ['planId', 'startDate']))
          toast.error(errorMessage(error));
      },
    }),
  );

  const { errors } = form.formState;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Assign a membership to ${fullName(member)}`}
      description="The plan's price, duration and access hours are copied onto the membership. It starts as pending; activate it once the member is ready to train."
      busy={assign.isPending}
      footer={
        <DialogFooter
          formId={ASSIGN_FORM_ID}
          label="Assign membership"
          busy={assign.isPending}
          onCancel={() => close(false)}
          disabled={!plans.data || plans.data.data.length === 0}
        />
      }
    >
      <form id={ASSIGN_FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {plans.isPending ? (
          <Skeleton className="h-16" />
        ) : plans.isError ? (
          <p role="alert" className="text-13 text-danger-text">
            Plans could not be loaded: {errorMessage(plans.error)}
          </p>
        ) : plans.data.data.length === 0 ? (
          <p className="text-13 text-fg-secondary">
            There are no active plans. A Manager or Admin needs to create one first.
          </p>
        ) : (
          <FormField label="Plan" error={errors.planId?.message}>
            <Select {...form.register('planId')}>
              <option value="">Choose a plan</option>
              <PlanOptions plans={plans.data.data} currency={gym.currencyCode} />
            </Select>
          </FormField>
        )}
        <FormField
          label="Start date"
          error={errors.startDate?.message}
          hint={
            latestCurrentEndDate && latestCurrentEndDate >= today
              ? `Their current membership runs until ${formatDate(latestCurrentEndDate)}.`
              : `Up to ${MEMBERSHIP_LIMITS.maxBackdateDays} days back or a year ahead.`
          }
        >
          <Input
            type="date"
            min={addDays(today, -MEMBERSHIP_LIMITS.maxBackdateDays)}
            max={addDays(today, MEMBERSHIP_LIMITS.maxAdvanceDays)}
            {...form.register('startDate')}
          />
        </FormField>
        {plan && validStart && (
          <PeriodPreview title="Membership period">
            {formatDate(startDate)} –{' '}
            {formatDate(computeEndDate(startDate, plan.durationValue, plan.durationUnit))}
            <span className="text-fg-muted">
              {' '}
              · {formatMoney(plan.priceMinor, gym.currencyCode)}
            </span>
          </PeriodPreview>
        )}
      </form>
    </Dialog>
  );
}

// --- Renew ----------------------------------------------------------------------------------

type RenewInput = z.input<typeof renewMembershipSchema>;
type RenewOutput = z.output<typeof renewMembershipSchema>;
const RENEW_FORM_ID = 'renew-membership-form';

export function RenewMembershipDialog({
  membership,
  memberName,
  latestCurrentEndDate,
  open,
  onOpenChange,
}: DialogProps & {
  membership: MembershipDto;
  memberName: string;
  latestCurrentEndDate: string | null;
}) {
  const { gym } = useSession();
  const today = gymTodayIso();
  const plans = useAssignablePlans(open);
  const renew = useRenewMembership();
  const samePlanActive = plans.data?.data.some((plan) => plan.id === membership.planId);
  const defaults = {
    planId: membership.planId,
    reason: '',
  };
  const form = useForm<RenewInput, unknown, RenewOutput>({
    resolver: zodResolver(renewMembershipSchema),
    defaultValues: defaults,
  });
  const planId = useWatch({ control: form.control, name: 'planId' });
  const plan = plans.data?.data.find((item) => item.id === planId);
  const startDate = renewalStartDate(latestCurrentEndDate, today);

  const close = (next: boolean) => {
    if (!next) form.reset(defaults);
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    renew.mutate(
      {
        id: membership.id,
        ...values,
        reason: values.reason || undefined,
        version: membership.version,
      },
      {
        onSuccess: (renewed) => {
          toast.success(`Membership renewed for ${memberName}`, {
            description: `${renewed.planName}, ${formatDate(renewed.startDate)} – ${formatDate(renewed.endDate)}.`,
          });
          close(false);
        },
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, ['planId', 'reason']))
            toast.error(errorMessage(error));
        },
      },
    ),
  );

  const { errors } = form.formState;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Renew ${memberName}'s membership`}
      description="A new period is added after the current one and is active straight away. The current period and its history are not changed."
      busy={renew.isPending}
      footer={
        <DialogFooter
          formId={RENEW_FORM_ID}
          label="Renew membership"
          busy={renew.isPending}
          onCancel={() => close(false)}
          disabled={!plan}
        />
      }
    >
      <form id={RENEW_FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {plans.isPending ? (
          <Skeleton className="h-16" />
        ) : plans.isError ? (
          <p role="alert" className="text-13 text-danger-text">
            Plans could not be loaded: {errorMessage(plans.error)}
          </p>
        ) : (
          <FormField
            label="Plan"
            error={errors.planId?.message}
            hint={
              samePlanActive
                ? 'Defaults to the current plan at today’s price.'
                : `${membership.planName} is no longer offered; choose another plan.`
            }
          >
            <Select {...form.register('planId')}>
              {!samePlanActive && (
                <option value={membership.planId} disabled>
                  Choose a plan
                </option>
              )}
              <PlanOptions plans={plans.data.data} currency={gym.currencyCode} />
            </Select>
          </FormField>
        )}
        {plan && (
          <PeriodPreview title="New period">
            {formatDate(startDate)} –{' '}
            {formatDate(computeEndDate(startDate, plan.durationValue, plan.durationUnit))}
            <span className="text-fg-muted">
              {' '}
              · {formatMoney(plan.priceMinor, gym.currencyCode)}
            </span>
          </PeriodPreview>
        )}
        <ReasonField optional error={errors.reason?.message} inputProps={form.register('reason')} />
      </form>
    </Dialog>
  );
}

// --- Extend ---------------------------------------------------------------------------------

type ExtendInput = z.input<typeof extendMembershipSchema>;
type ExtendOutput = z.output<typeof extendMembershipSchema>;
const EXTEND_FORM_ID = 'extend-membership-form';

export function ExtendMembershipDialog({
  membership,
  memberName,
  open,
  onOpenChange,
}: DialogProps & { membership: MembershipDto; memberName: string }) {
  const extend = useExtendMembership();
  const defaults = { days: 7, reason: '' };
  const form = useForm<ExtendInput, unknown, ExtendOutput>({
    resolver: zodResolver(extendMembershipSchema),
    defaultValues: defaults,
  });
  const days = useWatch({ control: form.control, name: 'days' });
  const validDays = Number.isInteger(days) && days >= 1 && days <= MEMBERSHIP_LIMITS.maxExtendDays;

  const close = (next: boolean) => {
    if (!next) form.reset(defaults);
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    extend.mutate(
      { id: membership.id, ...values, version: membership.version },
      {
        onSuccess: (updated) => {
          toast.success(`Membership extended for ${memberName}`, {
            description: `It now ends on ${formatDate(updated.endDate)}.`,
          });
          close(false);
        },
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, ['days', 'reason']))
            toast.error(errorMessage(error));
        },
      },
    ),
  );

  const { errors } = form.formState;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Extend ${memberName}'s membership`}
      description={`Adds days to ${membership.planName}, which currently ends on ${formatDate(membership.endDate)}.`}
      size="sm"
      busy={extend.isPending}
      footer={
        <DialogFooter
          formId={EXTEND_FORM_ID}
          label="Extend membership"
          busy={extend.isPending}
          onCancel={() => close(false)}
        />
      }
    >
      <form id={EXTEND_FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormField
          label="Days to add"
          error={errors.days?.message}
          hint={`Between 1 and ${MEMBERSHIP_LIMITS.maxExtendDays}.`}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={MEMBERSHIP_LIMITS.maxExtendDays}
            step={1}
            {...form.register('days', { valueAsNumber: true })}
          />
        </FormField>
        {validDays && (
          <PeriodPreview title="New end date">
            {formatDate(addDays(membership.endDate, days))}
          </PeriodPreview>
        )}
        <ReasonField error={errors.reason?.message} inputProps={form.register('reason')} />
      </form>
    </Dialog>
  );
}

// --- Reactivate -----------------------------------------------------------------------------

type ReactivateInput = z.input<typeof reactivateMembershipSchema>;
type ReactivateOutput = z.output<typeof reactivateMembershipSchema>;
const REACTIVATE_FORM_ID = 'reactivate-membership-form';

export function ReactivateMembershipDialog({
  membership,
  memberName,
  open,
  onOpenChange,
}: DialogProps & { membership: MembershipDto; memberName: string }) {
  const reactivate = useReactivateMembership();
  const today = gymTodayIso();
  const lost = membership.suspendedAt ? suspendedDays(gymDateOf(membership.suspendedAt), today) : 0;
  const defaults = { extendBySuspendedDays: lost > 0, reason: '' };
  const form = useForm<ReactivateInput, unknown, ReactivateOutput>({
    resolver: zodResolver(reactivateMembershipSchema),
    defaultValues: defaults,
  });
  const extending = useWatch({ control: form.control, name: 'extendBySuspendedDays' });

  const close = (next: boolean) => {
    if (!next) form.reset(defaults);
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    reactivate.mutate(
      { id: membership.id, ...values, version: membership.version },
      {
        onSuccess: (updated) => {
          toast.success(`Membership reactivated for ${memberName}`, {
            description: `It ends on ${formatDate(updated.endDate)}.`,
          });
          close(false);
        },
        onError: (error) => {
          if (!applyServerErrors(error, form.setError, ['reason']))
            toast.error(errorMessage(error));
        },
      },
    ),
  );

  const { errors } = form.formState;
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={`Reactivate ${memberName}'s membership?`}
      description={
        membership.suspendedAt
          ? `Suspended since ${formatDate(gymDateOf(membership.suspendedAt))} (${plural(lost, 'day')}).`
          : undefined
      }
      size="sm"
      busy={reactivate.isPending}
      footer={
        <DialogFooter
          formId={REACTIVATE_FORM_ID}
          label="Reactivate"
          busy={reactivate.isPending}
          onCancel={() => close(false)}
        />
      }
    >
      <form id={REACTIVATE_FORM_ID} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg">
          <input
            type="checkbox"
            className="mt-0.5 size-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
            disabled={lost === 0}
            {...form.register('extendBySuspendedDays')}
          />
          <span>
            Add the {plural(lost, 'suspended day')} to the end date
            <span className="block text-13 text-fg-muted">
              {extending && lost > 0
                ? `Ends on ${formatDate(addDays(membership.endDate, lost))} instead of ${formatDate(membership.endDate)}.`
                : `Keeps the end date of ${formatDate(membership.endDate)}.`}
            </span>
          </span>
        </label>
        <ReasonField error={errors.reason?.message} inputProps={form.register('reason')} />
      </form>
    </Dialog>
  );
}
