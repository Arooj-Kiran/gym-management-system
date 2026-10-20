import {
  BIOMETRIC_CONSENT,
  DEVICE_TYPE_LABELS,
  ENROLLMENT_STATUS_LABELS,
  templateRefSchema,
  type BiometricEnrollmentDto,
  type EnrollmentStatus,
  type MemberDto,
} from '@gms/shared';
import { Fingerprint, FileSignature, Plus, Undo2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../../api/client';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select } from '../../components/ui/form-field';
import { ErrorState, Skeleton } from '../../components/ui/states';
import { fullName } from '../../lib/auth';
import { formatDateTime } from '../../lib/format';
import { useAccessDevices } from '../access/access-api';
import {
  useEnroll,
  useGiveConsent,
  useMemberBiometric,
  useRevokeEnrollment,
  useWithdrawConsent,
} from './biometrics-api';

const ENROLLMENT_TONES: Record<EnrollmentStatus, BadgeTone> = {
  ACTIVE: 'success',
  REVOKED: 'warning',
  DELETED: 'neutral',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-13 text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-right text-13 break-words text-fg">{children}</dd>
    </div>
  );
}

function ConsentDialog({
  member,
  open,
  onOpenChange,
}: {
  member: MemberDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const consent = useGiveConsent(member.id);
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState(false);
  const close = (next: boolean) => {
    if (!next) {
      setAgreed(false);
      setTouched(false);
    }
    onOpenChange(next);
  };

  const submit = () => {
    setTouched(true);
    if (!agreed) return;
    consent.mutate(
      { consentVersion: BIOMETRIC_CONSENT.version },
      {
        onSuccess: () => {
          toast.success(`Consent recorded for ${fullName(member)}`);
          close(false);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Record fingerprint consent"
      description={`Read this to ${member.firstName} or let them read it, before enrolling a fingerprint.`}
      busy={consent.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={consent.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={consent.isPending}>
            Record consent
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-surface-muted/60 px-4 py-3">
          <ul className="flex list-disc flex-col gap-2 pl-4 text-13 text-fg-secondary">
            {BIOMETRIC_CONSENT.text.split('\n').map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-fg-muted">
            Consent text version <span className="font-mono">{BIOMETRIC_CONSENT.version}</span>
          </p>
        </div>
        <div>
          <label className="flex cursor-pointer items-start gap-2.5 text-13 text-fg">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
              checked={agreed}
              aria-invalid={touched && !agreed ? true : undefined}
              aria-describedby={touched && !agreed ? 'consent-agree-error' : undefined}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span>
              {fullName(member)} has read this and agrees to have their fingerprint enrolled.
            </span>
          </label>
          {touched && !agreed && (
            <p id="consent-agree-error" className="mt-1.5 pl-6.5 text-13 text-danger-text">
              Confirm that the member agrees before recording consent.
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}

const ENROLL_FORM_ID = 'enroll-form';

function EnrollDialog({
  member,
  open,
  onOpenChange,
}: {
  member: MemberDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const devices = useAccessDevices(open);
  const enroll = useEnroll(member.id);
  const [deviceId, setDeviceId] = useState('');
  const [templateRef, setTemplateRef] = useState('');
  const [errors, setErrors] = useState<{ deviceId?: string; templateRef?: string }>({});
  const available = devices.data?.filter((device) => device.status === 'ACTIVE') ?? [];
  const device = available.find((d) => d.id === deviceId) ?? available[0];
  const real = device?.deviceType === 'REAL';

  const close = (next: boolean) => {
    if (!next) {
      setDeviceId('');
      setTemplateRef('');
      setErrors({});
    }
    onOpenChange(next);
  };

  const submit = () => {
    if (!device) return setErrors({ deviceId: 'Choose a scanner' });
    let ref: string | undefined;
    if (real) {
      const parsed = templateRefSchema.safeParse(templateRef);
      if (!parsed.success) {
        return setErrors({ templateRef: parsed.error.issues[0]?.message });
      }
      ref = parsed.data;
    }
    setErrors({});
    enroll.mutate(
      { deviceId: device.id, templateRef: ref },
      {
        onSuccess: (enrollment) => {
          toast.success(`Fingerprint enrolled on ${enrollment.device.name}`);
          close(false);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.details.some((d) => d.path === 'templateRef')) {
            setErrors({
              templateRef: error.details.find((d) => d.path === 'templateRef')?.message,
            });
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
      title={`Enroll a fingerprint for ${member.firstName}`}
      description="The fingerprint itself stays on the scanner. The gym stores only the scanner's user ID."
      busy={enroll.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={enroll.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={ENROLL_FORM_ID} loading={enroll.isPending} disabled={!device}>
            Enroll fingerprint
          </Button>
        </>
      }
    >
      {devices.isPending ? (
        <div role="status" aria-label="Loading scanners" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10" />
        </div>
      ) : devices.isError ? (
        <ErrorState error={devices.error} onRetry={() => devices.refetch()} />
      ) : available.length === 0 ? (
        <p className="text-13 text-fg-secondary">
          There is no active scanner. An Admin can add one under Administration → Scanners.
        </p>
      ) : (
        <form
          id={ENROLL_FORM_ID}
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FormField label="Scanner" error={errors.deviceId}>
            <Select
              value={device?.id ?? ''}
              onChange={(event) => {
                setDeviceId(event.target.value);
                setErrors({});
              }}
            >
              {available.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.location} ({DEVICE_TYPE_LABELS[d.deviceType]})
                </option>
              ))}
            </Select>
          </FormField>
          {real ? (
            <FormField
              label="Device user ID"
              error={errors.templateRef}
              hint="Enroll the finger on the scanner first, then enter the user number it shows."
            >
              <Input
                value={templateRef}
                onChange={(event) => setTemplateRef(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
              />
            </FormField>
          ) : (
            <p className="rounded-md border border-warning-text/25 bg-warning-subtle px-3 py-2.5 text-13 text-warning-text">
              Simulated scanner: a fake SIM- ID is created for testing. No fingerprint is captured.
            </p>
          )}
        </form>
      )}
    </Dialog>
  );
}

function EnrollmentItem({
  enrollment,
  canManage,
  onRevoke,
}: {
  enrollment: BiometricEnrollmentDto;
  canManage: boolean;
  onRevoke: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
      <span className="min-w-0 flex-1 text-13">
        <span className="block font-medium text-fg">{enrollment.device.name}</span>
        <span className="block text-xs text-fg-muted">
          {enrollment.templateRefMasked && (
            <>
              <span className="font-mono">{enrollment.templateRefMasked}</span> ·{' '}
            </>
          )}
          {enrollment.status === 'ACTIVE'
            ? `Enrolled ${formatDateTime(enrollment.enrolledAt)}`
            : `Revoked ${formatDateTime(enrollment.revokedAt)}`}
        </span>
      </span>
      <Badge tone={ENROLLMENT_TONES[enrollment.status]}>
        {ENROLLMENT_STATUS_LABELS[enrollment.status]}
      </Badge>
      {canManage && enrollment.status === 'ACTIVE' && (
        <Button size="sm" variant="ghost" className="text-danger-text" onClick={onRevoke}>
          Revoke
        </Button>
      )}
    </li>
  );
}

/**
 * Fingerprint consent and enrollments (PLAN §6.6). Everyone with biometrics:read-status sees the
 * status; only Managers and Admins change it. A fingerprint never grants entry by itself.
 */
export function FingerprintCard({ member, canManage }: { member: MemberDto; canManage: boolean }) {
  const status = useMemberBiometric(member.id);
  const withdraw = useWithdrawConsent(member.id);
  const revoke = useRevokeEnrollment(member.id);
  const [dialog, setDialog] = useState<'consent' | 'withdraw' | 'enroll' | null>(null);
  const [revoking, setRevoking] = useState<BiometricEnrollmentDto | null>(null);
  const manage = canManage && !member.archivedAt;
  const name = fullName(member);

  let body: ReactNode;
  if (status.isPending) {
    body = (
      <div
        role="status"
        aria-label="Loading fingerprint status"
        className="flex flex-col gap-3 px-4 py-4 sm:px-5"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  } else if (status.isError) {
    body = <ErrorState error={status.error} onRetry={() => status.refetch()} />;
  } else {
    const { consent, enrollments } = status.data;
    const active = enrollments.some((e) => e.status === 'ACTIVE');
    body = (
      <>
        <dl className="divide-y divide-border px-4 sm:px-5">
          <Row label="Consent">
            {consent ? (
              <Badge tone="success" dot>
                Given
              </Badge>
            ) : (
              <Badge dot>Not given</Badge>
            )}
          </Row>
          {consent && (
            <>
              <Row label="Recorded">{formatDateTime(consent.givenAt)}</Row>
              {consent.recordedByName && <Row label="By">{consent.recordedByName}</Row>}
              <Row label="Text version">
                <span className="font-mono">{consent.consentVersion}</span>
              </Row>
            </>
          )}
          <Row label="Scanner entry">
            {active ? (
              <Badge tone="success" dot>
                Enrolled
              </Badge>
            ) : (
              'Not enrolled'
            )}
          </Row>
        </dl>
        {enrollments.length > 0 && (
          <ul
            aria-label="Fingerprint enrollments"
            className="divide-y divide-border border-t border-border px-4 sm:px-5"
          >
            {enrollments.map((enrollment) => (
              <EnrollmentItem
                key={enrollment.id}
                enrollment={enrollment}
                canManage={manage}
                onRevoke={() => setRevoking(enrollment)}
              />
            ))}
          </ul>
        )}
        <p className="border-t border-border px-4 py-3 text-13 text-fg-muted sm:px-5">
          {consent
            ? 'A recognised fingerprint only identifies the member. Entry still depends on their membership.'
            : 'Consent must be recorded before a fingerprint can be enrolled. Without one they check in at the desk.'}
        </p>
        {manage && (
          <div className="flex flex-col gap-2 border-t border-border px-4 py-4 sm:px-5">
            {consent ? (
              <>
                <Button
                  variant="secondary"
                  className="w-full"
                  icon={<Plus aria-hidden />}
                  onClick={() => setDialog('enroll')}
                >
                  Enroll fingerprint
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-danger-text"
                  icon={<Undo2 aria-hidden />}
                  onClick={() => setDialog('withdraw')}
                >
                  Withdraw consent
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                className="w-full"
                icon={<FileSignature aria-hidden />}
                onClick={() => setDialog('consent')}
              >
                Record consent
              </Button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Fingerprint"
        action={<Fingerprint className="size-4 text-fg-muted" aria-hidden />}
      />
      {body}
      {manage && (
        <>
          <ConsentDialog
            member={member}
            open={dialog === 'consent'}
            onOpenChange={(open) => setDialog(open ? 'consent' : null)}
          />
          <EnrollDialog
            member={member}
            open={dialog === 'enroll'}
            onOpenChange={(open) => setDialog(open ? 'enroll' : null)}
          />
          <ConfirmDialog
            open={dialog === 'withdraw'}
            onOpenChange={(open) => setDialog(open ? 'withdraw' : null)}
            title={`Withdraw consent for ${name}?`}
            description="Every fingerprint they have enrolled is revoked and deleted from the scanner. They can still check in at the desk."
            confirmLabel="Withdraw consent"
            tone="danger"
            reason="required"
            loading={withdraw.isPending}
            onConfirm={(reason) =>
              withdraw.mutate(
                { reason: reason ?? '' },
                {
                  onSuccess: () => {
                    toast.success(`Consent withdrawn for ${name}`, {
                      description: 'Their fingerprints are being deleted from the scanner.',
                    });
                    setDialog(null);
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                },
              )
            }
          />
          <ConfirmDialog
            open={revoking !== null}
            onOpenChange={(open) => !open && setRevoking(null)}
            title="Revoke this fingerprint?"
            description={
              revoking
                ? `${name} can no longer be recognised on ${revoking.device.name}. The template is deleted from the scanner.`
                : ''
            }
            confirmLabel="Revoke fingerprint"
            tone="danger"
            reason="required"
            loading={revoke.isPending}
            onConfirm={(reason) =>
              revoking &&
              revoke.mutate(
                { id: revoking.id, reason: reason ?? '' },
                {
                  onSuccess: () => {
                    toast.success('Fingerprint revoked');
                    setRevoking(null);
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                },
              )
            }
          />
        </>
      )}
    </Card>
  );
}
