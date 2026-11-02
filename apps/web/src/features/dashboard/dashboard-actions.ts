import type { Permission, Role } from '@gms/shared';
import {
  BriefcaseBusiness,
  CalendarCheck,
  CalendarClock,
  ChartColumn,
  Contact,
  DoorOpen,
  Dumbbell,
  KeyRound,
  ReceiptText,
  ScanLine,
  ScrollText,
  Settings,
  ShieldAlert,
  Tags,
  Ticket,
  UserPlus,
  UserRoundCheck,
  UserRoundPlus,
  UserRoundSearch,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface QuickAction {
  /** A screen to open, or `onClick` for an action that opens a dialog in place. */
  to?: string;
  onClick?: () => void;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface QuickActionContext {
  role: Role;
  userId: string;
  can: (permission: Permission) => boolean;
  /** Whole-gym member access (not a trainer's own members). */
  seesMembers: boolean;
  seesBilling: boolean;
  seesAttendance: boolean;
  /** Set when the role may record a payment from the dashboard. */
  onRecordPayment: (() => void) | null;
}

/** The shortcuts a role can actually use, most frequent first. */
export function quickActionsFor({
  role,
  userId,
  can,
  seesMembers,
  seesBilling,
  seesAttendance,
  onRecordPayment,
}: QuickActionContext): QuickAction[] {
  const isTrainer = role === 'TRAINER';
  const actions: QuickAction[] = [];
  if (onRecordPayment) {
    actions.push({
      onClick: onRecordPayment,
      label: 'Record payment',
      description: 'Take a counter payment against a member’s open invoice',
      icon: ReceiptText,
    });
  }
  if (seesBilling) {
    actions.push({
      to: '/payments',
      label: 'Payments',
      description: 'Payment and refund history, receipts',
      icon: Wallet,
    });
  }
  if (can('access:monitor')) {
    actions.push({
      to: '/check-in',
      label: 'Check-in desk',
      description: 'Live entrance screen and manual check-in',
      icon: DoorOpen,
    });
  }
  if (seesAttendance) {
    actions.push({
      to: '/attendance',
      label: 'Attendance',
      description: 'Who checked in, by day; check-outs and corrections',
      icon: CalendarCheck,
    });
  }
  if (can('access:read-log')) {
    actions.push({
      to: '/access-log',
      label: 'Access log',
      description: 'Every entry attempt, granted or denied, with the reason',
      icon: ShieldAlert,
    });
  }
  if (seesMembers && can('members:create')) {
    actions.push({
      to: '/members?new=1',
      label: 'Register a member',
      description: 'Personal details, emergency contact and photo',
      icon: UserRoundPlus,
    });
  }
  if (seesMembers) {
    actions.push({
      to: '/members',
      label: 'Members',
      description: 'Search, filter and open member records',
      icon: Contact,
    });
  }
  if (seesMembers && can('memberships:read')) {
    actions.push({
      to: '/memberships',
      label: 'Memberships',
      description: can('memberships:assign')
        ? 'Expiring soon, status filters; assign from a member’s page'
        : 'Expiring soon and status filters',
      icon: Ticket,
    });
  }
  if (can('reports:operational')) {
    actions.push({
      to: '/reports',
      label: 'Reports',
      description: can('reports:financial')
        ? 'Members, attendance, classes and money, as CSV too'
        : 'Attendance and denied entries for any period, as CSV too',
      icon: ChartColumn,
    });
  }
  if (isTrainer) {
    actions.push({
      to: '/my-members',
      label: 'My members',
      description: 'Members assigned to you and their last visit',
      icon: UserRoundCheck,
    });
  }
  if (can('appointments:read')) {
    actions.push({
      to: '/appointments',
      label: isTrainer ? 'My appointments' : 'Appointments',
      description: can('appointments:manage')
        ? 'Book, move or cancel personal training'
        : 'Personal-training sessions',
      icon: CalendarClock,
    });
  }
  if (can('classes:read')) {
    actions.push({
      to: '/classes',
      label: 'Classes',
      description: can('classes:manage')
        ? 'Class types, the weekly timetable and bookings'
        : 'The weekly timetable, bookings and waitlists',
      icon: Dumbbell,
    });
  }
  if (can('trainers:read')) {
    actions.push({
      to: isTrainer ? `/trainers/${userId}` : '/trainers',
      label: isTrainer ? 'My profile and hours' : 'Trainers',
      description: isTrainer
        ? 'Your bio, weekly hours and time off'
        : 'Profiles, availability and assigned members',
      icon: UserRoundSearch,
    });
  }
  if (can('schedules:read')) {
    actions.push({
      to: '/shifts',
      label: can('schedules:manage') ? 'Staff shifts' : 'My shifts',
      description: can('schedules:manage')
        ? 'Plan the week’s front-desk and floor cover'
        : 'When you are on shift this week',
      icon: BriefcaseBusiness,
    });
  }
  if (can('plans:read')) {
    actions.push({
      to: '/plans',
      label: can('plans:manage') ? 'Membership plans' : 'View membership plans',
      description: 'Prices, durations, benefits and access hours',
      icon: Tags,
    });
  }
  if (can('staff:manage')) {
    actions.push({
      to: '/staff?new=1',
      label: 'Add a staff member',
      description: 'Create a login with a temporary password',
      icon: UserPlus,
    });
  }
  if (can('staff:read')) {
    actions.push({
      to: '/staff',
      label: 'Staff directory',
      description: 'Roles, status and last sign-in',
      icon: UsersRound,
    });
  }
  if (can('devices:manage')) {
    actions.push({
      to: '/devices',
      label: 'Scanners',
      description: 'Add scanners, rotate keys and check their health',
      icon: ScanLine,
    });
  }
  if (can('settings:read')) {
    actions.push({
      to: '/settings',
      label: can('settings:manage') ? 'Gym settings' : 'View gym settings',
      description: 'Reminders, invoices and retention rules',
      icon: Settings,
    });
  }
  if (can('audit:read')) {
    actions.push({
      to: '/audit-log',
      label: 'Audit log',
      description: 'Every sensitive change, who and when',
      icon: ScrollText,
    });
  }
  actions.push({
    to: '/account',
    label: 'My account',
    description: 'Your details and password',
    icon: KeyRound,
  });
  return actions;
}
