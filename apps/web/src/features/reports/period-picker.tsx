import { REPORT_LIMITS, type ReportInterval } from '@gms/shared';
import { useId } from 'react';
import { Input, Select } from '../../components/ui/form-field';
import { cn } from '../../lib/cn';
import { gymTodayIso } from '../../lib/format';
import { PERIOD_PRESETS, type PeriodState } from './report-period';

const FIELD_LABEL = 'text-13 font-medium text-fg';

/** Quick periods, exact dates and (optionally) the grouping, for the dashboard and reports. */
export function PeriodPicker({
  period,
  showInterval = false,
  className,
}: {
  period: PeriodState;
  showInterval?: boolean;
  className?: string;
}) {
  const id = useId();
  const today = gymTodayIso();
  const errorId = `${id}-error`;
  const invalid = period.error !== null;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="flex flex-col gap-1.5">
          <span id={`${id}-presets`} className={FIELD_LABEL}>
            Period
          </span>
          <div
            role="group"
            aria-labelledby={`${id}-presets`}
            className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface-muted/60 p-1"
          >
            {PERIOD_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                aria-pressed={period.preset === preset.value}
                onClick={() => period.setPreset(preset.value)}
                className={cn(
                  'h-8 cursor-pointer rounded-[5px] px-3 text-13 font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-offset-0',
                  period.preset === preset.value
                    ? 'bg-surface text-fg shadow-xs ring-1 ring-border'
                    : 'text-fg-secondary hover:bg-surface hover:text-fg',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-from`} className={FIELD_LABEL}>
              From
            </label>
            <Input
              id={`${id}-from`}
              type="date"
              value={period.from}
              max={period.to}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(event) =>
                event.target.value && period.setDates(event.target.value, period.to)
              }
              className="sm:w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-to`} className={FIELD_LABEL}>
              To
            </label>
            <Input
              id={`${id}-to`}
              type="date"
              value={period.to}
              min={period.from}
              max={today}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              onChange={(event) =>
                event.target.value && period.setDates(period.from, event.target.value)
              }
              className="sm:w-40"
            />
          </div>
          {showInterval && (
            <div className="col-span-2 flex flex-col gap-1.5">
              <label htmlFor={`${id}-interval`} className={FIELD_LABEL}>
                Group by
              </label>
              <Select
                id={`${id}-interval`}
                value={period.interval ?? ''}
                onChange={(event) =>
                  period.setInterval(
                    (event.target.value || undefined) as ReportInterval | undefined,
                  )
                }
                className="sm:w-44"
              >
                <option value="">Automatic</option>
                <option value="day">Day</option>
                <option value="month">Month</option>
              </Select>
            </div>
          )}
        </div>
      </div>
      {invalid ? (
        <p id={errorId} role="alert" className="text-13 text-danger-text">
          {period.error}
        </p>
      ) : (
        <p className="text-13 text-fg-muted">
          Dates are in gym time and include both ends. Up to {REPORT_LIMITS.maxRangeDays} days.
        </p>
      )}
    </div>
  );
}
