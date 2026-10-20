import type { AccessDeviceDto, MyAttendanceDto } from '@gms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DevicesPage } from '../src/features/devices/devices-page';
import { PortalAttendancePage } from '../src/features/portal/portal-attendance-page';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const NOW = '2026-10-20T05:00:00.000Z';

function device(overrides: Partial<AccessDeviceDto> = {}): AccessDeviceDto {
  return {
    id: '0b6f5f0e-3c41-4d8e-9a7b-6f1d2c3e4a5b',
    name: 'Main entrance',
    location: 'Ground floor',
    deviceType: 'SIMULATED',
    status: 'ACTIVE',
    vendor: null,
    model: null,
    serialNumber: null,
    lastSeenAt: null,
    lastHealth: null,
    lastErrorCode: null,
    keyRotatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// A made-up value for the test only; the server issues real keys.
const ISSUED_KEY = 'test-device-key-not-a-secret-000000000000';

function setupDevices(initial: AccessDeviceDto[]) {
  let rows = initial;
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, string>;
        posts.push({ url, body });
        if (url.endsWith('/devices')) {
          const created = device({
            id: '9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f',
            name: body.name,
            location: body.location,
            deviceType: body.deviceType as AccessDeviceDto['deviceType'],
            vendor: body.vendor ?? null,
          });
          rows = [...rows, created];
          return { status: 201, body: { device: created, deviceKey: ISSUED_KEY } };
        }
        if (url.endsWith('/rotate-key'))
          return { status: 200, body: { device: rows[0], deviceKey: ISSUED_KEY } };
        if (url.endsWith('/disable')) {
          rows = rows.map((row) => ({ ...row, status: 'DISABLED' as const }));
          return { status: 200, body: rows[0] };
        }
      }
      if (url.endsWith('/devices')) return { status: 200, body: { data: rows } };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  renderWithProviders(<DevicesPage />, { me: fakeMe('ADMIN'), path: '/devices' });
  return { posts };
}

describe('scanners page', () => {
  it('shows an empty state with a way to add the first scanner', async () => {
    setupDevices([]);
    expect(await screen.findByText('No scanners yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add scanner' })).toHaveLength(2);
  });

  it('adds a real scanner and shows its key once', async () => {
    const { posts } = setupDevices([device()]);
    await screen.findByRole('list', { name: 'Scanners' });

    await userEvent.click(screen.getByRole('button', { name: 'Add scanner' }));
    const form = await screen.findByRole('dialog', { name: 'Add a scanner' });
    await userEvent.click(within(form).getByRole('button', { name: 'Add scanner' }));
    expect(within(form).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toEqual([]);

    await userEvent.type(within(form).getByLabelText('Name'), 'Side door');
    await userEvent.type(within(form).getByLabelText('Location'), 'Car park');
    await userEvent.selectOptions(within(form).getByLabelText('Type'), 'REAL');
    await userEvent.type(within(form).getByLabelText(/Vendor/), 'ZKTeco');
    await userEvent.click(within(form).getByRole('button', { name: 'Add scanner' }));

    const keyDialog = await screen.findByRole('dialog', { name: 'Side door added' });
    expect(within(keyDialog).getByLabelText('Device key')).toHaveValue(ISSUED_KEY);
    // The setup hint names the variable but never repeats the key.
    expect(within(keyDialog).getByText(/AGENT_DEVICE_KEY=<the key above>/)).toBeInTheDocument();
    expect(posts[0]?.body).toEqual({
      name: 'Side door',
      location: 'Car park',
      deviceType: 'REAL',
      vendor: 'ZKTeco',
      model: null,
      serialNumber: null,
    });

    await userEvent.click(within(keyDialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue(ISSUED_KEY)).not.toBeInTheDocument();
    expect(await screen.findByText('Side door')).toBeInTheDocument();
  });

  it('rotates a key only after confirmation and warns the old one stopped working', async () => {
    const { posts } = setupDevices([device()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Rotate key' }));

    const confirm = await screen.findByRole('dialog', {
      name: 'Rotate the key for Main entrance?',
    });
    expect(posts).toEqual([]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Rotate key' }));

    const keyDialog = await screen.findByRole('dialog', { name: 'New key for Main entrance' });
    expect(within(keyDialog).getByText(/old key stopped working/)).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toMatch(/\/devices\/.+\/rotate-key$/);
  });

  it('disables a scanner after confirmation', async () => {
    const { posts } = setupDevices([device()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Disable' }));
    const confirm = await screen.findByRole('dialog', { name: 'Disable Main entrance?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Disable scanner' }));

    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(posts[0]?.url).toMatch(/\/disable$/);
  });
});

describe('portal: my attendance', () => {
  const visit = (overrides: Partial<MyAttendanceDto>): MyAttendanceDto => ({
    id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    checkInAt: '2026-10-19T13:05:00.000Z',
    checkOutAt: '2026-10-19T14:35:00.000Z',
    source: 'SIMULATED',
    ...overrides,
  });

  function setupPortal(rows: MyAttendanceDto[]) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      mockFetch((url) =>
        url.includes('/me/attendance')
          ? { status: 200, body: { data: rows, page: 1, pageSize: 20, total: rows.length } }
          : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } },
      ),
    );
    renderWithProviders(<PortalAttendancePage />, {
      me: fakeMe('MEMBER'),
      path: '/portal/attendance',
    });
  }

  it('lists visits in plain words', async () => {
    setupPortal([
      visit({}),
      visit({ id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e', source: 'MANUAL', checkOutAt: null }),
    ]);
    const list = await screen.findByRole('list', { name: 'My check-ins' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Test scanner');
    expect(first).toHaveTextContent('1 h 30 min');
    expect(second).toHaveTextContent('At the front desk');
    expect(second).toHaveTextContent('→ —');
  });

  it('shows an empty state before the first visit', async () => {
    setupPortal([]);
    expect(await screen.findByText('No visits yet')).toBeInTheDocument();
  });
});
