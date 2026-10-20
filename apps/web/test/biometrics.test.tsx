import {
  BIOMETRIC_CONSENT,
  type AccessDeviceBrief,
  type BiometricEnrollmentDto,
  type MemberBiometricStatus,
  type MemberDto,
  type Role,
} from '@gms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FingerprintCard } from '../src/features/biometrics/fingerprint-card';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const MEMBER = {
  id: '5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
  memberCode: 'M-00021',
  firstName: 'Sana',
  lastName: 'Qureshi',
  archivedAt: null,
} as MemberDto;

const REAL_DEVICE: AccessDeviceBrief = {
  id: '9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f',
  name: 'Side door',
  location: 'Car park',
  deviceType: 'REAL',
  status: 'ACTIVE',
};

const CONSENT = {
  id: '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b',
  consentVersion: BIOMETRIC_CONSENT.version,
  givenAt: '2026-10-12T06:30:00.000Z',
  recordedByName: 'Hira Malik',
  withdrawnAt: null,
  withdrawnByName: null,
};

const ENROLLMENT: BiometricEnrollmentDto = {
  id: '3f4a5b6c-7d8e-4f9a-8b0c-1d2e3f4a5b6c',
  device: { id: REAL_DEVICE.id, name: REAL_DEVICE.name, deviceType: 'REAL' },
  provider: 'zkteco',
  templateRefMasked: '••42',
  status: 'ACTIVE',
  enrolledAt: '2026-10-12T06:35:00.000Z',
  enrolledByName: 'Hira Malik',
  revokedAt: null,
  revokedByName: null,
  revokeReason: null,
  deletedAt: null,
};

const status = (overrides: Partial<MemberBiometricStatus> = {}): MemberBiometricStatus => ({
  consent: null,
  consentHistory: [],
  enrollments: [],
  currentConsentVersion: BIOMETRIC_CONSENT.version,
  ...overrides,
});

function setup(role: Role, initial: MemberBiometricStatus, member: MemberDto = MEMBER) {
  let current = initial;
  const posts: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url, init) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        if (url.endsWith('/biometric/consent')) {
          current = { ...current, consent: CONSENT };
          return { status: 200, body: current };
        }
        if (url.endsWith('/biometric/enrollments')) {
          current = { ...current, enrollments: [ENROLLMENT] };
          return { status: 201, body: ENROLLMENT };
        }
        if (url.endsWith('/revoke')) {
          const revoked = {
            ...ENROLLMENT,
            status: 'REVOKED' as const,
            revokedAt: '2026-10-20T08:00:00.000Z',
          };
          current = { ...current, enrollments: [revoked] };
          return { status: 200, body: revoked };
        }
      }
      if (url.endsWith(`/members/${MEMBER.id}/biometric`)) return { status: 200, body: current };
      if (url.includes('/access/devices')) return { status: 200, body: { data: [REAL_DEVICE] } };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  renderWithProviders(
    <FingerprintCard member={member} canManage={role === 'ADMIN' || role === 'MANAGER'} />,
    { me: fakeMe(role) },
  );
  return { posts };
}

describe('fingerprint card', () => {
  it('requires consent before a fingerprint can be enrolled', async () => {
    const { posts } = setup('MANAGER', status());

    expect(await screen.findByText('Not given')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enroll fingerprint' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Record consent' }));
    const dialog = await screen.findByRole('dialog', { name: 'Record fingerprint consent' });
    expect(within(dialog).getByText(new RegExp(BIOMETRIC_CONSENT.version))).toBeInTheDocument();

    // Not ticked yet: nothing is sent.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record consent' }));
    expect(
      within(dialog).getByText('Confirm that the member agrees before recording consent.'),
    ).toBeInTheDocument();
    expect(posts).toEqual([]);

    await userEvent.click(within(dialog).getByRole('checkbox'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record consent' }));

    expect(await screen.findByText('Given')).toBeInTheDocument();
    expect(posts).toEqual([
      {
        url: expect.stringContaining(`/members/${MEMBER.id}/biometric/consent`),
        body: { consentVersion: BIOMETRIC_CONSENT.version },
      },
    ]);
    expect(screen.getByRole('button', { name: 'Enroll fingerprint' })).toBeInTheDocument();
  });

  it('asks for the device user ID when enrolling on a real scanner', async () => {
    const { posts } = setup('MANAGER', status({ consent: CONSENT }));

    await userEvent.click(await screen.findByRole('button', { name: 'Enroll fingerprint' }));
    const dialog = await screen.findByRole('dialog', { name: 'Enroll a fingerprint for Sana' });
    const input = await within(dialog).findByLabelText('Device user ID');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Enroll fingerprint' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(posts).toEqual([]);

    await userEvent.type(input, '42');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enroll fingerprint' }));

    const list = await screen.findByRole('list', { name: 'Fingerprint enrollments' });
    expect(within(list).getByText('••42')).toBeInTheDocument();
    expect(posts).toEqual([
      {
        url: expect.stringContaining(`/members/${MEMBER.id}/biometric/enrollments`),
        body: { deviceId: REAL_DEVICE.id, templateRef: '42' },
      },
    ]);
  });

  it('needs a reason to revoke a fingerprint', async () => {
    const { posts } = setup('ADMIN', status({ consent: CONSENT, enrollments: [ENROLLMENT] }));

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke this fingerprint?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke fingerprint' }));
    expect(posts).toEqual([]);

    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Member asked for it');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke fingerprint' }));

    expect(await screen.findByText('Deletion pending')).toBeInTheDocument();
    expect(posts).toEqual([
      {
        url: expect.stringContaining(`/biometric/enrollments/${ENROLLMENT.id}/revoke`),
        body: { reason: 'Member asked for it' },
      },
    ]);
  });

  it('is read-only for reception and shows only the masked device user ID', async () => {
    setup('RECEPTIONIST', status({ consent: CONSENT, enrollments: [ENROLLMENT] }));

    expect(await screen.findByText('Given')).toBeInTheDocument();
    expect(screen.getByText('••42')).toBeInTheDocument();
    for (const name of ['Record consent', 'Enroll fingerprint', 'Withdraw consent', 'Revoke']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('offers no changes for an archived member', async () => {
    setup('ADMIN', status(), { ...MEMBER, archivedAt: '2026-10-01T00:00:00.000Z' });

    expect(await screen.findByText('Not given')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record consent' })).not.toBeInTheDocument();
  });
});
