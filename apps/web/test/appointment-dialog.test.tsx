import { addDays, type AvailabilitySlotDto, type Role, type TrainerDto } from '@gms/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppointmentDialog } from '../src/features/scheduling/appointment-dialogs';
import { formatDayHeading, isoWeekday } from '../src/features/scheduling/schedule-format';
import { gymTodayIso } from '../src/lib/format';
import { fakeMe, mockFetch, renderWithProviders } from './render';

afterEach(() => vi.restoreAllMocks());

const TRAINER: TrainerDto = {
  id: '0b6c1f4e-2d3a-4b5c-8d9e-1f2a3b4c5d6e',
  firstName: 'Hira',
  lastName: 'Siddiqui',
  email: 'hira.siddiqui@example.test',
  isActive: true,
  bio: null,
  specializations: ['Strength'],
  certifications: [],
  isBookable: true,
  activeMemberCount: 3,
  hasWeeklyHours: true,
};

const slot = (weekday: number, startTime: string, endTime: string): AvailabilitySlotDto => ({
  id: `slot-${weekday}-${startTime}`,
  weekday,
  startTime,
  endTime,
  effectiveFrom: '2026-01-05',
  effectiveTo: null,
});

const today = gymTodayIso();
const todayWeekday = isoWeekday(today);
const tomorrow = addDays(today, 1);

/**
 * The booking dialog against a fake API: `weekly` are the trainer's hours, and only `freeOn`
 * (if given) has a free start time, at 10:00 gym time.
 */
function renderBooking({
  role = 'RECEPTIONIST' as Role,
  trainer = TRAINER,
  weekly = [] as AvailabilitySlotDto[],
  freeOn = null as string | null,
} = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    mockFetch((url) => {
      if (url.includes('/available-slots')) {
        const date = new URL(url, 'http://localhost').searchParams.get('date');
        const data =
          date === freeOn
            ? [{ startsAt: `${date}T05:00:00.000Z`, endsAt: `${date}T06:00:00.000Z` }]
            : [];
        return { status: 200, body: { data } };
      }
      if (url.includes(`/trainers/${trainer.id}/availability`)) {
        return { status: 200, body: { current: weekly, upcoming: null, timeOff: [] } };
      }
      if (url.endsWith('/trainers')) return { status: 200, body: { data: [trainer] } };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    }),
  );
  renderWithProviders(<AppointmentDialog open onOpenChange={() => {}} />, {
    me: fakeMe(role),
  });
}

async function chooseTrainer(name: RegExp) {
  const user = userEvent.setup();
  const dialog = await screen.findByRole('dialog', { name: 'Book an appointment' });
  const select = within(dialog).getByLabelText('Trainer');
  await within(select).findByRole('option', { name });
  await user.selectOptions(select, within(select).getByRole('option', { name }));
  const startTime = within(dialog).getByRole('group', { name: 'Start time' });
  return { user, dialog, startTime };
}

describe('Book an appointment: why no start time is offered', () => {
  it('a trainer without weekly hours: says so and links a manager to the hours editor', async () => {
    renderBooking({ role: 'MANAGER', trainer: { ...TRAINER, hasWeeklyHours: false } });
    const { dialog, startTime } = await chooseTrainer(/Hira Siddiqui \(no weekly hours\)/);
    expect(
      await within(startTime).findByText('Hira Siddiqui has no weekly hours yet'),
    ).toBeVisible();
    expect(within(startTime).getByRole('link', { name: 'Set weekly hours' })).toHaveAttribute(
      'href',
      `/trainers/${TRAINER.id}?tab=hours`,
    );

    // Trying to book anyway does not add a misleading "Choose a start time" error.
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Book appointment' }));
    expect(within(dialog).queryByText('Choose a start time')).not.toBeInTheDocument();
  });

  it('the front desk cannot edit hours, so it is told who can', async () => {
    renderBooking({ trainer: { ...TRAINER, hasWeeklyHours: false } });
    const { startTime } = await chooseTrainer(/Hira Siddiqui/);
    expect(
      await within(startTime).findByText(/An admin, a manager or the trainer can add them/),
    ).toBeVisible();
    expect(within(startTime).queryByRole('link')).not.toBeInTheDocument();
  });

  it('a day the trainer does not work: lists their days and jumps to the next one', async () => {
    renderBooking({ weekly: [slot(isoWeekday(tomorrow), '09:00', '13:00')], freeOn: tomorrow });
    const { user, startTime } = await chooseTrainer(/Hira Siddiqui/);
    expect(await within(startTime).findByText(/doesn't work on \w+days$/)).toBeVisible();

    await user.click(
      within(startTime).getByRole('button', { name: `Show ${formatDayHeading(tomorrow)}` }),
    );
    expect(await within(startTime).findByRole('radio')).toBeInTheDocument();
    expect(screen.getByLabelText('Date')).toHaveValue(tomorrow);
  });

  it('a working day that is fully taken shows the hours that day', async () => {
    renderBooking({
      weekly: [slot(todayWeekday, '07:00', '10:00'), slot(todayWeekday, '16:00', '20:00')],
    });
    const { startTime } = await chooseTrainer(/Hira Siddiqui/);
    expect(
      await within(startTime).findByText(
        /Hira Siddiqui works 07:00–10:00 and 16:00–20:00 that day/,
      ),
    ).toBeVisible();
    expect(within(startTime).getByText(/^No free 60-minute time on /)).toBeVisible();
  });
});
