import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/features/auth/login-page';
import { fakeMe, mockFetch, renderWithProviders } from './render';

describe('LoginPage', () => {
  it('validates the form before calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderWithProviders(<LoginPage />, { path: '/login' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Email is required')).toBeVisible();
    expect(screen.getByText('Password is required')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the generic error and clears the password after a failed sign-in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch((url) =>
        url.endsWith('/auth/login')
          ? {
              status: 401,
              body: {
                error: {
                  code: 'INVALID_CREDENTIALS',
                  message: 'Email or password is incorrect.',
                },
              },
            }
          : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } },
      ),
    );
    renderWithProviders(<LoginPage />, { path: '/login' });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'sana.iqbal@example.test');
    await user.type(screen.getByLabelText('Password'), 'Wrong-password-123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/auth/login');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'sana.iqbal@example.test',
      password: 'Wrong-password-123',
    });
  });

  it('loads the new session and leaves the login page after signing in', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        mockFetch((url) =>
          url.endsWith('/auth/login')
            ? { status: 204 }
            : url.endsWith('/auth/me')
              ? { status: 200, body: fakeMe('ADMIN') }
              : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } },
        ),
      );
    // The signed-out result from the page's first /auth/me check is still fresh in the cache.
    const { router } = renderWithProviders(<LoginPage />, {
      path: '/login?next=%2Fstaff',
      routes: [{ path: '/staff', element: <h1>Staff</h1> }],
    });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'ayesha.malik@example.test');
    await user.type(screen.getByLabelText('Password'), 'Correct-password-123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Staff' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/staff');
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/auth/login'),
      expect.stringContaining('/auth/me'),
    ]);
  });

  it('explains rate limiting separately', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch(() => ({
        status: 429,
        body: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      })),
    );
    renderWithProviders(<LoginPage />, { path: '/login' });
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'sana.iqbal@example.test');
    await user.type(screen.getByLabelText('Password'), 'Some-password-123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many sign-in attempts/i);
  });
});
