import type { NotificationDto } from '@gms/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '../src/features/notifications/notification-bell';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const EQUIPMENT_ID = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

const NOTIFICATIONS: NotificationDto[] = [
  {
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    type: 'EQUIPMENT_MAINTENANCE_DUE',
    title: 'Treadmill 3 is due for maintenance',
    body: 'Next service was set for 22 Oct 2026.',
    entityType: 'EQUIPMENT',
    entityId: EQUIPMENT_ID,
    readAt: null,
    createdAt: '2026-10-23T04:15:00.000Z',
  },
  {
    id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
    type: 'CLASS_REMINDER',
    title: 'Spin Express starts tomorrow',
    body: 'Studio B at 07:00.',
    entityType: 'CLASS_SESSION',
    entityId: 'c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f',
    readAt: '2026-10-22T09:00:00.000Z',
    createdAt: '2026-10-22T04:15:00.000Z',
  },
];

function setup() {
  const posts: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url, init) => {
      if (init?.method === 'POST') {
        posts.push(url);
        return { status: 200, body: { ...NOTIFICATIONS[0], readAt: '2026-10-24T05:00:00.000Z' } };
      }
      if (url.includes('/notifications/unread-count')) return { status: 200, body: { count: 1 } };
      if (url.includes('/notifications'))
        return {
          status: 200,
          body: { data: NOTIFICATIONS, page: 1, pageSize: 6, total: 2, totalPages: 1 },
        };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  const view = renderWithProviders(<NotificationBell />, { me: fakeMe('MANAGER') });
  return { ...view, posts };
}

describe('NotificationBell', () => {
  it('shows the unread count and lists the latest notifications', async () => {
    setup();
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await userEvent.click(bell);
    // Radix names the menu after its trigger.
    const menu = await screen.findByRole('menu', { name: 'Notifications, 1 unread' });
    expect(menu).toHaveTextContent('1 unread');
    expect(
      await screen.findByRole('menuitem', { name: /Unread:\s*Treadmill 3 is due/ }),
    ).toBeInTheDocument();
    // Read items carry no "Unread" prefix.
    expect(
      screen.getByRole('menuitem', { name: /^Spin Express starts tomorrow/ }),
    ).toBeInTheDocument();
  });

  it('marks a notification read and opens what it is about', async () => {
    const { posts, router } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Treadmill 3/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/equipment/${EQUIPMENT_ID}`));
    await waitFor(() =>
      expect(posts).toEqual([
        expect.stringContaining(`/notifications/${NOTIFICATIONS[0]!.id}/read`),
      ]),
    );
  });

  it('does not mark an already-read notification again', async () => {
    const { posts, router } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /Spin Express/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/classes/sessions/${NOTIFICATIONS[1]!.entityId}`,
      ),
    );
    expect(posts).toEqual([]);
  });
});
