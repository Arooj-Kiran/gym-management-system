import {
  ACCESS_REASON_LABELS,
  SIM_UNENROLLED_REF,
  SIMULATOR_SCENARIO_LABELS,
  SIMULATOR_SCENARIOS,
  type AccessDecision,
  type AccessReason,
  type SimulatorFixture,
  type SimulatorScenario,
} from '@gms/shared';
import { Fingerprint, LoaderCircle, ServerCrash, ScanSearch, Unplug } from 'lucide-react';
import { useState } from 'react';
import { Badge, type BadgeTone } from '../../components/ui/badge';
import { Card, CardHeader } from '../../components/ui/card';
import { ErrorState, ListSkeleton } from '../../components/ui/states';
import { cn } from '../../lib/cn';
import { useSimulateScan, useSimulatorFixtures } from './access-api';

const SCENARIO_ICONS: Record<SimulatorScenario, typeof Fingerprint> = {
  NO_MATCH: ScanSearch,
  SCANNER_UNAVAILABLE: Unplug,
  AUTHORIZATION_UNAVAILABLE: ServerCrash,
};

const SCENARIO_HINTS: Record<SimulatorScenario, string> = {
  NO_MATCH: 'The scanner finds no matching fingerprint',
  SCANNER_UNAVAILABLE: 'The scanner reports a hardware error',
  AUTHORIZATION_UNAVAILABLE: 'The server cannot read membership data',
};

function expectedTone(reason: AccessReason): BadgeTone {
  if (reason === 'GRANTED') return 'success';
  if (reason === 'MEMBER_NOT_RECOGNIZED') return 'warning';
  return 'danger';
}

const ROW = cn(
  'flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 sm:px-5',
  'hover:bg-surface-hover focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
);

/**
 * Staff stand-in for a SIMULATED scanner (PLAN §6.5). It only sends a fake device user ID; the
 * server makes the decision from current data, exactly as for a real scan. Not rendered when the
 * simulator is switched off.
 */
export function SimulatorPanel({
  deviceId,
  onDecision,
}: {
  deviceId: string;
  onDecision: (decision: AccessDecision) => void;
}) {
  const fixtures = useSimulatorFixtures(true);
  const simulate = useSimulateScan();
  const [active, setActive] = useState<string | null>(null);

  if (fixtures.data === null) return null;

  const scan = (key: string, input: { templateRef?: string; scenario?: SimulatorScenario }) => {
    setActive(key);
    simulate.mutate(
      { deviceId, ...input },
      { onSuccess: onDecision, onSettled: () => setActive(null) },
    );
  };

  const rows: SimulatorFixture[] = (fixtures.data?.fixtures ?? []).filter(
    (fixture) => fixture.deviceId === deviceId,
  );
  const enrolled = rows.filter((fixture) => fixture.templateRef !== SIM_UNENROLLED_REF);
  const unenrolled = rows.find((fixture) => fixture.templateRef === SIM_UNENROLLED_REF);

  return (
    <Card>
      <CardHeader
        title="Simulated scanner"
        description="Fake fingerprints for testing. The server still decides from current membership data."
        action={<Badge tone="warning">SIMULATED</Badge>}
      />
      {fixtures.isPending ? (
        <ListSkeleton rows={4} label="Loading fake fingerprints" />
      ) : fixtures.isError ? (
        <ErrorState error={fixtures.error} onRetry={() => fixtures.refetch()} />
      ) : (
        <>
          <h3 className="border-b border-border bg-surface-muted/60 px-4 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase sm:px-5">
            Enrolled on this device
          </h3>
          {enrolled.length === 0 ? (
            <p className="px-4 py-4 text-13 text-fg-muted sm:px-5">
              No fingerprints are enrolled on this device yet. Enroll one from a member’s page
              (Fingerprint card).
            </p>
          ) : (
            <ul className="divide-y divide-border" aria-label="Fake fingerprints">
              {enrolled.map((fixture) => (
                <li key={fixture.templateRef}>
                  <button
                    type="button"
                    className={ROW}
                    disabled={simulate.isPending}
                    onClick={() => scan(fixture.templateRef, { templateRef: fixture.templateRef })}
                    aria-label={`Scan ${fixture.label} (${fixture.templateRef})`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-text">
                      {active === fixture.templateRef ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Fingerprint className="size-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {fixture.label}
                      </span>
                      <span className="block font-mono text-xs text-fg-muted">
                        {fixture.templateRef}
                      </span>
                    </span>
                    <Badge tone={expectedTone(fixture.expected)}>
                      <span className="sr-only">Expected now: </span>
                      {ACCESS_REASON_LABELS[fixture.expected]}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3 className="border-y border-border bg-surface-muted/60 px-4 py-2 text-xs font-medium tracking-wide text-fg-muted uppercase sm:px-5">
            Failure cases
          </h3>
          <ul className="divide-y divide-border" aria-label="Failure cases">
            {unenrolled && (
              <li>
                <button
                  type="button"
                  className={ROW}
                  disabled={simulate.isPending}
                  onClick={() =>
                    scan(unenrolled.templateRef, { templateRef: unenrolled.templateRef })
                  }
                  aria-label={`Scan ${unenrolled.label} (${unenrolled.templateRef}, not enrolled)`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-secondary">
                    {active === unenrolled.templateRef ? (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Fingerprint className="size-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-fg">{unenrolled.label}</span>
                    <span className="block font-mono text-xs text-fg-muted">
                      {unenrolled.templateRef} · not enrolled
                    </span>
                  </span>
                </button>
              </li>
            )}
            {SIMULATOR_SCENARIOS.map((scenario) => {
              const Icon = SCENARIO_ICONS[scenario];
              // The server fails the membership lookup for a recognised fingerprint.
              const needsMatch = scenario === 'AUTHORIZATION_UNAVAILABLE';
              const templateRef = needsMatch ? enrolled[0]?.templateRef : undefined;
              const unavailable = needsMatch && !templateRef;
              return (
                <li key={scenario}>
                  <button
                    type="button"
                    className={ROW}
                    disabled={simulate.isPending || unavailable}
                    onClick={() => scan(scenario, { scenario, templateRef })}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-fg-secondary">
                      {active === scenario ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Icon className="size-4" aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-fg">
                        {SIMULATOR_SCENARIO_LABELS[scenario]}
                      </span>
                      <span className="block text-xs text-fg-muted">
                        {unavailable
                          ? 'Enroll a fingerprint on this device first'
                          : SCENARIO_HINTS[scenario]}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
