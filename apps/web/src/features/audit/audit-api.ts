import type { AuditListQuery, AuditLogDto, Paginated } from '@gms/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { queryKeys } from '../../api/query-keys';

export function useAuditLogs(query: AuditListQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.auditLogs(query),
    queryFn: ({ signal }) =>
      api.get<Paginated<AuditLogDto>>('/audit-logs', { query: { ...query }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}
