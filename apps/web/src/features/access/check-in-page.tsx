import type { AccessDeviceBrief } from '@gms/shared';
import { Expand, Fingerprint, History, ScanLine, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, ButtonLink } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from '../../components/ui/states';
import { fullName, useCan } from '../../lib/auth';
import { formatRelative } from '../../lib/format';
import { ManualCheckInDialog } from '../attendance/manual-check-in-dialog';
import { DecisionBadge, SourceBadge } from './access-badges';
import { useAccessAttempts, useAccessDevices, useAccessStream } from './access-api';
import { useKioskResult, useLiveDecision } from './kiosk-hooks';
import { KioskScreen } from './kiosk-screen';
import { SimulatorPanel } from './simulator-panel';

/** `?device=` when it names an active device, otherwise the first one. */
function useSelectedDevice(devices: AccessDeviceBrief[] | undefined, wanted?: string) {
  const [params, setParams] = useSearchParams();
  const id = wanted ?? params.get('device');
  const device = devices?.find((item) => item.id === id) ?? devices?.[0] ?? null;
  const select = (next: string) => setParams({ device: next }, { replace: true });
  return { device, select };
}

function RecentAttempts({ deviceId }: { deviceId: string }) {
  const attempts = useAccessAttempts({ deviceId, pageSize: 6 });
  return (
    <Card>
      <CardHeader
        title="Latest attempts on this scanner"
        action={
          <Link
            to={`/access-log?device=${deviceId}`}
            className="text-13 font-medium text-primary-text hover:underline"
          >
            Access log
          </Link>
        }
      />
      {attempts.isPending ? (
        <ListSkeleton rows={4} label="Loading attempts" />
      ) : attempts.isError ? (
        <ErrorState error={attempts.error} onRetry={() => attempts.refetch()} />
      ) : attempts.data.data.length === 0 ? (
        <EmptyState
          icon={<History aria-hidden />}
          title="No attempts yet"
          description="Every scan on this device, granted or denied, is listed here."
        />
      ) : (
        <ul className="divide-y divide-border">
          {attempts.data.data.map((attempt) => (
            <li
              key={attempt.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5"
            >
              <span className="min-w-0 flex-1 truncate text-13">
                {attempt.member ? (
                  <Link
                    to={`/members/${attempt.member.id}?tab=attendance`}
                    className="font-medium text-fg hover:underline"
                  >
                    {fullName(attempt.member)}
                  </Link>
                ) : (
                  <span className="text-fg-muted">Unknown fingerprint</span>
                )}
              </span>
              <DecisionBadge reason={attempt.reason} />
              <SourceBadge source={attempt.source} />
              <time
                dateTime={attempt.occurredAt}
                className="w-24 text-right text-13 text-fg-muted tabular-nums"
              >
                {formatRelative(attempt.occurredAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RealScannerNote() {
  return (
    <Card className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-text">
          <Fingerprint className="size-[18px]" aria-hidden />
        </span>
        <div className="text-13">
          <p className="font-medium text-fg">Real scanner</p>
          <p className="mt-0.5 text-fg-muted">
            Scans arrive from the biometric agent on the scanner PC. Results show on the screen as
            soon as the server decides. Real hardware has not been connected or tested yet.
          </p>
        </div>
      </div>
    </Card>
  );
}

export function CheckInPage() {
  const can = useCan();
  const devices = useAccessDevices();
  const { device, select } = useSelectedDevice(devices.data);
  const { result, show } = useKioskResult();
  const onDecision = useLiveDecision(show);
  const status = useAccessStream(device?.id ?? null, onDecision, device?.deviceType);
  const [manualOpen, setManualOpen] = useState(false);
  const canManual = can('attendance:manual-check-in');

  const manualButton = canManual && (
    <Button
      variant="secondary"
      icon={<UserCheck aria-hidden />}
      onClick={() => setManualOpen(true)}
    >
      Manual check-in
    </Button>
  );

  let body;
  if (devices.isPending) {
    body = (
      <div
        role="status"
        aria-label="Loading scanners"
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]"
      >
        <Skeleton className="h-[380px] rounded-xl" />
        <Skeleton className="h-[380px]" />
      </div>
    );
  } else if (devices.isError) {
    body = (
      <Card>
        <ErrorState error={devices.error} onRetry={() => devices.refetch()} />
      </Card>
    );
  } else if (!device) {
    body = (
      <Card>
        <EmptyState
          icon={<ScanLine aria-hidden />}
          title="No active scanners"
          description={
            can('devices:manage')
              ? 'Add a scanner (a simulated one works for testing) to start checking members in.'
              : 'Ask an Admin to add a scanner. You can still check members in by hand.'
          }
          action={
            can('devices:manage') ? (
              <ButtonLink to="/devices" variant="secondary" size="sm">
                Set up scanners
              </ButtonLink>
            ) : (
              manualButton || undefined
            )
          }
        />
      </Card>
    );
  } else {
    const simulated = device.deviceType === 'SIMULATED';
    body = (
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <KioskScreen
            result={result}
            simulated={simulated}
            status={status}
            footer={
              <span className="truncate text-13 text-kiosk-fg-muted">
                {device.name} · {device.location}
              </span>
            }
          />
          {can('access:read-log') && <RecentAttempts deviceId={device.id} />}
        </div>
        <div className="flex flex-col gap-6">
          {simulated && can('access:simulate') ? (
            <SimulatorPanel deviceId={device.id} onDecision={onDecision} />
          ) : (
            !simulated && <RealScannerNote />
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Check-in desk"
        description="The live entrance screen. Every decision is made by the server from current membership data."
        actions={
          <>
            {manualButton}
            {device && (
              <ButtonLink
                to={`/kiosk/${device.id}`}
                variant="secondary"
                icon={<Expand aria-hidden />}
              >
                Full-screen kiosk
              </ButtonLink>
            )}
          </>
        }
      />
      {devices.data && devices.data.length > 1 && device && (
        <div className="mb-6 max-w-sm">
          <label htmlFor="check-in-device" className="mb-1.5 block text-13 font-medium text-fg">
            Scanner
          </label>
          <Select
            id="check-in-device"
            value={device.id}
            onChange={(event) => select(event.target.value)}
          >
            {devices.data.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.location}
                {item.deviceType === 'SIMULATED' ? ' (simulated)' : ''}
              </option>
            ))}
          </Select>
        </div>
      )}
      {body}
      {canManual && <ManualCheckInDialog open={manualOpen} onOpenChange={setManualOpen} />}
    </>
  );
}
