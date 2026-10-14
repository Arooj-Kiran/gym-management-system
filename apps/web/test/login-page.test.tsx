import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/features/auth/login-page';
import { mockFetch, renderWithProviders } from './render';

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
