import type { WorkoutLogDto } from '@gms/shared';
import { Check, Minus } from 'lucide-react';
import { formatDate } from '../../lib/format';
import { formatSeconds, groupSessions } from './workout-format';

function actuals(log: WorkoutLogDto) {
  const parts = [
    log.actualSets !== null && log.actualReps !== null
      ? `${log.actualSets} × ${log.actualReps}`
      : log.actualSets !== null
        ? `${log.actualSets} sets`
        : log.actualReps !== null
          ? `${log.actualReps} reps`
          : null,
    log.actualDurationSeconds !== null ? formatSeconds(log.actualDurationSeconds) : null,
    log.actualLoad ? `@ ${log.actualLoad}` : null,
  ];
  return parts.filter(Boolean).join(' ');
}

export function LogHistory({
  logs,
  planNames,
}: {
  logs: WorkoutLogDto[];
  planNames?: Record<string, string>;
}) {
  return (
    <ol aria-label="Logged sessions" className="divide-y divide-border">
      {groupSessions(logs).map((session) => {
        const done = session.entries.filter((entry) => entry.completed).length;
        const by = session.entries[0]?.loggedByName;
        return (
          <li key={session.key} className="px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <h3 className="text-sm font-medium text-fg">
                {formatDate(session.performedOn)}
                {planNames?.[session.entries[0]!.assignmentId] && (
                  <span className="ml-2 font-normal text-fg-muted">
                    {planNames[session.entries[0]!.assignmentId]}
                  </span>
                )}
              </h3>
              <p className="text-13 text-fg-muted tabular-nums">
                {done} of {session.entries.length} done{by ? ` · logged by ${by}` : ''}
              </p>
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {session.entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 text-13">
                  {entry.completed ? (
                    <Check
                      className="mt-0.5 size-3.5 shrink-0 text-success-text"
                      aria-label="Done"
                    />
                  ) : (
                    <Minus
                      className="mt-0.5 size-3.5 shrink-0 text-fg-muted"
                      aria-label="Skipped"
                    />
                  )}
                  <span className="min-w-0">
                    <span className={entry.completed ? 'text-fg' : 'text-fg-muted line-through'}>
                      {entry.exerciseName ?? 'Other work'}
                    </span>
                    {entry.completed && actuals(entry) && (
                      <span className="ml-2 text-fg-secondary tabular-nums">{actuals(entry)}</span>
                    )}
                    {entry.notes && <span className="block text-fg-muted">{entry.notes}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
