import type { Role } from '@gms/shared';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '../src/api/query-keys';
import { RequireMember, RequirePermission, RequireRole, RequireStaff } from '../src/routes/guards';
import { fakeMe } from './render';

/** The same guard nesting as the app router, with stand-in screens. */
function renderAt(role: Role, path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(queryKeys.me, fakeMe(role));
  const router = createMemoryRouter(
    [
      {
        element: <RequireMember />,
        children: [{ path: '/portal', element: <h1>Portal</h1> }],
      },
      {
        element: <RequireStaff />,
        children: [
          { index: true, element: <h1>Dashboard</h1> },
          {
            element: <RequirePermission permission="members:read" fullScope />,
            children: [{ path: '/members', element: <h1>Members</h1> }],
          },
          {
            element: <RequirePermission permission="plans:read" />,
            children: [{ path: '/plans', element: <h1>Plans</h1> }],
          },
          {
            element: <RequireRole roles={['TRAINER']} />,
            children: [{ path: '/my-members', element: <h1>My members</h1> }],
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('route guards', () => {
  it('sends members from staff screens to their portal', async () => {
    const router = renderAt('MEMBER', '/members');
    expect(await screen.findByRole('heading', { name: 'Portal' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/portal');
  });

  it('sends staff away from the member portal', async () => {
    const router = renderAt('RECEPTIONIST', '/portal');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/');
  });

  it('lets the front desk open the member list', async () => {
    renderAt('RECEPTIONIST', '/members');
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeVisible();
  });

  it('keeps trainers out of the whole-gym member list', async () => {
    renderAt('TRAINER', '/members');
    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeVisible();
  });

  it('opens a trainer’s own member list for trainers only', async () => {
    renderAt('TRAINER', '/my-members');
    expect(await screen.findByRole('heading', { name: 'My members' })).toBeVisible();
  });

  it.each(['ADMIN', 'RECEPTIONIST'] as const)(
    'keeps %s out of a trainer’s member list',
    async (role) => {
      renderAt(role, '/my-members');
      expect(
        await screen.findByRole('heading', { name: 'You do not have access to this page' }),
      ).toBeVisible();
    },
  );
});
