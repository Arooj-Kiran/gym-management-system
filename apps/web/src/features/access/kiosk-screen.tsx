import {
  KIOSK_IDLE_PROMPT,
  KIOSK_RESET_MS,
  SIMULATED_BANNER,
  type AccessDecision,
} from '@gms/shared';
import { CircleCheck, CircleX, FlaskConical, Fingerprint, ScanSearch } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { formatDate } from '../../lib/format';
import type { StreamStatus } from './access-api';

type Outcome = 'granted' | 'denied' | 'unknown';

/** A grant needs both fields to agree; anything else is shown as a denial. */
function outcomeOf(decision: AccessDecision): Outcome {
  if (decision.decision === 'GRANTED' && decision.reason === 'GRANTED') return 'granted';
  return decision.reason === 'MEMBER_NOT_RECOGNIZED' ? 'unknown' : 'denied';
}

const OUTCOME_STYLE: Record<Outcome, { icon: typeof CircleCheck; text: string; ring: string }> = {
  granted: { icon: CircleCheck, text: 'text-kiosk-granted', ring: 'ring-kiosk-granted/40' },
  denied: { icon: CircleX, text: 'text-kiosk-denied', ring: 'ring-kiosk-denied/40' },
  unknown: { icon: ScanSearch, text: 'text-kiosk-unknown', ring: 'ring-kiosk-unknown/40' },
};

export function SimulatedBanner({ className }: { className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        'flex items-center justify-center gap-2 bg-kiosk-sim-bg px-4 py-2 text-center text-13 font-semibold tracking-wide text-kiosk-sim-fg',
        className,
      )}
    >
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      {SIMULATED_BANNER}
    </p>
  );
}

const STATUS_COPY: Record<StreamStatus, string> = {
  connecting: 'Connecting to the server…',
  live: 'Live',
  reconnecting: 'Connection lost. Reconnecting…',
};

function StreamIndicator({ status }: { status: StreamStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-13 text-kiosk-fg-muted">
      <span
        className={cn(
          'size-2 rounded-full',
          status === 'live' ? 'bg-kiosk-granted' : 'animate-pulse bg-kiosk-unknown',
        )}
        aria-hidden
      />
      {STATUS_COPY[status]}
    </span>
  );
}

function ResultView({ decision, large }: { decision: AccessDecision; large: boolean }) {
  const outcome = outcomeOf(decision);
  const style = OUTCOME_STYLE[outcome];
  const Icon = style.icon;
  const photo = outcome === 'granted' ? decision.member?.photoUrl : null;
  return (
    <div className="flex flex-col items-center text-center animate-pop-in">
      {photo ? (
        <img
          src={photo}
          alt=""
          className={cn(
            'rounded-full object-cover ring-4',
            style.ring,
            large ? 'size-32' : 'size-20',
          )}
        />
      ) : (
        <span
          className={cn(
            'flex items-center justify-center rounded-full bg-kiosk-panel ring-4',
            style.ring,
            large ? 'size-32' : 'size-20',
          )}
        >
          <Icon className={cn(style.text, large ? 'size-16' : 'size-10')} aria-hidden />
        </span>
      )}
      <p
        className={cn(
          'mt-6 font-semibold tracking-tight',
          style.text,
          large ? 'text-5xl sm:text-6xl' : 'text-3xl',
        )}
      >
        {decision.title}
      </p>
      <p
        className={cn(
          'mt-3 max-w-xl text-kiosk-fg',
          large ? 'text-2xl leading-snug sm:text-3xl' : 'text-lg',
        )}
      >
        {decision.message}
      </p>
      {outcome === 'granted' && decision.membership && (
        <p className={cn('mt-4 text-kiosk-fg-muted', large ? 'text-lg' : 'text-13')}>
          {decision.membership.planName} · until {formatDate(decision.membership.endDate)}
        </p>
      )}
      {decision.duplicate && (
        <p className={cn('mt-3 text-kiosk-fg-muted', large ? 'text-base' : 'text-13')}>
          Already scanned a moment ago. This scan was not counted again.
        </p>
      )}
    </div>
  );
}

/**
 * The entrance screen. `simulated` keeps the amber banner up the whole time for a SIMULATED
 * device; a SIMULATED decision also raises it, whatever the device.
 */
export function KioskScreen({
  result,
  simulated,
  status,
  variant = 'preview',
  header,
  footer,
}: {
  result: AccessDecision | null;
  simulated: boolean;
  status: StreamStatus;
  variant?: 'preview' | 'full';
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const large = variant === 'full';
  const showBanner = simulated || result?.source === 'SIMULATED';
  return (
    <section
      aria-label="Entrance screen"
      className={cn(
        'relative flex flex-col overflow-hidden bg-kiosk-bg text-kiosk-fg',
        large ? 'min-h-dvh' : 'min-h-[380px] rounded-xl ring-1 ring-border',
      )}
    >
      {showBanner && <SimulatedBanner className={large ? 'py-3 text-sm' : undefined} />}
      {header}
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center',
          large ? 'px-6 py-12' : 'px-5 py-10',
        )}
        aria-live="assertive"
        aria-atomic="true"
      >
        {result ? (
          <ResultView key={result.attemptId ?? result.occurredAt} decision={result} large={large} />
        ) : (
          <div className="flex flex-col items-center text-center">
            <span
              className={cn(
                'flex items-center justify-center rounded-full bg-kiosk-panel ring-1 ring-white/10',
                large ? 'size-32' : 'size-20',
              )}
            >
              <Fingerprint
                className={cn('text-kiosk-fg-muted', large ? 'size-16' : 'size-10')}
                aria-hidden
              />
            </span>
            <p
              className={cn(
                'mt-6 font-medium tracking-tight text-kiosk-fg',
                large ? 'text-4xl sm:text-5xl' : 'text-2xl',
              )}
            >
              {KIOSK_IDLE_PROMPT}
            </p>
          </div>
        )}
      </div>
      {result && (
        <div className="h-1 bg-kiosk-panel" aria-hidden>
          <div
            key={result.attemptId ?? result.occurredAt}
            className="h-full origin-left animate-countdown bg-kiosk-fg-muted/60"
            style={{ animationDuration: `${KIOSK_RESET_MS}ms` }}
          />
        </div>
      )}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 border-t border-white/10',
          large ? 'px-6 py-4' : 'px-4 py-3',
        )}
      >
        <StreamIndicator status={status} />
        {footer}
      </div>
    </section>
  );
}
