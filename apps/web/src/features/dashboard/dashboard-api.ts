import type { DashboardActivityItem, DashboardSummary } from '@gms/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary,
    queryFn: ({ signal }) => api.get<DashboardSummary>('/dashboard/summary', { signal }),
  });
}

export function useDashboardActivity(enabled = true) {
  return useQuery({
    queryKey: queryKeys.dashboard.activity,
    queryFn: ({ signal }) => api.get<DashboardActivityItem[]>('/dashboard/activity', { signal }),
    enabled,
  });
}
