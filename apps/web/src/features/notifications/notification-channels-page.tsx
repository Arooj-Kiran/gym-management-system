import {
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUSES,
  NOTIFICATION_CHANNEL_LABELS,
  type ChannelStatusDto,
  type NotificationChannel,
} from '@gms/shared';
import { Bell, Mail, MessageCircle, MessageSquareText, type LucideIcon } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import { PageHeader } from '../../components/ui/page-header';
import { ErrorState, Skeleton } from '../../components/ui/states';
import { cn } from '../../lib/cn';
import { useChannelStatus } from './notifications-api';

const CHANNEL_ICONS: Record<NotificationChannel, LucideIcon> = {
  EMAIL: Mail,
  SMS: MessageSquareText,
  WHATSAPP: MessageCircle,
};

const CHANNEL_USE: Record<NotificationChannel, string> = {
  EMAIL: 'Sent to the email address on the account.',
  SMS: 'Sent to the mobile number on the member or staff profile.',
  WHATSAPP: 'Sent to the same mobile number through WhatsApp.',
};

function ChannelCard({ status }: { status: ChannelStatusDto }) {
  const Icon = CHANNEL_ICONS[status.channel];
  const name = NOTIFICATION_CHANNEL_LABELS[status.channel];
  const headingId = `channel-${status.channel.toLowerCase()}`;
  return (
    <Card className="flex flex-col" aria-labelledby={headingId} role="region">
      <div className="flex items-start gap-3 border-b border-border p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-secondary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={headingId} className="text-sm font-semibold text-fg">
              {name}
            </h2>
            {status.configured ? (
              <Badge tone="success" dot>
                Configured
              </Badge>
            ) : (
              <Badge tone="warning" dot>
                Requires configuration
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-13 text-fg-muted">
            {status.provider} · {CHANNEL_USE[status.channel]}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <h3 className="text-13 font-medium text-fg-muted">Server settings</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${name} settings`}>
            {status.requiredEnv.map((name) => {
              const missing = status.missingEnv.includes(name);
              return (
                <li
                  key={name}
                  className={cn(
                    'rounded-sm px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset',
                    missing
                      ? 'bg-warning-subtle text-warning-text ring-warning-text/25'
                      : 'bg-success-subtle text-success-text ring-success/25',
                  )}
                >
                  {name}
                  <span className="sr-only">{missing ? ' (missing)' : ' (set)'}</span>
                </li>
              );
            })}
          </ul>
          {!status.configured && (
            <p className="mt-2 text-13 text-fg-secondary">
              Until {status.missingEnv.length === 1 ? 'this is' : 'these are'} set in the server's{' '}
              <code className="font-mono text-xs">.env</code>, messages are recorded as “Not
              configured” and nothing is sent.
            </p>
          )}
        </div>

        <div className="mt-auto">
          <h3 className="text-13 font-medium text-fg-muted">Last 7 days</h3>
          <dl className="mt-2 grid grid-cols-3 gap-2">
            {DELIVERY_STATUSES.map((delivery) => (
              <div key={delivery} className="rounded-md bg-surface-muted px-3 py-2">
                <dt className="text-xs text-fg-muted">{DELIVERY_STATUS_LABELS[delivery]}</dt>
                <dd
                  className={cn(
                    'mt-0.5 text-base font-semibold tabular-nums',
                    delivery === 'FAILED' && status.recent.FAILED > 0
                      ? 'text-danger-text'
                      : 'text-fg',
                  )}
                >
                  {status.recent[delivery] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Card>
  );
}

export function NotificationChannelsPage() {
  const channels = useChannelStatus();
  return (
    <>
      <PageHeader
        title="Notification channels"
        description="Where reminders go besides the in-app bell. Credentials live only in the server's environment and are never shown here."
      />

      <Card className="mb-6 flex items-start gap-3 p-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-text">
          <Bell className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-fg">In-app notifications</h2>
            <Badge tone="success" dot>
              Always on
            </Badge>
          </div>
          <p className="mt-0.5 text-13 text-fg-secondary">
            Every reminder lands in the recipient's bell first. Email, SMS and WhatsApp copies are
            queued from there and tried once a minute.
          </p>
        </div>
      </Card>

      {channels.isPending ? (
        <div
          className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Loading channels"
        >
          {[0, 1, 2].map((key) => (
            <Card key={key} className="p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-3 h-4 w-full" />
              <Skeleton className="mt-6 h-14 w-full" />
            </Card>
          ))}
        </div>
      ) : channels.isError ? (
        <Card>
          <ErrorState error={channels.error} onRetry={() => channels.refetch()} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {channels.data.map((status) => (
            <ChannelCard key={status.channel} status={status} />
          ))}
        </div>
      )}
    </>
  );
}
