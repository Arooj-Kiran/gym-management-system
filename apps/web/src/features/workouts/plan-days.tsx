import { MUSCLE_GROUP_LABELS, type WorkoutPlanItemDto } from '@gms/shared';
import { ChevronRight } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { ExerciseThumb } from './exercise-thumb';
import { dayLabel, formatPrescription, formatSeconds, groupByDay, plural } from './workout-format';

function PlanItem({ item, index }: { item: WorkoutPlanItemDto; index: number }) {
  return (
    <li className="flex gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
      <span className="mt-0.5 w-5 shrink-0 text-right text-13 font-medium text-fg-muted tabular-nums">
        {index + 1}
      </span>
      <ExerciseThumb exercise={item.exercise} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 text-sm font-medium text-fg">
            {item.exercise.name}
            <span className="ml-2 text-13 font-normal text-fg-muted">
              {MUSCLE_GROUP_LABELS[item.exercise.muscleGroup]}
            </span>
          </p>
          <p className="text-sm font-semibold text-fg tabular-nums">
            {formatPrescription(item)}
            {item.loadNote && (
              <span className="ml-1.5 font-normal text-fg-secondary">@ {item.loadNote}</span>
            )}
          </p>
        </div>
        <p className="mt-0.5 text-13 text-fg-muted">
          {plural(item.sets, 'set')}
          {item.reps !== null && ` of ${plural(item.reps, 'rep')}`}
          {item.durationSeconds !== null && ` · ${formatSeconds(item.durationSeconds)} each`}
          {' · '}
          {item.restSeconds > 0 ? `${formatSeconds(item.restSeconds)} rest` : 'no rest'}
        </p>
        {item.notes && <p className="mt-1 text-13 text-fg-secondary">{item.notes}</p>}
        {item.exercise.instructions && (
          <details className="group mt-1.5">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-13 font-medium text-primary-text hover:underline [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-3.5 transition-transform duration-150 group-open:rotate-90"
                aria-hidden
              />
              How to do it
            </summary>
            <p className="mt-1.5 max-w-prose text-13 whitespace-pre-line text-fg-secondary">
              {item.exercise.instructions}
            </p>
          </details>
        )}
      </div>
    </li>
  );
}

/** A plan's exercises, one card per training day. */
export function PlanDays({
  items,
  labelPrefix,
}: {
  items: WorkoutPlanItemDto[];
  labelPrefix?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {groupByDay(items).map(({ day, items: dayItems }) => (
        <Card key={day}>
          <h3 className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
            <span className="text-sm font-semibold text-fg">{dayLabel(day)}</span>
            <span className="text-13 text-fg-muted">{plural(dayItems.length, 'exercise')}</span>
          </h3>
          <ol
            aria-label={`${labelPrefix ? `${labelPrefix} ` : ''}${dayLabel(day)}`}
            className="divide-y divide-border"
          >
            {dayItems.map((item, index) => (
              <PlanItem key={item.id} item={item} index={index} />
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
