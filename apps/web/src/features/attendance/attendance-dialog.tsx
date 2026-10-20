import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUSES,
  CORRECTION_FIELD_LABELS,
  type AttendanceCorrectionDto,
  type AttendanceCorrectionInput,
  type AttendanceDto,
  type AttendanceStatus,
} from '@gms/shared';
import { History } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select, Textarea } from '../../components/ui/form-field';
import { ErrorState, ListSkeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { formatDateTime, gymDateTimeInputToIso, toGymDateTimeInput } from '../../lib/format';
import { SourceBadge } from '../access/access-badges';
import { useAttendanceCorrections, useCorrectAttendance } from './attendance-api';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-13 text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-13 break-words text-fg">{children}</dd>
    </div>
  );
}

/** Stored values are ISO timestamps or a status; show them the way staff read them. */
function correctionValue(correction: AttendanceCorrectionDto, value: string | null) {
  if (value === null) return 'none';
  if (correction.field === 'STATUS') {
    return ATTENDANCE_STATUS_LABELS[value as AttendanceStatus] ?? value;
  }
  return formatDateTime(value);
}

function CorrectionHistory({ id }: { id: string }) {
  const corrections = useAttendanceCorrections(id);
  if (corrections.isPending) return <ListSkeleton rows={2} label="Loading corrections" />;
  if (corrections.isError)
    return <ErrorState error={corrections.error} onRetry={() => corrections.refetch()} />;
  if (corrections.data.length === 0)
    return <p className="text-13 text-fg-muted">No corrections. This is the original record.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {corrections.data.map((correction) => (
        <li key={correction.id} className="rounded-md border border-border px-3 py-2.5 text-13">
          <p className="font-medium text-fg">
            {CORRECTION_FIELD_LABELS[correction.field]}:{' '}
            <span className="font-normal text-fg-secondary">
              {correctionValue(correction, correction.oldValue)} →{' '}
              {correctionValue(correction, correction.newValue)}
            </span>
          </p>
          <p className="mt-0.5 text-fg-secondary">“{correction.reason}”</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            {correction.correctedByName ?? 'Unknown'} · {formatDateTime(correction.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

interface Draft {
  checkInAt: string;
  checkOutAt: string;
  status: AttendanceStatus;
  reason: string;
}

const draftOf = (record: AttendanceDto): Draft => ({
  checkInAt: toGymDateTimeInput(record.checkInAt),
  checkOutAt: record.checkOutAt ? toGymDateTimeInput(record.checkOutAt) : '',
  status: record.status,
  reason: '',
});

/**
 * One check-in: its details, its correction trail and, for Managers and Admins, a correction form.
 * Corrections never overwrite history; each change is stored with the reason and audit-logged.
 */
export function AttendanceDialog({
  record,
  canCorrect,
  onOpenChange,
}: {
  record: AttendanceDto | null;
  canCorrect: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={record !== null}
      onOpenChange={onOpenChange}
      title={record ? `Check-in · ${fullName(record.member)}` : 'Check-in'}
      description={record ? formatDateTime(record.checkInAt) : undefined}
      size="lg"
    >
      {record && (
        <AttendanceDetails
          key={record.id}
          record={record}
          canCorrect={canCorrect}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function AttendanceDetails({
  record,
  canCorrect,
  onDone,
}: {
  record: AttendanceDto;
  canCorrect: boolean;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(record));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft | 'form', string>>>({});
  const correct = useCorrectAttendance(record.id);
  const original = draftOf(record);
  const set = (field: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const submit = () => {
    const changes: AttendanceCorrectionInput = { reason: draft.reason.trim() };
    if (draft.checkInAt && draft.checkInAt !== original.checkInAt) {
      changes.checkInAt = gymDateTimeInputToIso(draft.checkInAt);
    }
    if (draft.checkOutAt !== original.checkOutAt) {
      changes.checkOutAt = draft.checkOutAt ? gymDateTimeInputToIso(draft.checkOutAt) : null;
    }
    if (draft.status !== original.status) changes.status = draft.status;

    const next: typeof errors = {};
    if (!draft.checkInAt) next.checkInAt = 'Enter the check-in time';
    if (changes.reason.length < 3) next.reason = 'Give a short reason (at least 3 characters)';
    if (Object.keys(changes).length === 1) next.form = 'Change at least one field.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    correct.mutate(changes, {
      onSuccess: () => {
        toast.success('Check-in corrected');
        onDone();
      },
      onError: (error) => {
        if (error instanceof ApiError && error.details.length > 0) {
          const fieldErrors: typeof errors = {};
          for (const detail of error.details) {
            const key = (['checkInAt', 'checkOutAt', 'status', 'reason'] as const).find(
              (field) => field === detail.path,
            );
            fieldErrors[key ?? 'form'] = detail.message;
          }
          setErrors(fieldErrors);
        } else {
          toast.error(errorMessage(error));
        }
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <dl className="divide-y divide-border rounded-md border border-border px-4">
        <Row label="Member">
          {fullName(record.member)}{' '}
          <span className="font-mono text-xs text-fg-muted">{record.member.memberCode}</span>
        </Row>
        <Row label="Plan">{record.planName}</Row>
        <Row label="Checked in">{formatDateTime(record.checkInAt)}</Row>
        <Row label="Checked out">{formatDateTime(record.checkOutAt)}</Row>
        <Row label="Source">
          <SourceBadge source={record.source} />
        </Row>
        <Row label="Status">{ATTENDANCE_STATUS_LABELS[record.status]}</Row>
        {record.createdByName && <Row label="Checked in by">{record.createdByName}</Row>}
      </dl>

      <section aria-labelledby="corrections-heading">
        <h3
          id="corrections-heading"
          className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg"
        >
          <History className="size-4 text-fg-muted" aria-hidden /> Correction history
        </h3>
        <CorrectionHistory id={record.id} />
      </section>

      {canCorrect && (
        <section aria-labelledby="correct-heading" className="border-t border-border pt-5">
          <h3 id="correct-heading" className="text-sm font-semibold text-fg">
            Correct this check-in
          </h3>
          <p className="mt-0.5 mb-4 text-13 text-fg-muted">
            Times are in gym time. The original values are kept in the history above.
          </p>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <FormField label="Check-in time" error={errors.checkInAt}>
              <Input
                type="datetime-local"
                value={draft.checkInAt}
                onChange={(event) => set('checkInAt')(event.target.value)}
              />
            </FormField>
            <FormField
              label="Check-out time"
              error={errors.checkOutAt}
              hint="Leave empty if they have not checked out."
            >
              <Input
                type="datetime-local"
                value={draft.checkOutAt}
                onChange={(event) => set('checkOutAt')(event.target.value)}
              />
            </FormField>
            <FormField
              label="Status"
              error={errors.status}
              hint="Void a check-in that should not count (e.g. recorded by mistake)."
              className="sm:col-span-2"
            >
              <Select value={draft.status} onChange={(event) => set('status')(event.target.value)}>
                {ATTENDANCE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {ATTENDANCE_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Reason"
              error={errors.reason}
              hint="Saved with the correction and in the audit log."
              className="sm:col-span-2"
            >
              <Textarea
                value={draft.reason}
                onChange={(event) => set('reason')(event.target.value)}
                maxLength={500}
                rows={2}
              />
            </FormField>
            {errors.form && (
              <p role="alert" className="text-13 text-danger-text sm:col-span-2">
                {errors.form}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                disabled={correct.isPending}
                onClick={() => {
                  setDraft(draftOf(record));
                  setErrors({});
                }}
              >
                Reset
              </Button>
              <Button type="submit" loading={correct.isPending}>
                Save correction
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
