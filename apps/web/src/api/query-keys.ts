import type { AuditListQuery, MemberListQuery, PlanListQuery, StaffListQuery } from '@gms/shared';

export const queryKeys = {
  me: ['auth', 'me'] as const,
  staff: {
    all: ['staff'] as const,
    list: (query: StaffListQuery) => ['staff', 'list', query] as const,
    detail: (id: string) => ['staff', 'detail', id] as const,
  },
  members: {
    all: ['members'] as const,
    list: (query: MemberListQuery) => ['members', 'list', query] as const,
    detail: (id: string) => ['members', 'detail', id] as const,
    duplicates: (query: Record<string, string | undefined>) =>
      ['members', 'duplicates', query] as const,
  },
  plans: {
    all: ['plans'] as const,
    list: (query: PlanListQuery) => ['plans', 'list', query] as const,
  },
  portal: {
    profile: ['portal', 'profile'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: ['dashboard', 'summary'] as const,
    activity: ['dashboard', 'activity'] as const,
  },
  settings: ['settings'] as const,
  auditLogs: (query: AuditListQuery) => ['audit-logs', query] as const,
};
