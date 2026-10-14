import type { AuditListQuery, StaffListQuery } from '@gms/shared';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  staff: {
    all: ['staff'] as const,
    list: (query: StaffListQuery) => ['staff', 'list', query] as const,
    detail: (id: string) => ['staff', 'detail', id] as const,
  },
  settings: ['settings'] as const,
  auditLogs: (query: AuditListQuery) => ['audit-logs', query] as const,
};
