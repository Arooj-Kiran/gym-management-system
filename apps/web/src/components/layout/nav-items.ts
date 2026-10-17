import type { Permission } from '@gms/shared';
import {
  Contact,
  IdCard,
  LayoutDashboard,
  ScrollText,
  Settings,
  Tags,
  Ticket,
  UserRound,
  UsersRound,
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
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, staffOnly: true, end: true }],
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
    title: 'Membership',
    items: [
      { to: '/portal', label: 'My profile', icon: IdCard, memberOnly: true, end: true },
      { to: '/portal/membership', label: 'My membership', icon: Ticket, memberOnly: true },
      { to: '/portal/plans', label: 'Plans', icon: Tags, memberOnly: true },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/staff', label: 'Staff', icon: UsersRound, permission: 'staff:read' },
      { to: '/audit-log', label: 'Audit log', icon: ScrollText, permission: 'audit:read' },
      { to: '/settings', label: 'Settings', icon: Settings, permission: 'settings:read' },
    ],
  },
  {
    title: 'You',
    items: [{ to: '/account', label: 'My account', icon: UserRound }],
  },
];
