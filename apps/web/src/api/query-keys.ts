import type {
  AccessAttemptListQuery,
  AttendanceListQuery,
  AuditListQuery,
  MemberListQuery,
  MembershipListQuery,
  PlanListQuery,
  StaffListQuery,
} from '@gms/shared';

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
    memberships: (id: string) => ['members', 'memberships', id] as const,
    membershipEvents: (id: string) => ['members', 'membership-events', id] as const,
    duplicates: (query: Record<string, string | undefined>) =>
      ['members', 'duplicates', query] as const,
    biometric: (id: string) => ['members', 'biometric', id] as const,
  },
  access: {
    all: ['access'] as const,
    devices: ['access', 'devices'] as const,
    fixtures: ['access', 'simulator-fixtures'] as const,
    attempts: (query: AccessAttemptListQuery) => ['access', 'attempts', query] as const,
    memberAttempts: (id: string, query: AccessAttemptListQuery) =>
      ['access', 'member-attempts', id, query] as const,
  },
  attendance: {
    all: ['attendance'] as const,
    list: (query: AttendanceListQuery) => ['attendance', 'list', query] as const,
    member: (id: string, query: AttendanceListQuery) =>
      ['attendance', 'member', id, query] as const,
    corrections: (id: string) => ['attendance', 'corrections', id] as const,
  },
  devices: {
    all: ['devices'] as const,
  },
  plans: {
    all: ['plans'] as const,
    list: (query: PlanListQuery) => ['plans', 'list', query] as const,
  },
  memberships: {
    all: ['memberships'] as const,
    list: (query: MembershipListQuery) => ['memberships', 'list', query] as const,
  },
  portal: {
    profile: ['portal', 'profile'] as const,
    membership: ['portal', 'membership'] as const,
    memberships: ['portal', 'memberships'] as const,
    attendance: (page: number) => ['portal', 'attendance', page] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: ['dashboard', 'summary'] as const,
    activity: ['dashboard', 'activity'] as const,
  },
  settings: ['settings'] as const,
  auditLogs: (query: AuditListQuery) => ['audit-logs', query] as const,
};
