import type { Permission, Role } from '@gms/shared';
import {
  BellRing,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Contact,
  DoorOpen,
  Dumbbell,
  FileText,
  IdCard,
  LayoutDashboard,
  LibraryBig,
  LineChart,
  ListChecks,
  ScanLine,
  ScrollText,
  Settings,
  ShieldAlert,
  Tags,
  Ticket,
  UserRound,
  UserRoundCheck,
  UsersRound,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Shown only when the signed-in role holds this permission. */
  permission?: Permission;
  /** Require the unrestricted (ALL) scope, e.g. hide the member list from trainers. */
  fullScope?: boolean;
  /** Staff-only screens. */
  staffOnly?: boolean;
  /** Member portal screens. */
  memberOnly?: boolean;
  /** Only these roles, e.g. a trainer's own member list. */
  roles?: Role[];
  end?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Only screens that exist and work are listed (RULES §12: no placeholder UI). */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, staffOnly: true, end: true },
      // Receptionists see their two front-desk reports; financial ones need reports:financial.
      {
        to: '/reports',
        label: 'Reports',
        icon: ChartColumn,
        permission: 'reports:operational',
        staffOnly: true,
      },
    ],
  },
  {
    title: 'Front desk',
    items: [
      {
        to: '/members',
        label: 'Members',
        icon: Contact,
        permission: 'members:read',
        fullScope: true,
        staffOnly: true,
      },
      {
        to: '/memberships',
        label: 'Memberships',
        icon: Ticket,
        permission: 'memberships:read',
        fullScope: true,
        staffOnly: true,
      },
      { to: '/plans', label: 'Plans', icon: Tags, permission: 'plans:read', staffOnly: true },
    ],
  },
  {
    title: 'Billing',
    items: [
      {
        to: '/invoices',
        label: 'Invoices',
        icon: FileText,
        permission: 'payments:read',
        fullScope: true,
        staffOnly: true,
      },
      {
        to: '/payments',
        label: 'Payments',
        icon: Wallet,
        permission: 'payments:read',
        fullScope: true,
        staffOnly: true,
      },
    ],
  },
  {
    title: 'Entrance',
    items: [
      {
        to: '/check-in',
        label: 'Check-in desk',
        icon: DoorOpen,
        permission: 'access:monitor',
        staffOnly: true,
      },
      {
        to: '/attendance',
        label: 'Attendance',
        icon: CalendarCheck,
        permission: 'attendance:read',
        fullScope: true,
        staffOnly: true,
      },
      {
        to: '/access-log',
        label: 'Access log',
        icon: ShieldAlert,
        permission: 'access:read-log',
        staffOnly: true,
      },
    ],
  },
  {
    title: 'Training',
    items: [
      {
        to: '/classes',
        label: 'Classes',
        icon: Dumbbell,
        permission: 'classes:read',
        staffOnly: true,
      },
      {
        to: '/appointments',
        label: 'Appointments',
        icon: CalendarClock,
        permission: 'appointments:read',
        staffOnly: true,
      },
      {
        to: '/trainers',
        label: 'Trainers',
        icon: UserRoundCheck,
        permission: 'trainers:read',
        staffOnly: true,
      },
      { to: '/my-members', label: 'My members', icon: UsersRound, roles: ['TRAINER'] },
      {
        to: '/exercises',
        label: 'Exercises',
        icon: LibraryBig,
        permission: 'exercises:read',
        staffOnly: true,
      },
      {
        to: '/workout-plans',
        label: 'Workout plans',
        icon: ClipboardList,
        permission: 'workouts:read',
        staffOnly: true,
      },
      {
        to: '/workout-assignments',
        label: 'Assigned workouts',
        icon: ListChecks,
        permission: 'workouts:read',
        staffOnly: true,
      },
      {
        to: '/shifts',
        label: 'Shifts',
        icon: BriefcaseBusiness,
        permission: 'schedules:read',
        staffOnly: true,
      },
    ],
  },
  {
    title: 'Membership',
    items: [
      { to: '/portal', label: 'My profile', icon: IdCard, memberOnly: true, end: true },
      { to: '/portal/membership', label: 'My membership', icon: Ticket, memberOnly: true },
      { to: '/portal/attendance', label: 'My attendance', icon: CalendarCheck, memberOnly: true },
      { to: '/portal/payments', label: 'My payments', icon: Wallet, memberOnly: true },
      { to: '/portal/classes', label: 'Classes', icon: Dumbbell, memberOnly: true },
      { to: '/portal/schedule', label: 'My schedule', icon: CalendarDays, memberOnly: true },
      { to: '/portal/trainers', label: 'Trainers', icon: UserRoundCheck, memberOnly: true },
      { to: '/portal/workouts', label: 'My workouts', icon: ClipboardList, memberOnly: true },
      { to: '/portal/progress', label: 'My progress', icon: LineChart, memberOnly: true },
      { to: '/portal/plans', label: 'Plans', icon: Tags, memberOnly: true },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/staff', label: 'Staff', icon: UsersRound, permission: 'staff:read' },
      { to: '/devices', label: 'Scanners', icon: ScanLine, permission: 'devices:manage' },
      {
        to: '/equipment',
        label: 'Equipment',
        icon: Wrench,
        permission: 'equipment:read',
        staffOnly: true,
      },
      { to: '/audit-log', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
      {
        to: '/notification-channels',
        label: 'Notification channels',
        icon: BellRing,
        permission: 'settings:read',
      },
    ],
  },
  {
    title: 'You',
    items: [{ to: '/account', label: 'My account', icon: UserRound }],
  },
];
