import type { Permission } from '@gms/shared';
import {
  LayoutDashboard,
  ScrollText,
  Settings,
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
  /** Staff-only screens (members get the portal in later stages). */
  staffOnly?: boolean;
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
