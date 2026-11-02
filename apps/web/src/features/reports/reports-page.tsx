import {
  FINANCIAL_REPORT_TYPES,
  REPORT_DESCRIPTIONS,
  REPORT_LABELS,
  REPORT_TYPES,
  reportTypesForRole,
  type ReportBreakdown,
  type ReportDto,
  type ReportMetric,
  type ReportType,
} from '@gms/shared';
import { ChartColumn, Download, FileSpreadsheet, Info } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { errorMessage } from '../../api/client';
import { Button } from '../../components/ui/button';
import { Card, CardHeader } from '../../components/ui/card';
import { FormField, Select } from '../../components/ui/form-field';
import { PageHeader } from '../../components/ui/page-header';
import { Pagination } from '../../components/ui/pagination';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/states';
import { useSession } from '../../lib/auth';
import { cn } from '../../lib/cn';
import { formatTime } from '../../lib/format';
import { PeriodPicker } from './period-picker';
import { formatPeriod, usePeriodParams } from './report-period';
import { formatReportValue, isNumericKind } from './report-format';
import { useDownloadReport, useReport } from './reports-api';
import { SeriesChart } from './series-chart';

const PAGE_SIZE = 50;
const FINANCIAL = new Set<ReportType>(FINANCIAL_REPORT_TYPES);

function ReportNav({ types, current }: { types: ReportType[]; current: ReportType }) {
  const [params] = useSearchParams();
  const groups = [
    { title: 'Operations', types: types.filter((type) => !FINANCIAL.has(type)) },
    { title: 'Finance', types: types.filter((type) => FINANCIAL.has(type)) },
  ].filter((group) => group.types.length > 0);
  const linkTo = (type: ReportType) => {
    const next = new URLSearchParams(params);
    next.set('type', type);
    return { search: next.toString() };
  };

  return (
    <nav aria-label="Report types" className="hidden xl:block">
      <div className="sticky top-6 flex flex-col gap-5">
        {groups.map((group) => (
          <div key={group.title}>
            <h2 className="px-3 pb-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase">
              {group.title}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.types.map((type) => (
                <li key={type}>
                  <Link
                    to={linkTo(type)}
                    replace
                    aria-current={type === current ? 'page' : undefined}
                    className={cn(
                      'block rounded-md px-3 py-2 text-13 transition-colors duration-150 focus-visible:outline-offset-0',
                      type === current
                        ? 'bg-primary-subtle font-medium text-primary-text'
                        : 'text-fg-secondary hover:bg-surface-muted hover:text-fg',
                    )}
                  >
                    {REPORT_LABELS[type]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function MetricCard({ metric, currencyCode }: { metric: ReportMetric; currencyCode: string }) {
  return (
    <Card className="px-4 py-4 sm:px-5">
      <p className="text-13 font-medium text-fg-secondary">{metric.label}</p>
      <p className="mt-1 truncate text-2xl leading-8 font-semibold tracking-tight text-fg tabular-nums">
        {formatReportValue(metric.kind, metric.value, currencyCode)}
      </p>
      {metric.hint && <p className="mt-0.5 text-13 text-fg-muted">{metric.hint}</p>}
    </Card>
  );
}

function BreakdownList({
  breakdown,
  currencyCode,
}: {
  breakdown: ReportBreakdown;
  currencyCode: string;
}) {
  const max = Math.max(1, ...breakdown.items.map((item) => item.value));
  const total = breakdown.items.reduce((sum, item) => sum + item.value, 0);
  return (
    <Card className="flex flex-col">
      <CardHeader title={breakdown.title} />
      {breakdown.items.length === 0 ? (
        <p className="px-4 py-10 text-center text-13 text-fg-muted sm:px-5">
          Nothing to break down in this period.
        </p>
      ) : (
        <ul className="flex flex-col gap-3.5 px-4 py-4 sm:px-5">
          {breakdown.items.map((item) => (
            <li key={item.key}>
              <div className="flex items-baseline justify-between gap-3 text-13">
                <span className="min-w-0 truncate text-fg-secondary">{item.label}</span>
                <span className="shrink-0 font-semibold text-fg tabular-nums">
                  {formatReportValue(breakdown.kind, item.value, currencyCode)}
                  {total > 0 && (
                    <span className="ml-1.5 font-normal text-fg-muted">
                      {Math.round((item.value / total) * 100)}%
                    </span>
                  )}
                </span>
              </div>
              <div
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(0, (item.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReportTable({ report, currencyCode }: { report: ReportDto; currencyCode: string }) {
  const [page, setPage] = useState(1);
  const rows = report.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const headingId = `report-rows-${report.type}`;

  return (
    <Card>
      <CardHeader
        id={headingId}
        title="Details"
        description={
          report.totalRows === 1 ? 'One row' : `${report.totalRows.toLocaleString('en')} rows`
        }
      />
      {report.truncated && (
        <p className="flex items-start gap-2 border-b border-border bg-warning-subtle px-4 py-3 text-13 text-warning-text sm:px-5">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Showing the first {report.rows.length.toLocaleString('en')} of{' '}
            {report.totalRows.toLocaleString('en')} rows, here and in the CSV. The figures and chart
            above cover the whole period; choose a shorter period to list every row.
          </span>
        </p>
      )}
      {report.rows.length === 0 ? (
        <EmptyState
          icon={<FileSpreadsheet aria-hidden />}
          title="No rows in this period"
          description="Try a longer period, or check another report."
        />
      ) : (
        <>
          <div
            role="region"
            aria-labelledby={headingId}
            tabIndex={0}
            className="overflow-x-auto focus-visible:-outline-offset-2"
          >
            <table className="w-full min-w-[40rem] text-left text-13">
              <thead className="bg-surface-muted/60 text-xs tracking-wide text-fg-muted uppercase">
                <tr>
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn(
                        'px-3 py-2 font-medium whitespace-nowrap first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5',
                        isNumericKind(column.kind) && 'text-right',
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row, index) => (
                  <tr key={(page - 1) * PAGE_SIZE + index} className="hover:bg-surface-hover">
                    {report.columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          'px-3 py-2.5 align-top first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5',
                          isNumericKind(column.kind)
                            ? 'text-right whitespace-nowrap text-fg tabular-nums'
                            : 'text-fg-secondary',
                          column.kind === 'date' || column.kind === 'datetime'
                            ? 'whitespace-nowrap'
                            : null,
                        )}
                      >
                        {formatReportValue(column.kind, row[column.key], currencyCode)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.rows.length > PAGE_SIZE && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={report.rows.length}
              onPageChange={setPage}
              noun="rows"
            />
          )}
        </>
      )}
    </Card>
  );
}

function ReportSkeleton() {
  return (
    <div role="status" aria-label="Loading report" className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-[5.5rem]" />
        ))}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-64" />
    </div>
  );
}

function ReportView({ report, currencyCode }: { report: ReportDto; currencyCode: string }) {
  const by = report.interval === 'month' ? 'month' : 'day';
  return (
    <>
      {report.summary.length > 0 && (
        <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {report.summary.map((metric) => (
            <MetricCard key={metric.key} metric={metric} currencyCode={currencyCode} />
          ))}
        </section>
      )}
      {(report.series || report.breakdown) && (
        <div
          className={cn(
            'grid grid-cols-1 gap-6',
            report.series && report.breakdown && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',
          )}
        >
          {report.series && (
            <Card>
              <CardHeader title={`By ${by}`} description={formatPeriod(report.from, report.to)} />
              <div className="p-4 sm:p-5">
                <SeriesChart
                  series={report.series}
                  interval={report.interval}
                  currencyCode={currencyCode}
                />
              </div>
            </Card>
          )}
          {report.breakdown && (
            <BreakdownList breakdown={report.breakdown} currencyCode={currencyCode} />
          )}
        </div>
      )}
      {/* A new period or report starts again on the first page of rows. */}
      <ReportTable
        key={`${report.type}:${report.from}:${report.to}`}
        report={report}
        currencyCode={currencyCode}
      />
    </>
  );
}

/** PLAN §4.9: eleven reports, each role offered only what it may open (financial ones restricted). */
export function ReportsPage() {
  const { user, gym } = useSession();
  const [params, setParams] = useSearchParams();
  const period = usePeriodParams();
  const types = reportTypesForRole(user.role);
  const requested = params.get('type') as ReportType | null;
  const type = requested && types.includes(requested) ? requested : (types[0] ?? null);
  const query = period.query;
  const report = useReport(type, query, period.range !== null);
  const download = useDownloadReport();
  // keepPreviousData may still hold the report that was open before: never show it as this one.
  const current = report.data && report.data.type === type ? report.data : null;
  const refreshing = report.isFetching && report.isPlaceholderData;

  const chooseType = (next: string) =>
    setParams(
      (existing) => {
        const updated = new URLSearchParams(existing);
        updated.set('type', next);
        return updated;
      },
      { replace: true },
    );

  const startDownload = () => {
    if (!type) return;
    download.mutate(
      { type, query },
      {
        onSuccess: (filename) => toast.success(`Downloaded ${filename}`),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  if (!type)
    return (
      <>
        <PageHeader title="Reports" />
        <Card>
          <EmptyState
            icon={<ChartColumn aria-hidden />}
            title="No reports for your role"
            description="Ask an Admin if you need figures for your work."
          />
        </Card>
      </>
    );

  return (
    <>
      <PageHeader
        title="Reports"
        description="Figures for any period up to a year, in gym time. Download any report as a CSV for Excel."
        actions={
          <Button
            variant="secondary"
            icon={<Download aria-hidden />}
            onClick={startDownload}
            loading={download.isPending}
            disabled={period.range === null}
          >
            Download CSV
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[13.5rem_minmax(0,1fr)]">
        <ReportNav types={types} current={type} />

        <div className="flex min-w-0 flex-col gap-6">
          <Card className="flex flex-col gap-4 p-4 sm:p-5">
            <FormField label="Report" className="xl:hidden">
              <Select value={type} onChange={(event) => chooseType(event.target.value)}>
                {[
                  { label: 'Operations', financial: false },
                  { label: 'Finance', financial: true },
                ].map((group) => {
                  const options = REPORT_TYPES.filter(
                    (option) => types.includes(option) && FINANCIAL.has(option) === group.financial,
                  );
                  return options.length === 0 ? null : (
                    <optgroup key={group.label} label={group.label}>
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {REPORT_LABELS[option]}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
            </FormField>
            <PeriodPicker period={period} showInterval />
          </Card>

          <section
            aria-labelledby="report-title"
            aria-busy={refreshing || undefined}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col gap-1">
              <h2
                id="report-title"
                className="text-lg font-semibold tracking-tight text-fg sm:text-xl"
              >
                {REPORT_LABELS[type]}
              </h2>
              <p className="max-w-2xl text-sm text-fg-secondary">{REPORT_DESCRIPTIONS[type]}</p>
              {current && (
                <p className="text-13 text-fg-muted tabular-nums">
                  {formatPeriod(current.from, current.to)} · by{' '}
                  {current.interval === 'month' ? 'month' : 'day'} · generated at{' '}
                  {formatTime(current.generatedAt)}
                </p>
              )}
            </div>

            {period.range === null ? (
              <Card>
                <EmptyState
                  icon={<ChartColumn aria-hidden />}
                  title="Choose a valid period"
                  description={period.error}
                />
              </Card>
            ) : report.isError ? (
              <Card>
                <ErrorState
                  error={report.error}
                  title="This report could not be run"
                  onRetry={() => report.refetch()}
                />
              </Card>
            ) : !current ? (
              <ReportSkeleton />
            ) : (
              <div
                className={cn(
                  'flex flex-col gap-6 transition-opacity duration-150',
                  refreshing && 'opacity-60',
                )}
              >
                <ReportView report={current} currencyCode={gym.currencyCode} />
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
