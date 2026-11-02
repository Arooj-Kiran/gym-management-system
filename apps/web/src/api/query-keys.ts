import type {
  AccessAttemptListQuery,
  AppointmentListQuery,
  AssignmentListQuery,
  AttendanceListQuery,
  AvailableSlotsQuery,
  ClassSessionListQuery,
  DashboardRangeQuery,
  ReportType,
  ScheduleQuery,
  ShiftListQuery,
  AuditListQuery,
  EquipmentListQuery,
  ExerciseListQuery,
  NotificationListQuery,
  WorkoutAssignmentListQuery,
  WorkoutLogListQuery,
  WorkoutPlanListQuery,
  InvoiceListQuery,
  MemberListQuery,
  MembershipListQuery,
  PaymentListQuery,
  PlanListQuery,
  RefundListQuery,
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
  billing: {
    all: ['billing'] as const,
    invoices: (query: InvoiceListQuery) => ['billing', 'invoices', query] as const,
    invoice: (id: string) => ['billing', 'invoice', id] as const,
    payments: (query: PaymentListQuery) => ['billing', 'payments', query] as const,
    refunds: (query: RefundListQuery) => ['billing', 'refunds', query] as const,
    memberInvoices: (id: string, query: InvoiceListQuery) =>
      ['billing', 'member-invoices', id, query] as const,
    memberPayments: (id: string, query: PaymentListQuery) =>
      ['billing', 'member-payments', id, query] as const,
    receipt: (id: string) => ['billing', 'receipt', id] as const,
    myInvoices: (page: number) => ['billing', 'my-invoices', page] as const,
    myPayments: (page: number) => ['billing', 'my-payments', page] as const,
    myReceipt: (id: string) => ['billing', 'my-receipt', id] as const,
  },
  portal: {
    profile: ['portal', 'profile'] as const,
    membership: ['portal', 'membership'] as const,
    memberships: ['portal', 'memberships'] as const,
    attendance: (page: number) => ['portal', 'attendance', page] as const,
  },
  /** Trainers, classes, appointments and shifts share one root: a booking moves all of them. */
  scheduling: {
    all: ['scheduling'] as const,
    trainers: ['scheduling', 'trainers'] as const,
    trainer: (id: string) => ['scheduling', 'trainer', id] as const,
    availability: (id: string) => ['scheduling', 'availability', id] as const,
    trainerSchedule: (id: string, query: ScheduleQuery) =>
      ['scheduling', 'trainer-schedule', id, query] as const,
    availableSlots: (id: string, query: AvailableSlotsQuery) =>
      ['scheduling', 'available-slots', id, query] as const,
    trainerMembers: (id: string) => ['scheduling', 'trainer-members', id] as const,
    assignments: (query: AssignmentListQuery) => ['scheduling', 'assignments', query] as const,
    classes: (includeArchived: boolean) => ['scheduling', 'classes', includeArchived] as const,
    sessions: (query: ClassSessionListQuery) => ['scheduling', 'sessions', query] as const,
    session: (id: string) => ['scheduling', 'session', id] as const,
    roster: (id: string) => ['scheduling', 'roster', id] as const,
    appointments: (query: AppointmentListQuery) => ['scheduling', 'appointments', query] as const,
    shifts: (query: ShiftListQuery) => ['scheduling', 'shifts', query] as const,
    myClassSessions: (query: ScheduleQuery) => ['scheduling', 'my-sessions', query] as const,
    mySchedule: ['scheduling', 'my-schedule'] as const,
    myAppointments: ['scheduling', 'my-appointments'] as const,
    myTrainers: ['scheduling', 'my-trainers'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: (query: DashboardRangeQuery) => ['dashboard', 'summary', query] as const,
    activity: ['dashboard', 'activity'] as const,
    chart: (chart: 'revenue' | 'attendance', query: DashboardRangeQuery) =>
      ['dashboard', 'chart', chart, query] as const,
  },
  /** Reports read everything else, so any change may move them; they are refetched on view. */
  reports: {
    all: ['reports'] as const,
    report: (type: ReportType, query: DashboardRangeQuery) => ['reports', type, query] as const,
  },
  exercises: {
    all: ['exercises'] as const,
    list: (query: ExerciseListQuery) => ['exercises', 'list', query] as const,
  },
  /** Plans, assignments, logs and progress share one root: a log or plan edit moves all of them. */
  workouts: {
    all: ['workouts'] as const,
    plans: (query: WorkoutPlanListQuery) => ['workouts', 'plans', query] as const,
    plan: (id: string) => ['workouts', 'plan', id] as const,
    assignments: (query: WorkoutAssignmentListQuery) => ['workouts', 'assignments', query] as const,
    assignment: (id: string) => ['workouts', 'assignment', id] as const,
    logs: (query: WorkoutLogListQuery) => ['workouts', 'logs', query] as const,
    progress: (memberId: string) => ['workouts', 'progress', memberId] as const,
    myWorkouts: ['workouts', 'my-workouts'] as const,
    myLogs: (query: WorkoutLogListQuery) => ['workouts', 'my-logs', query] as const,
    myProgress: ['workouts', 'my-progress'] as const,
  },
  equipment: {
    all: ['equipment'] as const,
    list: (query: EquipmentListQuery) => ['equipment', 'list', query] as const,
    detail: (id: string) => ['equipment', 'detail', id] as const,
    maintenance: (id: string) => ['equipment', 'maintenance', id] as const,
    due: (days: number) => ['equipment', 'due', days] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (query: NotificationListQuery) => ['notifications', 'list', query] as const,
    unreadCount: ['notifications', 'unread-count'] as const,
    channels: ['notifications', 'channels'] as const,
  },
  settings: ['settings'] as const,
  auditLogs: (query: AuditListQuery) => ['audit-logs', query] as const,
};
