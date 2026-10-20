import type { AccessSource, AuditAction, AuditEntityType } from '../enums';

/**
 * Members grouped by the effective status of their current membership (one count per member,
 * so a member with eleven expired renewals behind them still counts once).
 */
export interface DashboardMembershipCounts {
  active: number;
  pending: number;
  suspended: number;
  expired: number;
  cancelled: number;
  /** Active memberships ending within `expiringWithinDays` with no renewal lined up. */
  expiringSoon: number;
  /** The gym's reminder window (settings: expiry reminder days). */
  expiringWithinDays: number;
}

/** Each section is null when the caller's role may not see it. Later stages add sections. */
export interface DashboardSummary {
  /** Current (not archived) members, and those registered today in gym time. */
  members: { total: number; registeredToday: number } | null;
  memberships: DashboardMembershipCounts | null;
  attendance: DashboardAttendance | null;
}

/** Today in gym time. Denied attempts count every denial, including unrecognized fingerprints. */
export interface DashboardAttendance {
  checkInsToday: number;
  deniedToday: number;
  recentCheckIns: DashboardCheckIn[];
}

export interface DashboardCheckIn {
  id: string;
  checkInAt: string;
  source: AccessSource;
  member: { id: string; memberCode: string; firstName: string; lastName: string };
}

export interface DashboardActivityItem {
  id: string;
  action: AuditAction;
  entityType: AuditEntityType;
  createdAt: string;
  actorName: string | null;
  member: { id: string; memberCode: string; firstName: string; lastName: string } | null;
}
