import type { AccessSource, AuditAction, AuditEntityType } from '../enums';
import type { ScheduleItemDto } from './trainers';

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

/** Each section is null when the caller's role may not see it. */
export interface DashboardSummary {
  /** Totals for the chosen period (default: the last 30 days); null for Trainers. */
  period: DashboardPeriod | null;
  /** Current (not archived) members, and those registered today in gym time. */
  members: { total: number; registeredToday: number } | null;
  memberships: DashboardMembershipCounts | null;
  attendance: DashboardAttendance | null;
  billing: DashboardBilling | null;
  /** The signed-in trainer's own schedule and members; null for every other role. */
  trainer: DashboardTrainer | null;
}

/** Inclusive gym-time dates. A figure is null when the role may not see it. */
export interface DashboardPeriod {
  from: string;
  to: string;
  registrations: number | null;
  checkIns: number | null;
  denied: number | null;
  /** Only with reports:financial. */
  revenue: Omit<DashboardRevenue, 'month'> | null;
}

/** Gym-time today, and the next 7 days after it. Cancelled items are left out. */
export interface DashboardTrainer {
  today: ScheduleItemDto[];
  upcoming: ScheduleItemDto[];
  assignedMembers: number;
}

/** Open invoices (balance > 0); overdue ones are those past their due date. */
export interface DashboardBilling {
  outstanding: { count: number; amountMinor: number };
  overdue: { count: number; amountMinor: number };
  /** Only for roles with reports:financial (Admin, Manager); null for the Receptionist. */
  revenue: DashboardRevenue | null;
}

/** This calendar month in gym time. Net = completed payments received − refunds issued. */
export interface DashboardRevenue {
  month: string;
  collectedMinor: number;
  refundedMinor: number;
  netMinor: number;
  paymentCount: number;
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
