import type { Role } from '@gms/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SidebarContent } from '../src/components/layout/sidebar';
import { fakeMe, renderWithProviders } from './render';

const NAV: Record<Role, string[]> = {
  ADMIN: ['Dashboard', 'Staff', 'Audit log', 'Settings', 'My account'],
  MANAGER: ['Dashboard', 'Staff', 'Settings', 'My account'],
  RECEPTIONIST: ['Dashboard', 'My account'],
  TRAINER: ['Dashboard', 'My account'],
  MEMBER: ['My account'],
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
