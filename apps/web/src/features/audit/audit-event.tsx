import { ROLE_LABELS, type AuditLogDto } from '@gms/shared';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/badge';
import { formatDateTime } from '../../lib/format';
import { auditActorName, auditLabel, auditTone, displayValue, fieldLabel } from './audit-format';

const ENTITY_LABELS: Record<string, string> = {
  USER: 'User account',
  GYM_SETTINGS: 'Gym settings',
};

function Changes({ event }: { event: AuditLogDto }) {
  const keys = [
    ...new Set([...Object.keys(event.before ?? {}), ...Object.keys(event.after ?? {})]),
  ];
  if (keys.length === 0)
    return <p className="text-13 text-fg-muted">No field values recorded for this event.</p>;
  const hasBefore = event.before !== null;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[420px] text-left text-13">
        <thead className="bg-surface-muted/60 text-xs text-fg-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Field
            </th>
            {hasBefore && (
              <th scope="col" className="px-3 py-2 font-medium">
                Before
              </th>
            )}
            <th scope="col" className="px-3 py-2 font-medium">
              {hasBefore ? 'After' : 'Value'}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {keys.map((key) => (
            <tr key={key}>
              <th scope="row" className="px-3 py-2 font-medium whitespace-nowrap text-fg-secondary">
                {fieldLabel(key)}
              </th>
              {hasBefore && (
                <td className="px-3 py-2 break-all text-fg-muted line-through decoration-border-strong">
                  {displayValue(event.before?.[key])}
                </td>
              )}
              <td className="px-3 py-2 break-all text-fg">{displayValue(event.after?.[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="truncate font-mono text-xs text-fg-secondary" title={value ?? undefined}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

export function AuditEvent({ event }: { event: AuditLogDto }) {
  return (
    <li>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[16px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-3.5 transition-colors duration-150 hover:bg-surface-hover focus-visible:-outline-offset-2 sm:px-5 md:grid-cols-[16px_minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="mt-0.5 size-4 text-fg-muted transition-transform duration-150 group-open:rotate-90 md:mt-0"
            aria-hidden
          />
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge tone={auditTone(event.action)}>{auditLabel(event.action)}</Badge>
            <span className="truncate text-13 text-fg-secondary">
              {ENTITY_LABELS[event.entityType] ?? event.entityType}
            </span>
          </span>
          <span className="col-start-2 min-w-0 truncate text-13 text-fg md:col-start-auto">
            {auditActorName(event)}
            {event.actorRole && (
              <span className="text-fg-muted"> · {ROLE_LABELS[event.actorRole]}</span>
            )}
          </span>
          <time
            dateTime={event.createdAt}
            className="col-start-2 text-13 text-fg-muted tabular-nums md:col-start-auto md:text-right"
          >
            {formatDateTime(event.createdAt)}
          </time>
        </summary>

        <div className="flex flex-col gap-4 border-t border-dashed border-border bg-surface-muted/30 px-4 py-4 sm:px-5 md:pl-12">
          {event.reason && (
            <p className="text-13 text-fg">
              <span className="font-medium">Reason:</span> {event.reason}
            </p>
          )}
          <Changes event={event} />
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Meta label="IP address" value={event.ip} />
            <Meta label="Request ID" value={event.requestId} />
            <Meta label="Device" value={event.userAgent} />
          </dl>
          {event.entityType === 'USER' && event.entityId && (
            <Link
              to={`/staff/${event.entityId}`}
              className="inline-flex w-fit items-center gap-1 text-13 font-medium text-primary-text hover:underline"
            >
              Open account <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
      </details>
    </li>
  );
}
