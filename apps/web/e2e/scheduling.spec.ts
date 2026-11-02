import { expect, test, type Page } from '@playwright/test';
import {
  CLASS_MEMBER,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  signIn,
  signInAs,
  USERS,
  WORKOUT_MEMBER,
} from './helpers';

const CLASS = 'Sunrise Mobility';
const TRAINER = `${USERS.TRAINER.firstName} ${USERS.TRAINER.lastName}`;
const MEMBER_NAME = `${CLASS_MEMBER.firstName} ${CLASS_MEMBER.lastName}`;

/** Tomorrow in gym time (Asia/Karachi), as YYYY-MM-DD; `?week=` accepts any day of the week. */
function gymTomorrow() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Dismiss a toast so the next one (and axe) is not judged mid-animation. */
async function closeToast(page: Page, text: string | RegExp) {
  const toast = page.getByRole('listitem').filter({ hasText: text });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(toast).toBeHidden();
}

async function settled(page: Page, heading: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('an admin schedules a class, a member books it, the trainer sees it on their dashboard', async ({
  page,
}) => {
  // Three sign-ins and eight axe scans in one flow.
  test.setTimeout(120_000);
  const tomorrow = gymTomorrow();

  // Admin: the class type, then one session tomorrow.
  await signInAs(page, 'ADMIN');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Classes' })
    .click();
  await settled(page, 'Classes');
  await page.getByRole('tab', { name: 'Class list' }).click();
  await expect(page.getByText('No classes yet')).toBeVisible();
  await page.getByRole('button', { name: 'New class' }).click();
  const form = page.getByRole('dialog', { name: 'New class' });
  await form.getByLabel('Name').fill(CLASS);
  await form.getByLabel(/Description/).fill('Joint mobility and breathing to start the day.');
  await form.getByLabel('Length (minutes)').fill('45');
  await form.getByLabel('Places').fill('12');
  await form.getByLabel(/Usual trainer/).selectOption({ label: TRAINER });
  await expectNoAxeViolations(page);
  await form.getByRole('button', { name: 'Create class' }).click();
  await closeToast(page, `${CLASS} created`);
  const classList = page.getByRole('list', { name: 'Classes' });
  await expect(classList.getByRole('listitem').filter({ hasText: CLASS })).toContainText(
    `45 min · 12 places · usually ${TRAINER}`,
  );

  await page.goto(`/classes?week=${tomorrow}`);
  await settled(page, 'Classes');
  await page.getByRole('button', { name: 'Schedule a class' }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule a class' });
  await schedule.getByLabel('Class').selectOption({ label: CLASS });
  // The class's defaults are copied in.
  await expect(schedule.getByLabel('Trainer')).toHaveValue(/.+/);
  await expect(schedule.getByLabel('Places')).toHaveValue('12');
  await schedule.getByLabel('Date').fill(tomorrow);
  await schedule.getByLabel('Start time').fill('07:00');
  await schedule.getByLabel(/Room/).fill('Studio A');
  await expectNoAxeViolations(page);
  await schedule.getByRole('button', { name: 'Schedule session' }).click();
  await closeToast(page, `${CLASS} scheduled for`);
  const timetable = page.getByRole('list', { name: 'Class timetable' });
  await expect(timetable.getByRole('link', { name: CLASS })).toBeVisible();
  await expect(timetable.getByText(/Studio A · 0\/12/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  // Member: book from the portal timetable; it shows on their schedule.
  await page.context().clearCookies();
  await signIn(page, CLASS_MEMBER.email);
  await expect(page).toHaveURL(/\/portal$/);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('link', { name: 'Classes' }).click();
  await settled(page, 'Classes');
  await page.goto(`/portal/classes?week=${tomorrow}`);
  await settled(page, 'Classes');
  await page.getByRole('button', { name: new RegExp(`^Book ${CLASS}`) }).click();
  await closeToast(page, `Booked: ${CLASS}`);
  await expect(page.getByRole('button', { name: `Cancel booking for ${CLASS}` })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  await nav.getByRole('link', { name: 'My schedule' }).click();
  await settled(page, 'My schedule');
  const comingUp = page.getByRole('list', { name: 'Coming up' });
  const booked = comingUp.getByRole('listitem').filter({ hasText: CLASS });
  await expect(booked).toContainText('Booked');
  await expect(booked).toContainText(`with ${TRAINER}`);
  await expectNoAxeViolations(page);

  await nav.getByRole('link', { name: 'Trainers' }).click();
  await settled(page, 'Trainers');
  await expect(page.getByRole('heading', { name: TRAINER })).toBeVisible();
  await expectNoAxeViolations(page);

  // Trainer: the class is on their dashboard and its roster lists the member.
  await page.context().clearCookies();
  await signInAs(page, 'TRAINER');
  await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Coming up' }).getByRole('listitem').filter({ hasText: CLASS }),
  ).toBeVisible();
  await expect(page.getByText('Assigned members')).toBeVisible();
  await expectNoAxeViolations(page);
  // Trainers see their own training screens, not the desk's.
  const trainerNav = page.getByRole('navigation', { name: 'Main' });
  await expect(trainerNav.getByRole('link', { name: 'My members' })).toBeVisible();
  await expect(trainerNav.getByRole('link', { name: 'Staff' })).toHaveCount(0);

  await page.goto(`/classes?week=${tomorrow}`);
  await settled(page, 'Classes');
  await page.getByRole('link', { name: CLASS }).click();
  await settled(page, CLASS);
  await expect(
    page
      .getByRole('region', { name: 'Places' })
      .getByRole('listitem')
      .filter({ hasText: MEMBER_NAME }),
  ).toBeVisible();
  // Trainers cannot book members into classes or change the session.
  await expect(page.getByRole('button', { name: 'Book a member' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  await trainerNav.getByRole('link', { name: 'My members' }).click();
  await settled(page, 'My members');
  // Only the member assigned to this trainer in the fixtures; class members are not "theirs".
  const mine = page.getByRole('list', { name: 'My members' }).getByRole('listitem');
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText(`${WORKOUT_MEMBER.firstName} ${WORKOUT_MEMBER.lastName}`);
  await expect(page.getByRole('main')).not.toContainText(MEMBER_NAME);

  // Member: cancelling frees the place.
  await page.context().clearCookies();
  await signIn(page, CLASS_MEMBER.email);
  await expect(page).toHaveURL(/\/portal$/);
  await page.goto('/portal/schedule');
  await settled(page, 'My schedule');
  await page.getByRole('button', { name: `Cancel ${CLASS}` }).click();
  const confirm = page.getByRole('dialog', { name: 'Cancel your class booking?' });
  await confirm.getByRole('button', { name: 'Cancel it' }).click();
  await closeToast(page, 'Booking cancelled');
  await expect(page.getByText('Nothing booked yet')).toBeVisible();
});

test('booking with a trainer who has no weekly hours explains why and links to the hours', async ({
  page,
}) => {
  await signInAs(page, 'MANAGER');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Trainers' })
    .click();
  await settled(page, 'Trainers');
  // The E2E trainer never gets weekly hours, so the list flags it before anyone tries to book.
  await expect(
    page.getByRole('link', { name: new RegExp(TRAINER) }).getByText('No weekly hours'),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Appointments' })
    .click();
  await settled(page, 'Appointments');
  await page.getByRole('button', { name: 'Book appointment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Book an appointment' });
  await dialog.getByLabel('Trainer').selectOption({ label: `${TRAINER} (no weekly hours)` });
  const startTime = dialog.getByRole('group', { name: 'Start time' });
  await expect(startTime.getByText(`${TRAINER} has no weekly hours yet`)).toBeVisible();
  await expectNoAxeViolations(page);

  await startTime.getByRole('link', { name: 'Set weekly hours' }).click();
  await expect(page).toHaveURL(/\/trainers\/[0-9a-f-]+\?tab=hours$/);
  await settled(page, TRAINER);
  await expect(page.getByRole('tab', { name: 'Hours and time off' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Edit hours' })).toBeVisible();
});
