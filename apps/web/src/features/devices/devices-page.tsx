import {
  createDeviceSchema,
  DEVICE_TYPE_LABELS,
  DEVICE_TYPES,
  updateDeviceSchema,
  type AccessDeviceDto,
  type AccessDeviceWithKey,
  type DeviceType,
} from '@gms/shared';
import {
  Check,
  Copy,
  KeyRound,
  MonitorSmartphone,
  Pencil,
  Plus,
  Power,
  PowerOff,
  ScanLine,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '../../api/client';
import { Badge } from '../../components/ui/badge';
import { Button, ButtonLink } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Dialog } from '../../components/ui/dialog';
import { FormField, Input, Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton } from '../../components/ui/states';
import { cn } from '../../lib/cn';
import { formatDateTime, formatRelative } from '../../lib/format';
import {
  useCreateDevice,
  useDevices,
  useRotateDeviceKey,
  useSetDeviceStatus,
  useUpdateDevice,
} from './devices-api';

interface DeviceDraft {
  name: string;
  location: string;
  deviceType: DeviceType;
  vendor: string;
  model: string;
  serialNumber: string;
}

type DraftErrors = Partial<Record<keyof DeviceDraft | 'form', string>>;

const draftOf = (device?: AccessDeviceDto): DeviceDraft => ({
  name: device?.name ?? '',
  location: device?.location ?? '',
  deviceType: device?.deviceType ?? 'SIMULATED',
  vendor: device?.vendor ?? '',
  model: device?.model ?? '',
  serialNumber: device?.serialNumber ?? '',
});

const FIELDS = ['name', 'location', 'deviceType', 'vendor', 'model', 'serialNumber'] as const;

function fieldErrors(issues: { path: PropertyKey[] | string; message: string }[]): DraftErrors {
  const errors: DraftErrors = {};
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? String(issue.path[0] ?? '') : issue.path;
    const field = FIELDS.find((name) => name === path) ?? 'form';
    errors[field] ??= issue.message;
  }
  return errors;
}

const FORM_ID = 'device-form';

/** Add or edit a scanner. The type is chosen once: it decides the source of every attempt. */
function DeviceFormDialog({
  device,
  open,
  onOpenChange,
  onCreated,
}: {
  device?: AccessDeviceDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: AccessDeviceWithKey) => void;
}) {
  const create = useCreateDevice();
  const update = useUpdateDevice();
  const saving = create.isPending || update.isPending;
  const [draft, setDraft] = useState<DeviceDraft>(() => draftOf(device));
  const [errors, setErrors] = useState<DraftErrors>({});
  const real = draft.deviceType === 'REAL';
  const set = (field: keyof DeviceDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const close = (next: boolean) => {
    if (!next) {
      setDraft(draftOf(device));
      setErrors({});
    }
    onOpenChange(next);
  };

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.details.length > 0) {
      setErrors(fieldErrors(error.details));
    } else {
      toast.error(errorMessage(error));
    }
  };

  const submit = () => {
    const details = {
      name: draft.name,
      location: draft.location,
      ...(real
        ? { vendor: draft.vendor, model: draft.model, serialNumber: draft.serialNumber }
        : {}),
    };
    if (device) {
      const original = draftOf(device);
      const changes = Object.fromEntries(
        Object.entries(details).filter(
          ([key, value]) => value.trim() !== original[key as keyof DeviceDraft].trim(),
        ),
      );
      if (Object.keys(changes).length === 0) return close(false);
      const parsed = updateDeviceSchema.safeParse(changes);
      if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
      setErrors({});
      update.mutate(
        { id: device.id, ...parsed.data },
        {
          onSuccess: (saved) => {
            toast.success(`${saved.name} saved`);
            close(false);
          },
          onError,
        },
      );
      return;
    }
    const parsed = createDeviceSchema.safeParse({ ...details, deviceType: draft.deviceType });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: (created) => {
        close(false);
        onCreated(created);
      },
      onError,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={device ? `Edit ${device.name}` : 'Add a scanner'}
      description={
        device
          ? 'The type cannot be changed. Add a new scanner instead.'
          : 'Each scanner gets its own key. The key is shown once, right after you add it.'
      }
      busy={saving}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={saving}>
            {device ? 'Save scanner' : 'Add scanner'}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <FormField label="Name" error={errors.name} hint="Shown on the check-in desk.">
          <Input
            value={draft.name}
            onChange={(event) => set('name')(event.target.value)}
            maxLength={80}
          />
        </FormField>
        <FormField label="Location" error={errors.location} hint="e.g. Main entrance">
          <Input
            value={draft.location}
            onChange={(event) => set('location')(event.target.value)}
            maxLength={80}
          />
        </FormField>
        {!device && (
          <FormField
            label="Type"
            error={errors.deviceType}
            className="sm:col-span-2"
            hint={
              real
                ? 'A fingerprint scanner connected through the biometric agent.'
                : 'For testing only. Scans come from the simulator on the check-in desk and are never real verification.'
            }
          >
            <Select
              value={draft.deviceType}
              onChange={(event) => set('deviceType')(event.target.value)}
            >
              {DEVICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DEVICE_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {real && (
          <>
            <FormField label="Vendor" optional error={errors.vendor}>
              <Input
                value={draft.vendor}
                onChange={(event) => set('vendor')(event.target.value)}
                maxLength={40}
              />
            </FormField>
            <FormField label="Model" optional error={errors.model}>
              <Input
                value={draft.model}
                onChange={(event) => set('model')(event.target.value)}
                maxLength={60}
              />
            </FormField>
            <FormField
              label="Serial number"
              optional
              error={errors.serialNumber}
              className="sm:col-span-2"
            >
              <Input
                value={draft.serialNumber}
                onChange={(event) => set('serialNumber')(event.target.value)}
                maxLength={60}
              />
            </FormField>
          </>
        )}
        {errors.form && (
          <p role="alert" className="text-13 text-danger-text sm:col-span-2">
            {errors.form}
          </p>
        )}
      </form>
    </Dialog>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  };
  return (
    <Button
      variant="secondary"
      aria-label={copied ? 'Copied' : label}
      title={label}
      onClick={copy}
      className="px-3"
    >
      {copied ? <Check className="text-success" aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}

const KEY_INPUT_ID = 'device-key';

/** The device key exists in clear text only in this dialog; the server keeps a hash. */
function DeviceKeyDialog({
  issued,
  onOpenChange,
}: {
  issued: { result: AccessDeviceWithKey; rotated: boolean } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const device = issued?.result.device;
  const key = issued?.result.deviceKey ?? '';
  return (
    <Dialog
      open={issued !== null}
      onOpenChange={onOpenChange}
      title={
        device ? (issued?.rotated ? `New key for ${device.name}` : `${device.name} added`) : 'Key'
      }
      description="Copy the key now. It is not shown again; if it is lost, rotate the key."
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      {device && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={KEY_INPUT_ID} className="text-13 font-medium text-fg">
              Device key
            </label>
            <div className="flex gap-2">
              <Input
                id={KEY_INPUT_ID}
                readOnly
                value={key}
                className="font-mono text-13"
                spellCheck={false}
                onFocus={(event) => event.target.select()}
              />
              <CopyButton value={key} label="Copy device key" />
            </div>
          </div>
          {device.deviceType === 'REAL' ? (
            <div className="rounded-md border border-border bg-surface-muted/60 px-3 py-2.5 text-13 text-fg-secondary">
              <p className="mb-2">
                Put these in the biometric agent&apos;s .env on the entrance PC:
              </p>
              <pre className="overflow-x-auto font-mono text-xs leading-relaxed text-fg">
                {`AGENT_DEVICE_ID=${device.id}\nAGENT_DEVICE_KEY=<the key above>`}
              </pre>
              <p className="mt-2 text-fg-muted">See docs/BIOMETRICS.md for the full setup.</p>
            </div>
          ) : (
            <p className="text-13 text-fg-secondary">
              Simulated scanners are driven from the check-in desk and do not need the key unless
              you test the biometric agent with its simulated adapter.
            </p>
          )}
          {issued?.rotated && (
            <p className="text-13 text-warning-text">
              The old key stopped working. Update the agent before its next scan.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function Health({ device }: { device: AccessDeviceDto }) {
  if (device.status === 'DISABLED') return <Badge dot>Disabled</Badge>;
  if (device.deviceType === 'SIMULATED')
    return (
      <Badge tone="warning" dot>
        Simulated
      </Badge>
    );
  if (!device.lastSeenAt) return <Badge dot>Never connected</Badge>;
  if (device.lastHealth === 'ERROR')
    return (
      <Badge tone="danger" dot>
        Error{device.lastErrorCode ? ` · ${device.lastErrorCode}` : ''}
      </Badge>
    );
  return (
    <Badge tone="success" dot>
      Healthy
    </Badge>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-13 text-fg">{children}</dd>
    </div>
  );
}

function DeviceRow({
  device,
  onEdit,
  onRotate,
  onToggle,
}: {
  device: AccessDeviceDto;
  onEdit: () => void;
  onRotate: () => void;
  onToggle: () => void;
}) {
  const disabled = device.status === 'DISABLED';
  const hardware = [device.vendor, device.model].filter(Boolean).join(' ');
  return (
    <li className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            device.deviceType === 'REAL'
              ? 'bg-primary-subtle text-primary-text'
              : 'bg-warning-subtle text-warning-text',
          )}
          aria-hidden
        >
          <ScanLine className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <p
            className={cn(
              'flex flex-wrap items-center gap-2 text-sm font-medium text-fg',
              disabled && 'text-fg-muted',
            )}
          >
            {device.name}
            <Health device={device} />
          </p>
          <p className="mt-0.5 truncate text-13 text-fg-muted">
            {device.location} · {DEVICE_TYPE_LABELS[device.deviceType]}
            {hardware && ` · ${hardware}`}
            {device.serialNumber && (
              <>
                {' '}
                · <span className="font-mono">{device.serialNumber}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4 pl-12 sm:max-w-sm lg:w-72 lg:pl-0">
        <Fact label="Last seen">
          {device.lastSeenAt ? (
            <time dateTime={device.lastSeenAt} title={formatDateTime(device.lastSeenAt)}>
              {formatRelative(device.lastSeenAt)}
            </time>
          ) : (
            'Never'
          )}
        </Fact>
        <Fact label="Key issued">
          <time dateTime={device.keyRotatedAt} title={formatDateTime(device.keyRotatedAt)}>
            {formatRelative(device.keyRotatedAt)}
          </time>
        </Fact>
      </dl>
      <div className="flex flex-wrap gap-2 pl-12 lg:pl-0">
        <Button size="sm" variant="ghost" icon={<Pencil aria-hidden />} onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" icon={<KeyRound aria-hidden />} onClick={onRotate}>
          Rotate key
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className={disabled ? undefined : 'text-danger-text'}
          icon={disabled ? <Power aria-hidden /> : <PowerOff aria-hidden />}
          onClick={onToggle}
        >
          {disabled ? 'Enable' : 'Disable'}
        </Button>
      </div>
    </li>
  );
}

/** Scanners (Admin only): add, edit, rotate keys, disable. PLAN §6.5. */
export function DevicesPage() {
  const devices = useDevices();
  const rotate = useRotateDeviceKey();
  const setStatus = useSetDeviceStatus();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AccessDeviceDto | null>(null);
  const [rotating, setRotating] = useState<AccessDeviceDto | null>(null);
  const [toggling, setToggling] = useState<AccessDeviceDto | null>(null);
  const [issued, setIssued] = useState<{ result: AccessDeviceWithKey; rotated: boolean } | null>(
    null,
  );
  const enabling = toggling?.status === 'DISABLED';

  return (
    <>
      <PageHeader
        title="Scanners"
        description="Fingerprint scanners at the entrance, and simulated ones for testing."
        actions={
          <Button icon={<Plus aria-hidden />} onClick={() => setAdding(true)}>
            Add scanner
          </Button>
        }
      />

      <Card>
        {devices.isPending ? (
          <ListSkeleton rows={3} label="Loading scanners" />
        ) : devices.isError ? (
          <ErrorState error={devices.error} onRetry={() => devices.refetch()} />
        ) : devices.data.length === 0 ? (
          <EmptyState
            icon={<MonitorSmartphone aria-hidden />}
            title="No scanners yet"
            description="Add a simulated scanner to try check-in, or a real one once the hardware is installed."
            action={
              <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setAdding(true)}>
                Add scanner
              </Button>
            }
          />
        ) : (
          <ul aria-label="Scanners" className="divide-y divide-border">
            {devices.data.map((device) => (
              <DeviceRow
                key={device.id}
                device={device}
                onEdit={() => setEditing(device)}
                onRotate={() => setRotating(device)}
                onToggle={() => setToggling(device)}
              />
            ))}
          </ul>
        )}
      </Card>

      {devices.data && devices.data.length > 0 && (
        <p className="mt-4 text-13 text-fg-muted">
          Test a simulated scanner on the{' '}
          <ButtonLink to="/check-in" variant="ghost" size="sm" className="-mx-2 px-2">
            check-in desk
          </ButtonLink>
          . Real scanner hardware has not been tested with this system yet.
        </p>
      )}

      <DeviceFormDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(result) => setIssued({ result, rotated: false })}
      />
      {editing && (
        <DeviceFormDialog
          key={editing.id}
          device={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onCreated={() => undefined}
        />
      )}
      <DeviceKeyDialog issued={issued} onOpenChange={(open) => !open && setIssued(null)} />
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => !open && setRotating(null)}
        title={rotating ? `Rotate the key for ${rotating.name}?` : 'Rotate key'}
        description="The current key stops working at once. The scanner is refused until its agent has the new key."
        confirmLabel="Rotate key"
        tone="danger"
        reason="optional"
        loading={rotate.isPending}
        onConfirm={(reason) =>
          rotating &&
          rotate.mutate(
            { id: rotating.id, reason },
            {
              onSuccess: (result) => {
                setRotating(null);
                setIssued({ result, rotated: true });
              },
              onError: (error) => toast.error(errorMessage(error)),
            },
          )
        }
      />
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(open) => !open && setToggling(null)}
        title={
          toggling
            ? `${enabling ? 'Enable' : 'Disable'} ${toggling.name}?`
            : 'Change scanner status'
        }
        description={
          enabling
            ? 'The scanner can send scans again with its current key.'
            : 'Every scan from it is refused and logged until it is enabled again. Members can still check in at the desk.'
        }
        confirmLabel={enabling ? 'Enable scanner' : 'Disable scanner'}
        tone={enabling ? 'primary' : 'danger'}
        reason="optional"
        loading={setStatus.isPending}
        onConfirm={(reason) =>
          toggling &&
          setStatus.mutate(
            { id: toggling.id, active: enabling, reason },
            {
              onSuccess: (device) => {
                toast.success(`${device.name} ${enabling ? 'enabled' : 'disabled'}`);
                setToggling(null);
              },
              onError: (error) => toast.error(errorMessage(error)),
            },
          )
        }
      />
    </>
  );
}
