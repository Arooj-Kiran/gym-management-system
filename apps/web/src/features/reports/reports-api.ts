import type { DashboardRangeQuery, ReportDto, ReportType } from '@gms/shared';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useReport(type: ReportType | null, query: DashboardRangeQuery, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.reports.report(type ?? 'attendance', query),
    queryFn: ({ signal }) =>
      api.get<ReportDto>(`/reports/${type}`, { query: { ...query, format: 'json' }, signal }),
    enabled: enabled && type !== null,
    // The previous report stays visible (dimmed) while a new period loads.
    placeholderData: keepPreviousData,
    // Reports are read-only views of live data: always fetch fresh when opened.
    staleTime: 0,
  });
}

/** Same period and rows as on screen, as a CSV file (opens in Excel; formulas neutralised). */
export function useDownloadReport() {
  return useMutation({
    mutationFn: ({ type, query }: { type: ReportType; query: DashboardRangeQuery }) =>
      api.download(`/reports/${type}`, { ...query, format: 'csv' }, `${type}.csv`),
  });
}
