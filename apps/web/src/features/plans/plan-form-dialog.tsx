import {
  createPlanSchema,
  DURATION_UNITS,
  FIXED_PLAN_MONTHS,
  PLAN_MAX_BENEFITS,
  PLAN_TYPE_LABELS,
  PLAN_TYPES,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type DurationUnit,
  type PlanDto,
  type PlanType,
} from '@gms/shared';
import { Plus, X } from 'lucide-react';
import { useFieldArray, useForm, useWatch, type FieldErrors, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ApiError, errorMessage } from '../../api/client';
import { Button, IconButton } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { useCreatePlan, useUpdatePlan } from './plans-api';

interface PlanFormValues {
  name: string;
  planType: PlanType;
  durationValue: string;
  durationUnit: DurationUnit;
  /** Major units as typed, e.g. "6000" or "6,000.50". */
  price: string;
  description: string;
  benefits: { value: string }[];
  allowPartialPayment: boolean;
  accessDays: number[];
  accessStartTime: string;
  accessEndTime: string;
}

type PlanOutput = z.output<typeof createPlanSchema>;

const FORM_ID = 'plan-form';
const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

function planFormValues(plan?: PlanDto): PlanFormValues {
  return {
    name: plan?.name ?? '',
    planType: plan?.planType ?? 'MONTHLY',
    durationValue: plan?.planType === 'CUSTOM' ? String(plan.durationValue) : '',
    durationUnit: plan?.planType === 'CUSTOM' ? plan.durationUnit : 'DAY',
    price: plan ? String(plan.priceMinor / 100) : '',
    description: plan?.description ?? '',
    benefits: (plan?.benefits ?? []).map((value) => ({ value })),
    allowPartialPayment: plan?.allowPartialPayment ?? false,
    accessDays: plan?.accessDays ?? [...WEEKDAYS],
    accessStartTime: plan?.accessStartTime ?? '',
    accessEndTime: plan?.accessEndTime ?? '',
  };
}

/** Form text → API shape. Unparseable numbers become NaN so the shared schema rejects them. */
function toInput(values: PlanFormValues) {
  const benefits = values.benefits.map((benefit) => benefit.value.trim());
  const kept = benefits.flatMap((benefit, index) => (benefit ? [index] : []));
  const price = values.price.replace(/[,\s]/g, '');
  const custom = values.planType === 'CUSTOM';
  return {
    kept,
    priceValid: PRICE_PATTERN.test(price),
    input: {
      name: values.name,
      planType: values.planType,
      durationValue: custom
        ? /^\d+$/.test(values.durationValue.trim())
          ? Number(values.durationValue)
          : Number.NaN
        : undefined,
      durationUnit: custom ? values.durationUnit : undefined,
      priceMinor: PRICE_PATTERN.test(price) ? Math.round(Number(price) * 100) : 0,
      description: values.description,
      benefits: kept.map((index) => benefits[index]!),
      allowPartialPayment: values.allowPartialPayment,
      accessDays: values.accessDays.length === 7 ? null : values.accessDays,
      accessStartTime: values.accessStartTime,
      accessEndTime: values.accessEndTime,
    },
  };
}

/** Maps an API/schema path to the form field that shows it. */
function formPath(path: string, kept: number[]): string {
  if (path === 'priceMinor') return 'price';
  const benefit = /^benefits\.(\d+)$/.exec(path);
  if (benefit) return `benefits.${kept[Number(benefit[1])] ?? 0}.value`;
  return path;
}

function addError(errors: Record<string, unknown>, path: string, message: string) {
  const parts = path.split('.');
  let node = errors;
  parts.slice(0, -1).forEach((part, index) => {
    const nextIsIndex = /^\d+$/.test(parts[index + 1]!);
    node[part] ??= nextIsIndex ? [] : {};
    node = node[part] as Record<string, unknown>;
  });
  node[parts.at(-1)!] ??= { type: 'validate', message };
}

/** Validates with the shared plan schema so the browser and the server agree on every rule. */
const planResolver: Resolver<PlanFormValues, unknown, PlanOutput> = (values) => {
  const { input, kept, priceValid } = toInput(values);
  const errors: Record<string, unknown> = {};
  if (!priceValid) addError(errors, 'price', 'Enter a price such as 6000 or 6000.50');
  if (values.accessDays.length === 0)
    addError(errors, 'accessDays', 'Pick at least one day, or allow every day');
  const result = createPlanSchema.safeParse(input);
  if (!result.success) {
    for (const issue of result.error.issues) {
      addError(errors, formPath(issue.path.join('.') || 'name', kept), issue.message);
    }
  }
  if (Object.keys(errors).length > 0 || !result.success) {
    return { values: {}, errors: errors as FieldErrors<PlanFormValues> };
  }
  return { values: result.data, errors: {} };
};

const SERVER_FIELDS = [
  'name',
  'planType',
  'durationValue',
  'durationUnit',
  'priceMinor',
  'description',
  'accessDays',
  'accessStartTime',
  'accessEndTime',
];

export function PlanFormDialog({
  plan,
  open,
  onOpenChange,
}: {
  /** Edit this plan; omit to create a new one. */
  plan?: PlanDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { gym } = useSession();
  const create = useCreatePlan();
  const update = useUpdatePlan();
  const saving = create.isPending || update.isPending;
  const form = useForm<PlanFormValues, unknown, PlanOutput>({
    resolver: planResolver,
    defaultValues: planFormValues(plan),
  });
  const { errors } = form.formState;
  const benefits = useFieldArray({ control: form.control, name: 'benefits' });
  const [planType, accessDays] = useWatch({
    control: form.control,
    name: ['planType', 'accessDays'],
  });

  const close = (next: boolean) => {
    if (!next) form.reset(planFormValues(plan));
    onOpenChange(next);
  };

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'DUPLICATE_PLAN_NAME') {
      form.setError('name', { type: 'server', message: error.message }, { shouldFocus: true });
      return;
    }
    let applied = false;
    if (error instanceof ApiError) {
      for (const detail of error.details) {
        if (!SERVER_FIELDS.includes(detail.path)) continue;
        form.setError(
          formPath(detail.path, []) as keyof PlanFormValues,
          { type: 'server', message: detail.message },
          { shouldFocus: !applied },
        );
        applied = true;
      }
    }
    if (!applied) toast.error(errorMessage(error));
  };

  const submit = form.handleSubmit((values) => {
    const onSuccess = (saved: PlanDto) => {
      toast.success(plan ? `${saved.name} saved` : `${saved.name} created`);
      onOpenChange(false);
      form.reset(planFormValues(plan ? saved : undefined));
    };
    if (plan) update.mutate({ id: plan.id, input: values }, { onSuccess, onError });
    else create.mutate(values, { onSuccess, onError });
  });

  const toggleDay = (day: number) => {
    const next = accessDays.includes(day)
      ? accessDays.filter((value) => value !== day)
      : [...accessDays, day].sort((a, b) => a - b);
    form.setValue('accessDays', next, {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={plan ? `Edit ${plan.name}` : 'New membership plan'}
      description={
        plan
          ? 'Changes apply to new memberships. Existing memberships keep the terms they were sold with.'
          : 'Members see active plans in the portal.'
      }
      size="lg"
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
            {plan ? 'Save plan' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={submit}
        noValidate
        aria-label={plan ? 'Edit plan' : 'New plan'}
        className="flex flex-col gap-6"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Plan name" error={errors.name?.message} className="sm:col-span-2">
            <Input
              autoComplete="off"
              placeholder="e.g. Quarterly Standard"
              {...form.register('name')}
            />
          </FormField>
          <FormField label="Plan type" error={errors.planType?.message}>
            <Select {...form.register('planType')}>
              {PLAN_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PLAN_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </FormField>
          {planType === 'CUSTOM' ? (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <FormField label="Duration" error={errors.durationValue?.message}>
                <Input inputMode="numeric" autoComplete="off" {...form.register('durationValue')} />
              </FormField>
              <FormField label="Unit" error={errors.durationUnit?.message}>
                <Select {...form.register('durationUnit')}>
                  {DURATION_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit === 'DAY' ? 'Days' : 'Months'}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <span className="text-13 font-medium text-fg">Duration</span>
              <p className="flex h-10 items-center rounded-md bg-surface-muted px-3 text-sm text-fg-secondary">
                {FIXED_PLAN_MONTHS[planType]} month{FIXED_PLAN_MONTHS[planType] === 1 ? '' : 's'}
              </p>
              <p className="text-13 text-fg-muted">Fixed for this plan type.</p>
            </div>
          )}
          <FormField
            label={`Price (${gym.currencyCode})`}
            error={errors.price?.message}
            hint="Full price of one membership period."
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              placeholder="6000"
              {...form.register('price')}
            />
          </FormField>
          <div className="flex flex-col gap-1.5 sm:pt-7">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-fg">
              <input
                type="checkbox"
                className="mt-0.5 size-4 cursor-pointer accent-primary"
                {...form.register('allowPartialPayment')}
              />
              <span>
                Allow partial payment
                <span className="block text-13 text-fg-muted">
                  The membership can start before it is paid in full.
                </span>
              </span>
            </label>
          </div>
          <FormField
            label="Description"
            optional
            error={errors.description?.message}
            className="sm:col-span-2"
          >
            <Textarea rows={2} maxLength={2000} {...form.register('description')} />
          </FormField>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Benefits
          </legend>
          {benefits.fields.length === 0 && (
            <p className="text-13 text-fg-muted">No benefits listed. Add what the plan includes.</p>
          )}
          <ul className="flex flex-col gap-2">
            {benefits.fields.map((field, index) => (
              <li key={field.id} className="flex items-start gap-2">
                <FormField
                  label={`Benefit ${index + 1}`}
                  error={errors.benefits?.[index]?.value?.message}
                  className="flex-1 [&>label]:sr-only"
                >
                  <Input
                    autoComplete="off"
                    maxLength={120}
                    placeholder="e.g. Free fitness assessment"
                    {...form.register(`benefits.${index}.value`)}
                  />
                </FormField>
                <IconButton
                  label={`Remove benefit ${index + 1}`}
                  onClick={() => benefits.remove(index)}
                  className="mt-0.5"
                >
                  <X aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            icon={<Plus aria-hidden />}
            disabled={benefits.fields.length >= PLAN_MAX_BENEFITS}
            onClick={() => benefits.append({ value: '' }, { shouldFocus: true })}
          >
            Add benefit
          </Button>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Access
          </legend>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span id="plan-days-label" className="text-13 font-medium text-fg">
              Days
            </span>
            <div role="group" aria-labelledby="plan-days-label" className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => {
                const on = accessDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'h-9 min-w-12 cursor-pointer rounded-md border px-3 text-13 font-medium transition-colors duration-150',
                      on
                        ? 'border-primary bg-primary-subtle text-primary-text'
                        : 'border-border-strong bg-surface text-fg-secondary hover:bg-surface-hover',
                    )}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
            {errors.accessDays?.message ? (
              <p className="text-13 text-danger-text">{errors.accessDays.message}</p>
            ) : (
              <p className="text-13 text-fg-muted">
                {accessDays.length === 7 ? 'Every day.' : 'Members are refused on other days.'}
              </p>
            )}
          </div>
          <FormField
            label="From"
            optional
            error={errors.accessStartTime?.message}
            hint="Leave both times empty for all opening hours."
          >
            <Input type="time" {...form.register('accessStartTime')} />
          </FormField>
          <FormField label="Until" optional error={errors.accessEndTime?.message}>
            <Input type="time" {...form.register('accessEndTime')} />
          </FormField>
        </fieldset>
      </form>
    </Dialog>
  );
}
