import type {
  DashboardActivityItem,
  DashboardChartDto,
  DashboardRangeQuery,
  DashboardSummary,
} from '@gms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';
import { usePeriodParams } from '../reports/report-period';

/**
 * The period chosen on the dashboard (URL `?from=&to=`). Invalid dates fall back to the server
 * default so today's figures still load; the period section shows the date error instead.
 */
export function useDashboardQuery(): DashboardRangeQuery {
  const period = usePeriodParams();
  return period.range ? { from: period.query.from, to: period.query.to } : {};
}

export function useDashboardSummary() {
  const query = useDashboardQuery();
  return useQuery({
    queryKey: queryKeys.dashboard.summary(query),
    queryFn: ({ signal }) =>
      api.get<DashboardSummary>('/dashboard/summary', { query: { ...query }, signal }),
    // Today's figures stay on screen while another period loads.
    placeholderData: keepPreviousData,
  });
}

export function useDashboardChart(chart: 'revenue' | 'attendance', enabled: boolean) {
  const query = useDashboardQuery();
  return useQuery({
    queryKey: queryKeys.dashboard.chart(chart, query),
    queryFn: ({ signal }) =>
      api.get<DashboardChartDto>(`/dashboard/charts/${chart}`, { query: { ...query }, signal }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDashboardActivity(enabled = true) {
  return useQuery({
    queryKey: queryKeys.dashboard.activity,
    queryFn: ({ signal }) => api.get<DashboardActivityItem[]>('/dashboard/activity', { signal }),
    enabled,
  });
}
