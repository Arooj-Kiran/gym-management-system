import type { Role } from '@gms/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarContent } from '../src/components/layout/sidebar';
import { fakeMe, renderWithProviders } from './render';

const ENTRANCE = ['Check-in desk', 'Attendance', 'Access log'];
const BILLING = ['Invoices', 'Payments'];
const TRAINING = ['Classes', 'Appointments', 'Trainers', 'Shifts'];
// Exercise library and workout plans sit between Trainers and Shifts for roles that may read them.
const TRAINING_WITH_WORKOUTS = [
  'Classes',
  'Appointments',
  'Trainers',
  'Exercises',
  'Workout plans',
  'Assigned workouts',
  'Shifts',
];

const NAV: Record<Role, string[]> = {
  ADMIN: [
    'Dashboard',
    'Reports',
    'Members',
    'Memberships',
    'Plans',
    ...BILLING,
    ...ENTRANCE,
    ...TRAINING_WITH_WORKOUTS,
    'Staff',
    'Scanners',
    'Equipment',
    'Audit log',
    'Settings',
    'Notification channels',
    'My account',
  ],
  MANAGER: [
    'Dashboard',
    'Reports',
    'Members',
    'Memberships',
    'Plans',
    ...BILLING,
    ...ENTRANCE,
    ...TRAINING_WITH_WORKOUTS,
    'Staff',
    'Equipment',
    'Settings',
    'Notification channels',
    'My account',
  ],
  // Front desk can look up equipment and run its two reports; no workout or settings access.
  RECEPTIONIST: [
    'Dashboard',
    'Reports',
    'Members',
    'Memberships',
    'Plans',
    ...BILLING,
    ...ENTRANCE,
    ...TRAINING,
    'Equipment',
    'My account',
  ],
  // Trainers see their own training screens and assigned members only; no payment access at all.
  TRAINER: [
    'Dashboard',
    'Classes',
    'Appointments',
    'Trainers',
    'My members',
    'Exercises',
    'Workout plans',
    'Assigned workouts',
    'Shifts',
    'Equipment',
    'My account',
  ],
  MEMBER: [
    'My profile',
    'My membership',
    'My attendance',
    'My payments',
    'Classes',
    'My schedule',
    'Trainers',
    'My workouts',
    'My progress',
    'Plans',
    'My account',
  ],
};

describe('role-aware navigation', () => {
  it.each(Object.entries(NAV) as [Role, string[]][])(
    '%s sees only the screens it can use',
    (role, expected) => {
      renderWithProviders(<SidebarContent />, { me: fakeMe(role) });
      const nav = screen.getByRole('navigation', { name: /main/i });
      const labels = Array.from(nav.querySelectorAll('a')).map((link) => link.textContent?.trim());
      expect(labels).toEqual(expected);
    },
  );

  it('marks the current page', () => {
    renderWithProviders(<SidebarContent />, { me: fakeMe('ADMIN'), path: '/staff' });
    expect(screen.getByRole('link', { name: 'Staff' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });
});
