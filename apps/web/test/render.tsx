import { permissionsForRole, type MeResponse, type Role } from '@gms/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { queryKeys } from '../src/api/query-keys';

/** A fictional signed-in session for the given role. */
export function fakeMe(role: Role, overrides: Partial<MeResponse['user']> = {}): MeResponse {
  return {
    user: {
      id: '7f8e2a50-0c5d-4c1e-9a43-2b1f6d0e9a11',
      email: 'ayesha.malik@example.test',
      firstName: 'Ayesha',
      lastName: 'Malik',
      role,
      mustChangePassword: false,
      lastLoginAt: null,
      ...overrides,
    },
    permissions: permissionsForRole(role),
    csrfToken: 'test-csrf',
    gym: { name: 'Iron Valley Fitness' },
  };
}

/**
 * Renders `ui` at `path` with a fresh query cache, optionally pre-seeded with a session.
 * `routes` adds other screens (e.g. a redirect target); `ui` matches every other path.
 */
export function renderWithProviders(
  ui: ReactNode,
  {
    me = null,
    path = '/',
    routes = [],
  }: { me?: MeResponse | null; path?: string; routes?: RouteObject[] } = {},
) {
  const queryClient = new QueryClient({
    // Same staleTime as the app, so cached data behaves as it does in the browser.
    defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.me, me);
  const router = createMemoryRouter([...routes, { path: '*', element: ui }], {
    initialEntries: [path],
  });
  return {
    queryClient,
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

/** Replace fetch with a handler; returns the mock so tests can inspect calls. */
export function mockFetch(
  handler: (url: string, init: RequestInit | undefined) => { status: number; body?: unknown },
) {
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status, body } = handler(String(input), init);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return fetchMock;
}
