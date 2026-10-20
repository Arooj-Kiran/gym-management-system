import { LogOut, ScanLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ButtonLink } from '../../components/ui/button';
import { EmptyState, ErrorState } from '../../components/ui/states';
import { FullPageLoader } from '../../routes/guards';
import { useSession } from '../../lib/auth';
import { useAccessDevices, useAccessStream } from './access-api';
import { useKioskResult, useLiveDecision } from './kiosk-hooks';
import { KioskScreen } from './kiosk-screen';

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={now.toISOString()} className="text-lg font-medium text-kiosk-fg tabular-nums">
      {new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Karachi',
      }).format(now)}
    </time>
  );
}

/**
 * Full-screen entrance display for a monitor facing members (PLAN §6.4). It only shows what the
 * server decided; it never decides anything and keeps no member data between scans.
 */
export function KioskPage() {
  const { deviceId = '' } = useParams();
  const session = useSession();
  const devices = useAccessDevices();
  const device = devices.data?.find((item) => item.id === deviceId) ?? null;
  const { result, show } = useKioskResult();
  const onDecision = useLiveDecision(show);
  const status = useAccessStream(device?.id ?? null, onDecision, device?.deviceType);

  if (devices.isPending) return <FullPageLoader />;
  if (devices.isError || !device) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
        {devices.isError ? (
          <ErrorState
            error={devices.error}
            title="The kiosk could not start"
            onRetry={() => devices.refetch()}
          />
        ) : (
          <EmptyState
            icon={<ScanLine aria-hidden />}
            title="Scanner not available"
            description="This scanner does not exist or has been disabled."
            action={
              <ButtonLink to="/check-in" variant="secondary" size="sm">
                Back to the check-in desk
              </ButtonLink>
            }
          />
        )}
      </main>
    );
  }

  return (
    <main>
      <h1 className="sr-only">Entrance kiosk · {device.name}</h1>
      <KioskScreen
        variant="full"
        result={result}
        simulated={device.deviceType === 'SIMULATED'}
        status={status}
        header={
          <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-kiosk-fg">{session.gym.name}</p>
              <p className="truncate text-13 text-kiosk-fg-muted">
                {device.name} · {device.location}
              </p>
            </div>
            <Clock />
          </div>
        }
        footer={
          <Link
            to={`/check-in?device=${device.id}`}
            className="inline-flex items-center gap-1.5 rounded-sm text-13 font-medium text-kiosk-fg-muted hover:text-kiosk-fg"
          >
            <LogOut className="size-4" aria-hidden />
            Exit kiosk
          </Link>
        }
      />
    </main>
  );
}
