import { zodResolver } from '@hookform/resolvers/zod';
import {
  SETTINGS_KEYS,
  SETTINGS_LIMITS,
  updateSettingsSchema,
  type GymSettingsDto,
  type UpdateSettingsInput,
} from '@gms/shared';
import { Lock } from 'lucide-react';
import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { FormField, Input, Textarea } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { ErrorState, Skeleton } from '../../components/ui/states';
import { useCan } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import { useSettings, useUpdateSettings } from './settings-api';

type FormInput = z.input<typeof updateSettingsSchema>;
type FormOutput = z.output<typeof updateSettingsSchema>;
type NumericKey = keyof typeof SETTINGS_LIMITS;

const FIELDS = [...SETTINGS_KEYS, 'reason'] as const;

const NUMERIC_FIELDS: { key: NumericKey; label: string; unit: string; hint: string }[] = [
  {
    key: 'expiryReminderDays',
    label: 'Membership expiry reminder',
    unit: 'days before',
    hint: 'When members are reminded that their membership is about to end.',
  },
  {
    key: 'paymentDueReminderDays',
    label: 'Payment due reminder',
    unit: 'days before',
    hint: 'When members with an open invoice are reminded. 0 sends it on the due date.',
  },
  {
    key: 'invoiceDueDays',
    label: 'Invoice due after',
    unit: 'days',
    hint: 'Days between issuing an invoice and its due date. 0 means due on issue.',
  },
  {
    key: 'classBookingCutoffMinutes',
    label: 'Class booking cut-off',
    unit: 'minutes before',
    hint: 'Members cannot book or cancel a class later than this.',
  },
  {
    key: 'biometricRetentionDays',
    label: 'Biometric data retention',
    unit: 'days',
    hint: 'Inactive members’ fingerprint templates are flagged for deletion after this.',
  },
];

const toFormValues = (settings: GymSettingsDto): FormInput => ({
  gymName: settings.gymName,
  expiryReminderDays: settings.expiryReminderDays,
  paymentDueReminderDays: settings.paymentDueReminderDays,
  invoiceDueDays: settings.invoiceDueDays,
  biometricRetentionDays: settings.biometricRetentionDays,
  classBookingCutoffMinutes: settings.classBookingCutoffMinutes,
  reason: '',
});

/** Number input with its unit shown inside the field; receives id/aria props from FormField. */
function UnitInput({ unit, ...props }: ComponentProps<typeof Input> & { unit: string }) {
  return (
    <div className="relative">
      <Input type="number" inputMode="numeric" className="pr-28 tabular-nums" {...props} />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-13 text-fg-muted">
        {unit}
      </span>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div className="px-4 py-5 sm:px-5">{children}</div>
    </Card>
  );
}

function SettingsForm({ settings, editable }: { settings: GymSettingsDto; editable: boolean }) {
  const update = useUpdateSettings();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(updateSettingsSchema),
    defaultValues: toFormValues(settings),
  });
  const { errors, isDirty, dirtyFields } = form.formState;
  const disabled = !editable || update.isPending;

  useEffect(() => form.reset(toFormValues(settings)), [settings, form]);

  const submit = form.handleSubmit((values) => {
    const changed = SETTINGS_KEYS.filter((key) => dirtyFields[key]);
    if (changed.length === 0) return;
    const input = Object.fromEntries(
      changed.map((key) => [key, values[key]]),
    ) as UpdateSettingsInput;
    if (values.reason) input.reason = values.reason;
    update.mutate(input, {
      onSuccess: () => toast.success('Settings saved'),
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, FIELDS)) toast.error(errorMessage(error));
      },
    });
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <Section
        title="Gym profile"
        description="Shown in the dashboard, on receipts and in member messages."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField label="Gym name" error={errors.gymName?.message} className="md:col-span-3">
            <Input
              autoComplete="organization"
              disabled={disabled}
              maxLength={120}
              {...form.register('gymName')}
            />
          </FormField>
          <FormField label="Timezone" hint="Fixed for this deployment.">
            <Input value={settings.timezone} readOnly disabled />
          </FormField>
          <FormField label="Currency" hint="Fixed for this deployment.">
            <Input value={settings.currencyCode} readOnly disabled />
          </FormField>
        </div>
      </Section>

      <Section
        title="Reminders, billing and bookings"
        description="Used by the reminder jobs, invoicing and class booking as those features are switched on."
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
          {NUMERIC_FIELDS.map(({ key, label, unit, hint }) => {
            const [min, max] = SETTINGS_LIMITS[key];
            return (
              <FormField
                key={key}
                label={label}
                error={errors[key]?.message}
                hint={
                  <>
                    {hint}{' '}
                    <span className="whitespace-nowrap">
                      Allowed: {min}–{max}.
                    </span>
                  </>
                }
              >
                <UnitInput
                  unit={unit}
                  min={min}
                  max={max}
                  step={1}
                  disabled={disabled}
                  {...form.register(key)}
                />
              </FormField>
            );
          })}
        </div>
      </Section>

      {editable && (
        <Card className="flex flex-col gap-4 px-4 py-4 sm:px-5 md:flex-row md:items-end">
          <FormField
            label="Reason for this change"
            optional
            error={errors.reason?.message}
            hint="Saved in the audit log with the old and new values."
            className="md:flex-1"
          >
            <Textarea
              rows={2}
              maxLength={500}
              disabled={update.isPending}
              {...form.register('reason')}
            />
          </FormField>
          <div className="flex flex-col-reverse gap-2 sm:flex-row md:pb-6">
            <Button
              variant="ghost"
              disabled={!isDirty || update.isPending}
              onClick={() => form.reset(toFormValues(settings))}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!isDirty} loading={update.isPending}>
              Save settings
            </Button>
          </div>
        </Card>
      )}
    </form>
  );
}

function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Loading settings" className="flex flex-col gap-6">
      <Skeleton className="h-48" />
      <Skeleton className="h-80" />
    </div>
  );
}

export function SettingsPage() {
  const can = useCan();
  const editable = can('settings:manage');
  const settings = useSettings();

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          settings.data ? (
            <>Last changed {formatDateTime(settings.data.updatedAt)}.</>
          ) : (
            'Gym-wide rules for reminders, billing and bookings.'
          )
        }
      />
      {!editable && (
        <p
          role="note"
          className="mb-6 flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3.5 py-2.5 text-13 text-fg-secondary"
        >
          <Lock className="size-4 shrink-0 text-fg-muted" aria-hidden />
          You can view these settings. Only an Admin can change them.
        </p>
      )}
      {settings.isPending ? (
        <SettingsSkeleton />
      ) : settings.isError ? (
        <Card>
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        </Card>
      ) : (
        <SettingsForm settings={settings.data} editable={editable} />
      )}
    </>
  );
}
