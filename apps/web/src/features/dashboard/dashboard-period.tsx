import type { DashboardChartDto, DashboardPeriod } from '@gms/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardHeader } from '../../components/ui/card';
import { ErrorState, Skeleton } from '../../components/ui/states';
import { useCan, useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/format';
import { PeriodPicker } from '../reports/period-picker';
import { formatPeriod, usePeriodParams } from '../reports/report-period';
import { SeriesChart } from '../reports/series-chart';
import { useDashboardChart, useDashboardSummary } from './dashboard-api';
import { MoneyStat, Stat } from './dashboard-stats';

const NUMBER = new Intl.NumberFormat('en');

function PeriodStats({ period, currencyCode }: { period: DashboardPeriod; currencyCode: string }) {
  const money = (minor: number) => formatMoney(minor, currencyCode);
  const cells = [
    period.registrations !== null && (
      <Stat
        key="registrations"
        label="New members"
        value={NUMBER.format(period.registrations)}
        loading={false}
        hint="By registration date."
      />
    ),
    period.checkIns !== null && (
      <Stat
        key="check-ins"
        label="Check-ins"
        value={NUMBER.format(period.checkIns)}
        loading={false}
        hint="Valid entries; voided ones left out."
      />
    ),
    period.denied !== null && (
      <Stat
        key="denied"
        label="Denied entries"
        value={NUMBER.format(period.denied)}
        loading={false}
        hint="Every refused attempt at the entrance."
      />
    ),
    period.revenue && (
      <MoneyStat
        key="revenue"
        label="Net revenue"
        amount={money(period.revenue.netMinor)}
        hint={`${money(period.revenue.collectedMinor)} collected${
          period.revenue.refundedMinor > 0
            ? `, ${money(period.revenue.refundedMinor)} refunded`
            : ''
        }`}
      />
    ),
  ].filter(Boolean);
  if (cells.length === 0) return null;
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2',
        cells.length >= 4 ? 'xl:grid-cols-4' : cells.length === 3 && 'xl:grid-cols-3',
      )}
    >
      {cells}
    </div>
  );
}

function ChartCard({
  title,
  description,
  chart,
  currencyCode,
}: {
  title: string;
  description: string;
  chart: UseQueryResult<DashboardChartDto>;
  currencyCode: string;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <div
        className={cn(
          'p-4 transition-opacity duration-150 sm:p-5',
          chart.isFetching && chart.isPlaceholderData && 'opacity-60',
        )}
      >
        {chart.isPending ? (
          <div role="status" aria-label={`Loading ${title.toLowerCase()}`}>
            <Skeleton className="h-64" />
            <Skeleton className="mt-4 h-5 w-48" />
          </div>
        ) : chart.isError ? (
          <ErrorState error={chart.error} onRetry={() => chart.refetch()} />
        ) : (
          <SeriesChart
            series={chart.data.series}
            interval={chart.data.interval}
            currencyCode={currencyCode}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * Totals and trends for a chosen period (default: the last 30 days), for roles with reports.
 * The figures come from the same queries as the reports, so the two always agree.
 */
export function PeriodOverview() {
  const can = useCan();
  const { gym } = useSession();
  const period = usePeriodParams();
  const summary = useDashboardSummary();
  const seesAttendance = can('reports:operational');
  const seesRevenue = can('reports:financial');
  const valid = period.range !== null;
  const attendance = useDashboardChart('attendance', seesAttendance && valid);
  const revenue = useDashboardChart('revenue', seesRevenue && valid);
  const totals = summary.data?.period ?? null;
  const by = period.range?.interval === 'month' ? 'month' : 'day';
  const search = new URLSearchParams(
    Object.entries(period.query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString();
  const reportsLink = search ? `/reports?${search}` : '/reports';

  return (
    <section aria-labelledby="period-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="period-heading" className="text-base font-semibold tracking-tight text-fg">
            Trends
          </h2>
          <p className="text-13 text-fg-muted tabular-nums">
            {valid ? formatPeriod(period.from, period.to) : 'Choose a valid period'}
          </p>
        </div>
        {seesAttendance && (
          <Link
            to={reportsLink}
            className="group inline-flex items-center gap-1 text-13 font-medium text-primary-text hover:underline"
          >
            Open the reports
            <ArrowRight
              className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        )}
      </div>

      <Card className="p-4 sm:p-5">
        <PeriodPicker period={period} />
      </Card>

      {valid && (
        <>
          {summary.isPending ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: seesRevenue ? 4 : 3 }, (_, index) => (
                <Stat key={index} label="Loading" value={0} loading />
              ))}
            </div>
          ) : (
            totals && <PeriodStats period={totals} currencyCode={gym.currencyCode} />
          )}
          {(seesAttendance || seesRevenue) && (
            <div
              className={cn(
                'grid grid-cols-1 gap-6',
                seesAttendance && seesRevenue && '2xl:grid-cols-2',
              )}
            >
              {seesAttendance && (
                <ChartCard
                  title="Attendance"
                  description={`Check-ins and denied entries per ${by}`}
                  chart={attendance}
                  currencyCode={gym.currencyCode}
                />
              )}
              {seesRevenue && (
                <ChartCard
                  title="Revenue"
                  description={`Collected, refunded and net per ${by}`}
                  chart={revenue}
                  currencyCode={gym.currencyCode}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
