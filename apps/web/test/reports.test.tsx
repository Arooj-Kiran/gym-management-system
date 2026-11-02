import type { DashboardChartDto, DashboardSummary, ReportDto, ReportType, Role } from '@gms/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DashboardPage } from '../src/features/dashboard/dashboard-page';
import {
  formatAxisValue,
  formatBucket,
  formatReportValue,
} from '../src/features/reports/report-format';
import { matchPreset, presetRange } from '../src/features/reports/report-period';
import { ReportsPage } from '../src/features/reports/reports-page';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const PERIOD = '?from=2026-10-01&to=2026-10-26';

function attendanceReport(overrides: Partial<ReportDto> = {}): ReportDto {
  return {
    type: 'attendance',
    title: 'Attendance',
    from: '2026-10-01',
    to: '2026-10-26',
    interval: 'day',
    generatedAt: '2026-10-26T07:15:00.000Z',
    summary: [
      { key: 'checkIns', label: 'Check-ins', value: 1284, kind: 'number' },
      { key: 'members', label: 'Members who came', value: 213, kind: 'number' },
    ],
    series: {
      kind: 'number',
      keys: [{ key: 'checkIns', label: 'Check-ins' }],
      points: [
        { bucket: '2026-10-01', values: { checkIns: 52 } },
        { bucket: '2026-10-02', values: { checkIns: 61 } },
      ],
    },
    breakdown: {
      title: 'By source',
      kind: 'number',
      items: [
        { key: 'BIOMETRIC', label: 'Fingerprint', value: 1100 },
        { key: 'MANUAL', label: 'Manual', value: 184 },
      ],
    },
    columns: [
      { key: 'checkInAt', label: 'Checked in', kind: 'datetime' },
      { key: 'member', label: 'Member', kind: 'text' },
      { key: 'memberCode', label: 'Code', kind: 'text' },
    ],
    rows: [
      {
        checkInAt: '2026-10-26T05:02:00.000Z',
        member: 'Sana Qureshi',
        memberCode: 'M-00021',
      },
      { checkInAt: '2026-10-26T04:48:00.000Z', member: 'Bilal Ahmed', memberCode: 'M-00007' },
    ],
    totalRows: 2,
    truncated: false,
    ...overrides,
  };
}

/** Serves the reports API; records every URL so tests can check what was asked for. */
function serveReports(report: (type: ReportType) => ReportDto | null) {
  const urls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    urls.push(url);
    const match = /\/reports\/([a-z-]+)/.exec(url);
    if (match && url.includes('format=csv')) {
      return new Response('Checked in,Member\r\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${match[1]}_2026-10-01_2026-10-26.csv"`,
        },
      });
    }
    return mockFetch(() => {
      const body = match ? report(match[1] as ReportType) : null;
      return body
        ? { status: 200, body }
        : { status: 403, body: { error: { code: 'FORBIDDEN', message: 'Not allowed' } } };
    })(input, init);
  });
  return urls;
}

function renderReports(role: Role, path = `/reports${PERIOD}`) {
  return renderWithProviders(<ReportsPage />, { me: fakeMe(role), path });
}

describe('report formatting', () => {
  it('formats each value kind, with a dash for missing values', () => {
    expect(formatReportValue('money', 450_050, 'PKR')).toMatch(/4,500\.50/);
    expect(formatReportValue('number', 1284, 'PKR')).toBe('1,284');
    expect(formatReportValue('percent', 12.5, 'PKR')).toBe('12.5%');
    expect(formatReportValue('text', null, 'PKR')).toBe('—');
    expect(formatReportValue('date', '2026-10-01', 'PKR')).toBe('01 Oct 2026');
  });

  it('labels day and month buckets, and shortens axis values', () => {
    expect(formatBucket('2026-10-01', 'day')).toBe('1 Oct');
    expect(formatBucket('2026-10', 'month')).toBe('Oct 2026');
    expect(formatAxisValue(12_500, 'number')).toBe('12.5K');
    expect(formatAxisValue(1_250_000, 'money')).toBe('12.5K');
  });

  it('turns presets into inclusive periods and recognises them again', () => {
    expect(presetRange('7d', '2026-10-26')).toEqual({ from: '2026-10-20', to: '2026-10-26' });
    expect(presetRange('month', '2026-10-26')).toEqual({ from: '2026-10-01', to: '2026-10-26' });
    expect(matchPreset('2026-09-27', '2026-10-26', '2026-10-26')).toBe('30d');
    expect(matchPreset('2026-09-28', '2026-10-26', '2026-10-26')).toBeNull();
  });
});

describe('reports page', () => {
  it('offers the Receptionist only attendance and denied entries', async () => {
    const urls = serveReports((type) => attendanceReport({ type }));
    renderReports('RECEPTIONIST');

    const select = await screen.findByRole('combobox', { name: 'Report' });
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Attendance', 'Denied entry attempts']);
    expect(screen.queryByRole('group', { name: 'Finance' })).not.toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Attendance', level: 2 });
    expect(urls.every((url) => !/\/reports\/(payments|revenue|outstanding)/.test(url))).toBe(true);
  });

  it('ignores a financial report in the URL for a role that may not open it', async () => {
    const urls = serveReports((type) => attendanceReport({ type }));
    renderReports('RECEPTIONIST', `/reports${PERIOD}&type=revenue`);

    await screen.findByRole('heading', { name: 'Attendance', level: 2 });
    expect(urls.some((url) => url.includes('/reports/revenue'))).toBe(false);
  });

  it('shows the summary, the chart totals, the breakdown and the rows', async () => {
    const urls = serveReports((type) => (type === 'attendance' ? attendanceReport() : null));
    renderReports('RECEPTIONIST');

    const summary = await screen.findByRole('region', { name: 'Summary' });
    expect(within(summary).getByText('1,284')).toBeInTheDocument();
    expect(within(summary).getByText('Members who came')).toBeInTheDocument();
    const totals = screen.getByRole('list', { name: 'Totals for the period' });
    expect(within(totals).getByText('113')).toBeInTheDocument();
    expect(screen.getByText('By source')).toBeInTheDocument();
    expect(screen.getByText('86%')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Checked in', 'Member', 'Code']);
    expect(within(table).getByText('Sana Qureshi')).toBeInTheDocument();
    expect(screen.getByText('2 rows')).toBeInTheDocument();
    expect(urls[0]).toContain('/reports/attendance?from=2026-10-01&to=2026-10-26');
  });

  it('says when the rows were cut short, here and in the CSV', async () => {
    serveReports((type) => attendanceReport({ type, totalRows: 7_310, truncated: true }));
    renderReports('MANAGER');

    expect(
      await screen.findByText(/Showing the first 2 of 7,310 rows, here and in the CSV/),
    ).toBeInTheDocument();
  });

  it('downloads the CSV under the server’s file name', async () => {
    const user = userEvent.setup();
    const urls = serveReports((type) => attendanceReport({ type }));
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderReports('RECEPTIONIST');

    await screen.findByRole('region', { name: 'Summary' });
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));

    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('attendance_2026-10-01_2026-10-26.csv');
    expect(createObjectURL).toHaveBeenCalledOnce();
    const csvUrl = urls.find((url) => url.includes('format=csv'));
    expect(csvUrl).toContain('/reports/attendance?');
    expect(csvUrl).toContain('from=2026-10-01');
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:report'));
  });

  it('refuses a backwards period without asking the server', async () => {
    const urls = serveReports((type) => attendanceReport({ type }));
    renderReports('MANAGER', '/reports?from=2026-10-20&to=2026-10-01');

    expect(await screen.findByRole('alert')).toHaveTextContent('"To" must be on or after "From"');
    expect(screen.getByLabelText('To')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
    expect(screen.getByText('Choose a valid period')).toBeInTheDocument();
    expect(urls.filter((url) => url.includes('/reports/'))).toEqual([]);
  });

  it('shows an error with a retry when the server refuses', async () => {
    serveReports(() => null);
    renderReports('MANAGER');

    expect(await screen.findByText('This report could not be run')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('switches the period with a preset and asks for the new dates', async () => {
    const user = userEvent.setup();
    const urls = serveReports((type) => attendanceReport({ type }));
    const { router } = renderReports('MANAGER');

    await screen.findByRole('region', { name: 'Summary' });
    await user.click(screen.getByRole('button', { name: '7 days' }));

    await waitFor(() => expect(router.state.location.search).toMatch(/from=\d{4}-\d{2}-\d{2}/));
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(urls.length).toBeGreaterThan(1));
  });
});

const SERIES_POINTS = [
  { bucket: '2026-10-01', values: { checkIns: 40, denied: 3 } },
  { bucket: '2026-10-02', values: { checkIns: 45, denied: 1 } },
];

function summaryFor(role: Role): DashboardSummary {
  const staff = role !== 'TRAINER';
  return {
    period: staff
      ? {
          from: '2026-09-27',
          to: '2026-10-26',
          registrations: 6,
          checkIns: 85,
          denied: 4,
          revenue:
            role === 'ADMIN' || role === 'MANAGER'
              ? {
                  collectedMinor: 1_200_000,
                  refundedMinor: 50_000,
                  netMinor: 1_150_000,
                  paymentCount: 9,
                }
              : null,
        }
      : null,
    members: staff ? { total: 214, registeredToday: 1 } : null,
    memberships: null,
    attendance: staff ? { checkInsToday: 12, deniedToday: 1, recentCheckIns: [] } : null,
    billing: null,
    trainer: role === 'TRAINER' ? { today: [], upcoming: [], assignedMembers: 5 } : null,
  };
}

function serveDashboard(role: Role) {
  const urls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url) => {
      urls.push(url);
      if (url.includes('/dashboard/summary')) return { status: 200, body: summaryFor(role) };
      if (url.includes('/dashboard/charts/attendance')) {
        const body: DashboardChartDto = {
          from: '2026-09-27',
          to: '2026-10-26',
          interval: 'day',
          series: {
            kind: 'number',
            keys: [
              { key: 'checkIns', label: 'Check-ins' },
              { key: 'denied', label: 'Denied' },
            ],
            points: SERIES_POINTS,
          },
        };
        return { status: 200, body };
      }
      if (url.includes('/dashboard/charts/revenue')) {
        const body: DashboardChartDto = {
          from: '2026-09-27',
          to: '2026-10-26',
          interval: 'day',
          series: {
            kind: 'money',
            keys: [
              { key: 'collected', label: 'Collected' },
              { key: 'refunded', label: 'Refunded' },
              { key: 'net', label: 'Net' },
            ],
            points: [
              { bucket: '2026-10-01', values: { collected: 600_000, refunded: 0, net: 600_000 } },
            ],
          },
        };
        return { status: 200, body };
      }
      if (url.includes('/dashboard/activity')) return { status: 200, body: [] };
      return { status: 200, body: { data: [], total: 0, page: 1, pageSize: 1 } };
    }),
  );
  return urls;
}

describe('dashboard trends', () => {
  it('gives the Manager period totals, revenue and both charts', async () => {
    const urls = serveDashboard('MANAGER');
    renderWithProviders(<DashboardPage />, { me: fakeMe('MANAGER') });

    const trends = await screen.findByRole('region', { name: 'Trends' });
    expect(await within(trends).findByText('Net revenue')).toBeInTheDocument();
    // The period stat and the chart's check-in total.
    expect(within(trends).getAllByText('85')).toHaveLength(2);
    expect(await within(trends).findByRole('heading', { name: 'Attendance' })).toBeInTheDocument();
    expect(within(trends).getByRole('heading', { name: 'Revenue' })).toBeInTheDocument();
    const lists = await within(trends).findAllByRole('list', { name: 'Totals for the period' });
    expect(lists).toHaveLength(2);
    expect(within(trends).getByRole('link', { name: /Open the reports/ })).toHaveAttribute(
      'href',
      '/reports',
    );
    await waitFor(() =>
      expect(urls.some((url) => url.includes('/dashboard/charts/revenue'))).toBe(true),
    );
  });

  it('gives the Receptionist attendance only: no revenue figure or chart', async () => {
    const urls = serveDashboard('RECEPTIONIST');
    renderWithProviders(<DashboardPage />, { me: fakeMe('RECEPTIONIST') });

    const trends = await screen.findByRole('region', { name: 'Trends' });
    expect(await within(trends).findByText('Denied entries')).toBeInTheDocument();
    expect(await within(trends).findByRole('heading', { name: 'Attendance' })).toBeInTheDocument();
    expect(within(trends).queryByText('Net revenue')).not.toBeInTheDocument();
    expect(within(trends).queryByRole('heading', { name: 'Revenue' })).not.toBeInTheDocument();
    expect(urls.some((url) => url.includes('/dashboard/charts/revenue'))).toBe(false);
  });

  it('shows the Trainer no trends section and asks for no charts', async () => {
    const urls = serveDashboard('TRAINER');
    renderWithProviders(<DashboardPage />, { me: fakeMe('TRAINER') });

    await screen.findByText('On your schedule today');
    expect(screen.queryByRole('region', { name: 'Trends' })).not.toBeInTheDocument();
    expect(urls.some((url) => url.includes('/dashboard/charts/'))).toBe(false);
  });

  it('keeps the chosen period in the link to the reports', async () => {
    serveDashboard('MANAGER');
    renderWithProviders(<DashboardPage />, { me: fakeMe('MANAGER'), path: `/${PERIOD}` });

    const trends = await screen.findByRole('region', { name: 'Trends' });
    expect(within(trends).getByRole('link', { name: /Open the reports/ })).toHaveAttribute(
      'href',
      '/reports?from=2026-10-01&to=2026-10-26',
    );
    expect(within(trends).getByText('1 Oct – 26 Oct 2026')).toBeInTheDocument();
  });
});
