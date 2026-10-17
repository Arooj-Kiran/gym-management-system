import type { AuditAction } from '../enums';

/** Each section is null when the caller's role may not see it. Later stages add sections. */
export interface DashboardSummary {
  /** Current (not archived) members, and those registered today in gym time. */
  members: { total: number; registeredToday: number } | null;
}

export interface DashboardActivityItem {
  id: string;
  action: AuditAction;
  createdAt: string;
  actorName: string | null;
  member: { id: string; memberCode: string; firstName: string; lastName: string } | null;
}
