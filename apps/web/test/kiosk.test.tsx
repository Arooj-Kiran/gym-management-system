import {
  KIOSK_IDLE_PROMPT,
  KIOSK_RESET_MS,
  SIM_UNENROLLED_REF,
  SIMULATED_BANNER,
  type AccessDecision,
  type AccessDeviceBrief,
  type SimulatorFixturesDto,
} from '@gms/shared';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckInPage } from '../src/features/access/check-in-page';
import { KioskPage } from '../src/features/access/kiosk-page';
import { fakeMe, mockFetch, renderWithProviders } from './render';

const SIM_DEVICE: AccessDeviceBrief = {
  id: '0b6f5f0e-3c41-4d8e-9a7b-6f1d2c3e4a5b',
  name: 'Main entrance',
  location: 'Ground floor',
  deviceType: 'SIMULATED',
  status: 'ACTIVE',
};

const REAL_DEVICE: AccessDeviceBrief = {
  id: '9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f',
  name: 'Side door',
  location: 'Car park',
  deviceType: 'REAL',
  status: 'ACTIVE',
};

const FIXTURES: SimulatorFixturesDto = {
  devices: [SIM_DEVICE],
  fixtures: [
    {
      deviceId: SIM_DEVICE.id,
      templateRef: 'SIM-0001',
      label: 'Sana Qureshi',
      memberFirstName: 'Sana',
      expected: 'GRANTED',
    },
    {
      deviceId: SIM_DEVICE.id,
      templateRef: SIM_UNENROLLED_REF,
      label: 'Unenrolled fingerprint',
      memberFirstName: null,
      expected: 'MEMBER_NOT_RECOGNIZED',
    },
  ],
};

let attemptSeq = 0;
function decision(overrides: Partial<AccessDecision> = {}): AccessDecision {
  attemptSeq += 1;
  return {
    decision: 'GRANTED',
    reason: 'GRANTED',
    title: 'Access Granted',
    message: 'Welcome, Sana. Valid until 18 Nov 2026.',
    source: 'SIMULATED',
    attemptId: `5d6e7f80-1a2b-4c3d-8e4f-${String(attemptSeq).padStart(12, '0')}`,
    duplicate: false,
    occurredAt: new Date().toISOString(),
    deviceId: SIM_DEVICE.id,
    member: { firstName: 'Sana', memberCode: 'M-00021', photoUrl: null },
    membership: { planName: 'Monthly Unlimited', endDate: '2026-11-18' },
    ...overrides,
  };
}

const CANCELLED = (): Partial<AccessDecision> => ({
  decision: 'DENIED',
  reason: 'MEMBERSHIP_CANCELLED',
  title: 'Access Denied',
  message: 'Membership cancelled. Please see reception.',
  membership: undefined,
});

/** jsdom has no EventSource; this one lets a test push server events. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState === FakeEventSource.CLOSED) return;
      this.readyState = FakeEventSource.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
}

const openStream = () => FakeEventSource.instances.findLast((s) => s.readyState !== 2)!;
const push = (payload: unknown) =>
  act(() =>
    openStream().emit('decision', typeof payload === 'string' ? payload : JSON.stringify(payload)),
  );

interface Api {
  devices?: AccessDeviceBrief[];
  /** null = simulator switched off (404). */
  fixtures?: SimulatorFixturesDto | null;
  simulate?: () => { status: number; body?: unknown } | 'network-error';
}

function stubApi({ devices = [SIM_DEVICE], fixtures = FIXTURES, simulate }: Api = {}) {
  const simulated: unknown[] = [];
  const handler = mockFetch((url, init) => {
    if (url.includes('/access/devices')) return { status: 200, body: { data: devices } };
    if (url.includes('/access/simulator/fixtures'))
      return fixtures
        ? { status: 200, body: fixtures }
        : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    if (url.includes('/access/attempts'))
      return { status: 200, body: { data: [], page: 1, pageSize: 6, total: 0 } };
    if (url.includes('/access/simulate') && init?.method === 'POST') {
      simulated.push(JSON.parse(String(init.body)));
      const answer = simulate?.() ?? { status: 200, body: decision() };
      if (answer === 'network-error') throw new TypeError('Failed to fetch');
      return answer;
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(handler);
  return { simulated };
}

const screenRegion = () => screen.getByRole('region', { name: 'Entrance screen' });

async function renderDesk(api?: Api) {
  const calls = stubApi(api);
  renderWithProviders(<CheckInPage />, { me: fakeMe('RECEPTIONIST'), path: '/check-in' });
  await screen.findByText(KIOSK_IDLE_PROMPT);
  return calls;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('check-in desk kiosk', () => {
  it('shows Access Granted with the plan for a granted simulated scan', async () => {
    const { simulated } = await renderDesk();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Scan Sana Qureshi (SIM-0001)' }),
    );

    const kiosk = screenRegion();
    expect(await within(kiosk).findByText('Access Granted')).toBeInTheDocument();
    expect(within(kiosk).getByText('Welcome, Sana. Valid until 18 Nov 2026.')).toBeInTheDocument();
    expect(within(kiosk).getByText(/Monthly Unlimited · until 18 Nov 2026/)).toBeInTheDocument();
    expect(simulated).toEqual([{ deviceId: SIM_DEVICE.id, templateRef: 'SIM-0001' }]);
  });

  it('shows Access Denied with the reason for a denied scan', async () => {
    await renderDesk({ simulate: () => ({ status: 200, body: decision(CANCELLED()) }) });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Scan Sana Qureshi (SIM-0001)' }),
    );

    const kiosk = screenRegion();
    expect(await within(kiosk).findByText('Access Denied')).toBeInTheDocument();
    expect(
      within(kiosk).getByText('Membership cancelled. Please see reception.'),
    ).toBeInTheDocument();
    expect(within(kiosk).queryByText('Access Granted')).not.toBeInTheDocument();
  });

  it('shows Member Not Recognized for an unknown fingerprint', async () => {
    const { simulated } = await renderDesk({
      simulate: () => ({
        status: 200,
        body: decision({
          decision: 'DENIED',
          reason: 'MEMBER_NOT_RECOGNIZED',
          title: 'Member Not Recognized',
          message: 'Please try again or see reception.',
          member: undefined,
          membership: undefined,
        }),
      }),
    });
    await userEvent.click(
      await screen.findByRole('button', {
        name: `Scan Unenrolled fingerprint (${SIM_UNENROLLED_REF}, not enrolled)`,
      }),
    );

    expect(await within(screenRegion()).findByText('Member Not Recognized')).toBeInTheDocument();
    expect(simulated).toEqual([{ deviceId: SIM_DEVICE.id, templateRef: SIM_UNENROLLED_REF }]);
  });

  it('sends a recognised fingerprint for the "backend cannot verify" case', async () => {
    const { simulated } = await renderDesk({
      simulate: () => ({
        status: 200,
        body: decision({
          decision: 'DENIED',
          reason: 'AUTHORIZATION_UNAVAILABLE',
          title: 'Access Denied',
          message: 'Membership could not be verified. Please see reception.',
          membership: undefined,
        }),
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: /Backend cannot verify/ }));

    expect(await within(screenRegion()).findByText('Access Denied')).toBeInTheDocument();
    expect(simulated).toEqual([
      { deviceId: SIM_DEVICE.id, scenario: 'AUTHORIZATION_UNAVAILABLE', templateRef: 'SIM-0001' },
    ]);
  });

  it('keeps the SIMULATED banner on screen for a simulated scanner', async () => {
    await renderDesk();
    expect(within(screenRegion()).getByRole('note')).toHaveTextContent(SIMULATED_BANNER);
  });

  it('fails closed when the request fails', async () => {
    await renderDesk({ simulate: () => 'network-error' });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Scan Sana Qureshi (SIM-0001)' }),
    );

    const kiosk = screenRegion();
    expect(await within(kiosk).findByText('Access Denied')).toBeInTheDocument();
    expect(
      within(kiosk).getByText('Membership could not be verified. Please see reception.'),
    ).toBeInTheDocument();
  });

  it('fails closed on a server error', async () => {
    await renderDesk({
      simulate: () => ({
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
      }),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Scan Sana Qureshi (SIM-0001)' }),
    );
    expect(
      await within(screenRegion()).findByText(/Membership could not be verified/),
    ).toBeInTheDocument();
  });

  it('fails closed on a malformed body that claims a grant', async () => {
    await renderDesk({ simulate: () => ({ status: 200, body: { decision: 'GRANTED' } }) });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Scan Sana Qureshi (SIM-0001)' }),
    );

    const kiosk = screenRegion();
    expect(await within(kiosk).findByText(/Membership could not be verified/)).toBeInTheDocument();
    expect(within(kiosk).queryByText('Access Granted')).not.toBeInTheDocument();
  });

  it('fails closed when the result and the reason disagree', async () => {
    await renderDesk();
    await push(decision({ decision: 'GRANTED', reason: 'MEMBERSHIP_EXPIRED' }));

    const kiosk = screenRegion();
    expect(within(kiosk).getByText(/Membership could not be verified/)).toBeInTheDocument();
    expect(within(kiosk).queryByText('Access Granted')).not.toBeInTheDocument();
  });

  it('shows decisions pushed over the live stream, and fails closed on a garbled event', async () => {
    await renderDesk();
    expect(openStream().url).toContain(`deviceId=${SIM_DEVICE.id}`);
    expect(await screen.findByText('Live')).toBeInTheDocument();

    await push(decision(CANCELLED()));
    expect(within(screenRegion()).getByText('Access Denied')).toBeInTheDocument();

    await push('{not json');
    expect(
      within(screenRegion()).getByText(/Membership could not be verified/),
    ).toBeInTheDocument();
  });

  it(`returns to "${KIOSK_IDLE_PROMPT}" ${KIOSK_RESET_MS / 1000} seconds after a result`, async () => {
    await renderDesk();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await push(decision());
    expect(within(screenRegion()).getByText('Access Granted')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(KIOSK_RESET_MS - 100));
    expect(within(screenRegion()).getByText('Access Granted')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(200));
    expect(within(screenRegion()).queryByText('Access Granted')).not.toBeInTheDocument();
    expect(within(screenRegion()).getByText(KIOSK_IDLE_PROMPT)).toBeInTheDocument();
  });

  it('shows the same attempt only once (simulate response and live stream)', async () => {
    await renderDesk();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const granted = decision();
    await push(granted);
    act(() => vi.advanceTimersByTime(3_000));
    // The stream repeats the attempt the simulate response already showed: no new 5 s window.
    await push(granted);
    act(() => vi.advanceTimersByTime(2_100));
    expect(within(screenRegion()).getByText(KIOSK_IDLE_PROMPT)).toBeInTheDocument();

    // A new attempt is shown again.
    await push(decision(CANCELLED()));
    expect(within(screenRegion()).getByText('Access Denied')).toBeInTheDocument();
  });

  it('hides the simulator when it is switched off on the server', async () => {
    await renderDesk({ fixtures: null });
    expect(screen.queryByRole('heading', { name: 'Simulated scanner' })).not.toBeInTheDocument();
    // The device is still a simulated one, so the banner stays.
    expect(within(screenRegion()).getByRole('note')).toHaveTextContent(SIMULATED_BANNER);
  });

  it('shows no simulator and no banner for a real scanner', async () => {
    await renderDesk({ devices: [REAL_DEVICE] });
    expect(screen.queryByRole('heading', { name: 'Simulated scanner' })).not.toBeInTheDocument();
    expect(within(screenRegion()).queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('full-screen kiosk', () => {
  it('listens to its device and shows results with the SIMULATED banner', async () => {
    stubApi();
    renderWithProviders(<p>Elsewhere</p>, {
      me: fakeMe('RECEPTIONIST'),
      path: `/kiosk/${SIM_DEVICE.id}`,
      routes: [{ path: '/kiosk/:deviceId', element: <KioskPage /> }],
    });

    expect(await screen.findByText(KIOSK_IDLE_PROMPT)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Entrance kiosk · Main entrance/ }),
    ).toBeInTheDocument();
    expect(within(screenRegion()).getByRole('note')).toHaveTextContent(SIMULATED_BANNER);
    // The kiosk only displays; there is no way to scan from it.
    expect(screen.queryByRole('button', { name: /Scan / })).not.toBeInTheDocument();

    await push(decision());
    expect(within(screenRegion()).getByText('Access Granted')).toBeInTheDocument();
  });

  it('says so when the scanner does not exist', async () => {
    stubApi();
    renderWithProviders(<p>Elsewhere</p>, {
      me: fakeMe('RECEPTIONIST'),
      path: `/kiosk/${REAL_DEVICE.id}`,
      routes: [{ path: '/kiosk/:deviceId', element: <KioskPage /> }],
    });
    expect(await screen.findByText('Scanner not available')).toBeInTheDocument();
  });
});
