import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateMemberDialog } from '../src/features/members/create-member-dialog';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const EXISTING = {
  id: '3b0c9a8e-5d4f-4e21-8a7b-6c1d2e3f4a5b',
  memberCode: 'M-00012',
  firstName: 'Bilal',
  lastName: 'Ahmed',
};
const CREATED = {
  id: '9d2e4f60-1a3b-4c5d-8e7f-0a1b2c3d4e5f',
  memberCode: 'M-00013',
  firstName: 'Hira',
  lastName: 'Ahmed',
};

const NO_DUPLICATES = { status: 200, body: { emailConflict: null, phoneMatches: [] } };

async function fillForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('First name'), 'Hira');
  await user.type(screen.getByLabelText('Last name'), 'Ahmed');
  await user.type(screen.getByLabelText(/^Phone/), '0300 1234567');
  await user.type(screen.getByLabelText(/^Email/), 'hira.ahmed@example.test');
  return user;
}

function renderDialog() {
  return renderWithProviders(<CreateMemberDialog open onOpenChange={() => {}} />, {
    me: fakeMe('RECEPTIONIST'),
    path: '/members',
    routes: [{ path: '/members/:id', element: <h1>Member profile</h1> }],
  });
}

describe('CreateMemberDialog', () => {
  it('asks for a reason when the phone is shared, then saves with the confirmation', async () => {
    const posts: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch((url, init) => {
        if (url.includes('/members/check-duplicate')) return NO_DUPLICATES;
        if (url.endsWith('/members') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body)) as Record<string, unknown>;
          posts.push(body);
          return body.confirmDuplicatePhone
            ? { status: 201, body: CREATED }
            : {
                status: 409,
                body: {
                  error: {
                    code: 'DUPLICATE_PHONE_WARNING',
                    message: 'Another member already uses this phone number.',
                    matches: [{ ...EXISTING, sameName: false }],
                  },
                },
              };
        }
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
      }),
    );
    const { router } = renderDialog();
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Register member' }));

    const confirm = await screen.findByRole('dialog', { name: 'Phone number already in use' });
    expect(within(confirm).getByText(/Bilal Ahmed/)).toBeVisible();
    expect(posts).toHaveLength(1);

    // The reason is required: nothing is sent until one is given.
    await user.click(within(confirm).getByRole('button', { name: 'Save anyway' }));
    expect(posts).toHaveLength(1);

    await user.type(within(confirm).getByLabelText(/Why is this number shared/), 'Sisters');
    await user.click(within(confirm).getByRole('button', { name: 'Save anyway' }));

    expect(await screen.findByRole('heading', { name: 'Member profile' })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/members/${CREATED.id}`);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({
      firstName: 'Hira',
      phone: '+923001234567',
      confirmDuplicatePhone: true,
      duplicatePhoneReason: 'Sisters',
    });
    expect(posts[0]).not.toHaveProperty('confirmDuplicatePhone');
  });

  it('blocks a taken email on the field without offering an override', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch((url, init) => {
        if (url.includes('/members/check-duplicate')) return NO_DUPLICATES;
        if (url.endsWith('/members') && init?.method === 'POST')
          return {
            status: 409,
            body: {
              error: {
                code: 'DUPLICATE_EMAIL',
                message: 'This email already belongs to member M-00012.',
                existing: EXISTING,
              },
            },
          };
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
      }),
    );
    renderDialog();
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Register member' }));

    expect(await screen.findByText('This email already belongs to member M-00012.')).toBeVisible();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('dialog', { name: /phone/i })).not.toBeInTheDocument();
  });
});
