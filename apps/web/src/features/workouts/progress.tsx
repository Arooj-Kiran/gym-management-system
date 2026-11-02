import { zodResolver } from '@hookform/resolvers/zod';
import {
  BODY_MEASUREMENT_LABELS,
  BODY_MEASUREMENTS,
  recordProgressSchema,
  WORKOUT_LIMITS,
  type BodyMeasurement,
  type ProgressEntryDto,
} from '@gms/shared';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { LineChart as LineChartIcon, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import type { z } from 'zod';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Textarea } from '../../components/ui/form-field';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { cn } from '../../lib/cn';
import { formatDate, gymTodayIso } from '../../lib/format';
import { applyServerErrors } from '../../lib/forms';
import {
  useMemberProgress,
  useMyProgress,
  useRecordMemberProgress,
  useRecordMyProgress,
} from './workouts-api';

type FormInput = z.input<typeof recordProgressSchema>;
type FormOutput = z.output<typeof recordProgressSchema>;
type Metric = 'weightKg' | 'bodyFatPct' | BodyMeasurement;

const FORM_ID = 'record-progress-form';
const FIELDS = [
  'recordedOn',
  'weightKg',
  'bodyFatPct',
  'notes',
  ...BODY_MEASUREMENTS.map((m) => `measurements.${m}`),
];
const emptyToNull = { setValueAs: (value: unknown) => (value === '' ? null : value) };

const METRICS: { value: Metric; label: string; unit: string }[] = [
  { value: 'weightKg', label: 'Weight', unit: 'kg' },
  { value: 'bodyFatPct', label: 'Body fat', unit: '%' },
  ...BODY_MEASUREMENTS.map((m) => ({ value: m, label: BODY_MEASUREMENT_LABELS[m], unit: 'cm' })),
];

function metricValue(entry: ProgressEntryDto, metric: Metric) {
  if (metric === 'weightKg' || metric === 'bodyFatPct') return entry[metric];
  return entry.measurements[metric] ?? null;
}

/** Shortest "12 Mar" style label for the chart axis. */
const shortDate = (iso: string) => formatDate(iso).replace(/ \d{4}$/, '');

function RecordProgressDialog({
  open,
  onOpenChange,
  record,
  subject,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: UseMutationResult<ProgressEntryDto, Error, FormInput>;
  subject: 'member' | 'self';
}) {
  const today = gymTodayIso();
  const defaults: FormInput = {
    recordedOn: today,
    weightKg: null,
    bodyFatPct: null,
    measurements: {},
    notes: '',
  };
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(recordProgressSchema),
    defaultValues: defaults,
  });
  const { errors } = form.formState;

  const close = (next: boolean) => {
    if (!next) form.reset(defaults);
    onOpenChange(next);
  };

  const submit = form.handleSubmit((values) =>
    record.mutate(values, {
      onSuccess: () => {
        toast.success('Progress recorded');
        close(false);
      },
      onError: (error) => {
        if (!applyServerErrors(error, form.setError, FIELDS)) toast.error(errorMessage(error));
      },
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Record progress"
      description={
        subject === 'self'
          ? 'Fill in whatever you measured. Everything except the date is optional, but enter at least one number.'
          : 'Fill in whatever was measured. Enter at least one number.'
      }
      size="lg"
      busy={record.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={record.isPending}>
            Save entry
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={submit}
        noValidate
        aria-label="Record progress"
        className="flex flex-col gap-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Date" error={errors.recordedOn?.message}>
            <Input type="date" max={today} {...form.register('recordedOn')} />
          </FormField>
          <FormField label="Weight (kg)" optional error={errors.weightKg?.message}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={WORKOUT_LIMITS.minWeightKg}
              max={WORKOUT_LIMITS.maxWeightKg}
              {...form.register('weightKg', emptyToNull)}
            />
          </FormField>
          <FormField label="Body fat (%)" optional error={errors.bodyFatPct?.message}>
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={WORKOUT_LIMITS.minBodyFatPct}
              max={WORKOUT_LIMITS.maxBodyFatPct}
              {...form.register('bodyFatPct', emptyToNull)}
            />
          </FormField>
        </div>
        <fieldset>
          <legend className="mb-2 text-13 font-medium text-fg">
            Measurements <span className="font-normal text-fg-muted">(cm, optional)</span>
          </legend>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {BODY_MEASUREMENTS.map((m) => (
              <FormField
                key={m}
                label={BODY_MEASUREMENT_LABELS[m]}
                error={errors.measurements?.[m]?.message}
              >
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={WORKOUT_LIMITS.minMeasurementCm}
                  max={WORKOUT_LIMITS.maxMeasurementCm}
                  {...form.register(`measurements.${m}`, emptyToNull)}
                />
              </FormField>
            ))}
          </div>
        </fieldset>
        <FormField label="Notes" optional error={errors.notes?.message}>
          <Textarea rows={2} maxLength={WORKOUT_LIMITS.notesMax} {...form.register('notes')} />
        </FormField>
      </form>
    </Dialog>
  );
}

function ProgressChart({ entries, metric }: { entries: ProgressEntryDto[]; metric: Metric }) {
  const meta = METRICS.find((m) => m.value === metric)!;
  const points = entries
    .map((entry) => ({ date: entry.recordedOn, value: metricValue(entry, metric) }))
    .filter((point): point is { date: string; value: number } => point.value !== null);

  if (points.length === 0)
    return (
      <p className="flex h-56 items-center justify-center px-4 text-center text-13 text-fg-muted">
        No {meta.label.toLowerCase()} recorded yet.
      </p>
    );

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const change = Math.round((last.value - first.value) * 10) / 10;
  const summary =
    points.length === 1
      ? `${meta.label}: ${last.value} ${meta.unit} on ${formatDate(last.date)}.`
      : `${meta.label} went from ${first.value} ${meta.unit} on ${formatDate(first.date)} to ${last.value} ${meta.unit} on ${formatDate(last.date)} (${change > 0 ? '+' : ''}${change} ${meta.unit}).`;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tracking-tight text-fg tabular-nums">
          {last.value}
          <span className="ml-1 text-sm font-normal text-fg-muted">{meta.unit}</span>
        </span>
        {points.length > 1 && (
          <span
            className={cn(
              'text-13 font-medium tabular-nums',
              change === 0 ? 'text-fg-muted' : 'text-fg-secondary',
            )}
          >
            {change > 0 ? '+' : ''}
            {change} {meta.unit} since {formatDate(first.date)}
          </span>
        )}
        <span className="sr-only">{summary}</span>
      </figcaption>
      <div className="h-56 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          {/* The figcaption carries the numbers; the hidden chart must not be focusable. */}
          <LineChart
            data={points}
            margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
            accessibilityLayer={false}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              minTickGap={24}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              formatter={(value) => [`${String(value)} ${meta.unit}`, meta.label]}
              labelFormatter={(label) => formatDate(String(label))}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 13,
                color: 'var(--text)',
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function ProgressView({
  progress,
  record,
  canRecord,
  subject,
  title,
}: {
  progress: UseQueryResult<ProgressEntryDto[]>;
  record: UseMutationResult<ProgressEntryDto, Error, FormInput>;
  canRecord: boolean;
  subject: 'member' | 'self';
  title: string;
}) {
  const [metric, setMetric] = useState<Metric>('weightKg');
  const [recording, setRecording] = useState(false);
  const entries = progress.data ?? [];
  const available = METRICS.filter((m) => entries.some((e) => metricValue(e, m.value) !== null));
  const shown = available.some((m) => m.value === metric)
    ? metric
    : (available[0]?.value ?? metric);
  const newestFirst = [...entries].reverse();

  return (
    <Card>
      <CardHeader
        title={title}
        description={
          entries.length > 0
            ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} since ${formatDate(entries[0]!.recordedOn)}`
            : undefined
        }
        action={
          canRecord && (
            <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setRecording(true)}>
              Record progress
            </Button>
          )
        }
      />
      {progress.isPending ? (
        <ListSkeleton rows={3} label="Loading progress" />
      ) : progress.isError ? (
        <ErrorState error={progress.error} onRetry={() => progress.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<LineChartIcon aria-hidden />}
          title="No progress recorded yet"
          description={
            subject === 'self'
              ? 'Record your weight or measurements every few weeks to see how you are changing.'
              : 'Record weight, body fat or measurements to build a history chart.'
          }
          action={
            canRecord && (
              <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setRecording(true)}>
                Record progress
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-col gap-4 p-4 sm:p-5">
            {available.length > 1 && (
              <div role="group" aria-label="Chart measurement" className="flex flex-wrap gap-1.5">
                {available.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    aria-pressed={m.value === shown}
                    onClick={() => setMetric(m.value)}
                    className={cn(
                      'h-8 cursor-pointer rounded-md px-3 text-13 font-medium transition-colors duration-150',
                      m.value === shown
                        ? 'bg-primary-subtle text-primary-text'
                        : 'text-fg-secondary hover:bg-surface-muted hover:text-fg',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
            <ProgressChart entries={entries} metric={shown} />
          </div>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full min-w-[34rem] text-left text-13">
              <caption className="sr-only">Progress history, newest first</caption>
              <thead className="bg-surface-muted/60 text-xs tracking-wide text-fg-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                    Date
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Weight
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Body fat
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Measurements
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                    Recorded by
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {newestFirst.slice(0, 12).map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap text-fg sm:px-5">
                      {formatDate(entry.recordedOn)}
                      {entry.notes && (
                        <span className="mt-0.5 block max-w-56 text-fg-muted">{entry.notes}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-fg tabular-nums">
                      {entry.weightKg !== null ? `${entry.weightKg} kg` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-fg tabular-nums">
                      {entry.bodyFatPct !== null ? `${entry.bodyFatPct}%` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-fg-secondary">
                      {BODY_MEASUREMENTS.filter((m) => typeof entry.measurements[m] === 'number')
                        .map((m) => `${BODY_MEASUREMENT_LABELS[m]} ${entry.measurements[m]}`)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted sm:px-5">
                      {entry.recordedByName ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {canRecord && (
        <RecordProgressDialog
          open={recording}
          onOpenChange={setRecording}
          record={record}
          subject={subject}
        />
      )}
    </Card>
  );
}

/** Staff view of one member's progress (trainers see only their assigned members). */
export function MemberProgress({ memberId, canRecord }: { memberId: string; canRecord: boolean }) {
  const progress = useMemberProgress(memberId);
  const record = useRecordMemberProgress(memberId);
  return (
    <ProgressView
      progress={progress}
      record={record}
      canRecord={canRecord}
      subject="member"
      title="Progress"
    />
  );
}

/** The signed-in member's own progress. */
export function MyProgress() {
  const progress = useMyProgress();
  const record = useRecordMyProgress();
  return (
    <ProgressView
      progress={progress}
      record={record}
      canRecord
      subject="self"
      title="Body measurements"
    />
  );
}
