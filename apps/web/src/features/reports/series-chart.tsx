import type { ReportInterval, ReportSeries } from '@gms/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/format';
import { formatAxisValue, formatBucket, seriesColor } from './report-format';

const NUMBER = new Intl.NumberFormat('en');

const AXIS_TICK = { fill: 'var(--text-muted)', fontSize: 12 };
const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 13,
  color: 'var(--text)',
};

/**
 * A report series over time. The legend under the chart carries the period totals and a
 * screen-reader summary names the busiest bucket, so the drawing itself is hidden from
 * assistive technology (and must not be focusable).
 */
export function SeriesChart({
  series,
  interval,
  currencyCode,
  className,
}: {
  series: ReportSeries;
  interval: ReportInterval;
  currencyCode: string;
  className?: string;
}) {
  const format = (value: number) =>
    series.kind === 'money' ? formatMoney(value, currencyCode) : NUMBER.format(value);
  const totals = series.keys.map((key, index) => ({
    ...key,
    color: seriesColor(key.key, index),
    total: series.points.reduce((sum, point) => sum + (point.values[key.key] ?? 0), 0),
  }));
  const data = series.points.map((point) => ({ bucket: point.bucket, ...point.values }));
  const empty = series.points.every((point) =>
    series.keys.every((key) => (point.values[key.key] ?? 0) === 0),
  );

  const first = totals[0];
  const peak =
    first && !empty
      ? series.points.reduce((best, point) =>
          (point.values[first.key] ?? 0) > (best.values[first.key] ?? 0) ? point : best,
        )
      : null;
  const summary = [
    ...totals.map((key) => `${key.label}: ${format(key.total)}`),
    peak && first
      ? `highest ${first.label.toLowerCase()} on ${formatBucket(peak.bucket, interval, true)} (${format(peak.values[first.key] ?? 0)})`
      : null,
  ]
    .filter(Boolean)
    .join('; ');

  const chartProps = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
    accessibilityLayer: false,
  };
  const axes = (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="bucket"
        tickFormatter={(bucket: string) => formatBucket(bucket, interval)}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={{ stroke: 'var(--border)' }}
        minTickGap={20}
      />
      <YAxis
        allowDecimals={false}
        tickFormatter={(value: number) => formatAxisValue(value, series.kind)}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        width={44}
      />
      <Tooltip
        cursor={{ fill: 'var(--surface-muted)', stroke: 'var(--border-strong)' }}
        formatter={(value, name) => [format(Number(value)), String(name)]}
        labelFormatter={(bucket) => formatBucket(String(bucket), interval, true)}
        contentStyle={TOOLTIP_STYLE}
        labelStyle={{ color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}
      />
    </>
  );

  return (
    <figure className={cn('flex flex-col gap-4', className)}>
      <div className="h-64 w-full" aria-hidden>
        {empty ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border text-13 text-fg-muted">
            Nothing recorded in this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {series.kind === 'money' ? (
              <LineChart {...chartProps}>
                {axes}
                {totals.map((key) => (
                  <Line
                    key={key.key}
                    type="monotone"
                    dataKey={key.key}
                    name={key.label}
                    stroke={key.color}
                    strokeWidth={2}
                    dot={data.length <= 31 ? { r: 2.5, fill: key.color, strokeWidth: 0 } : false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart {...chartProps} barGap={2} barCategoryGap={data.length > 60 ? 1 : '20%'}>
                {axes}
                {totals.map((key) => (
                  <Bar
                    key={key.key}
                    dataKey={key.key}
                    name={key.label}
                    fill={key.color}
                    radius={[2, 2, 0, 0]}
                    maxBarSize={28}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      <figcaption>
        <ul className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Totals for the period">
          {totals.map((key) => (
            <li key={key.key} className="flex items-center gap-2 text-13">
              <span
                className="size-2.5 shrink-0 rounded-xs"
                style={{ background: key.color }}
                aria-hidden
              />
              <span className="text-fg-secondary">{key.label}</span>
              <span className="font-semibold text-fg tabular-nums">{format(key.total)}</span>
            </li>
          ))}
        </ul>
        <span className="sr-only">{summary}.</span>
      </figcaption>
    </figure>
  );
}
