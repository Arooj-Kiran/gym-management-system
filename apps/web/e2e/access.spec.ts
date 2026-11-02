import { expect, test, type Page } from '@playwright/test';
import {
  ACCESS_MEMBER,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  PASSWORD,
  PLAN,
  signIn,
  signInAs,
  VIEWPORTS,
} from './helpers';

const NAME = `${ACCESS_MEMBER.firstName} ${ACCESS_MEMBER.lastName}`;
const SCANNER = 'E2E front door';
const BANNER = 'SIMULATED SCANNER — not real biometric verification';

async function openMember(page: Page) {
  await page.goto('/members');
  await page.getByRole('link', { name: new RegExp(NAME) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
}

/** Dismiss a toast so the next one (and axe) is not judged mid-animation. */
async function closeToast(page: Page, text: string) {
  const toast = page.getByRole('listitem').filter({ hasText: text });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(toast).toBeHidden();
}

/** Scan the member's fake fingerprint on the check-in desk and return the entrance screen. */
async function scan(page: Page) {
  await page.goto('/check-in');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check-in desk');
  const kiosk = page.getByRole('region', { name: 'Entrance screen' });
  await expect(kiosk.getByText('Live')).toBeVisible();
  await page.getByRole('button', { name: new RegExp(`^Scan ${NAME} \\(SIM-`) }).click();
  return kiosk;
}

test('a cancelled membership is denied at the very next scan', async ({ page }) => {
  // Four sign-ins and five axe scans in one flow: more than the default 30 s.
  test.setTimeout(90_000);
  // Admin adds a simulated scanner; its key is shown once.
  await signInAs(page, 'ADMIN');
  await page.goto('/devices');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scanners');
  await page.getByRole('button', { name: 'Add scanner' }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a scanner' });
  await form.getByLabel('Name').fill(SCANNER);
  await form.getByLabel('Location').fill('Ground floor');
  await expect(form.getByLabel('Type')).toHaveValue('SIMULATED');
  await form.getByRole('button', { name: 'Add scanner' }).click();
  const keyDialog = page.getByRole('dialog', { name: `${SCANNER} added` });
  // By role: the "Copy device key" button carries the same words in its label.
  await expect(keyDialog.getByRole('textbox', { name: 'Device key' })).not.toHaveValue('');
  await keyDialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('list', { name: 'Scanners' }).getByText(SCANNER)).toBeVisible();
  await expectNoAxeViolations(page);

  // Manager: consent first, then enroll; then a membership.
  await page.context().clearCookies();
  await signInAs(page, 'MANAGER');
  await openMember(page);
  await page.getByRole('button', { name: 'Record consent' }).click();
  const consent = page.getByRole('dialog', { name: 'Record fingerprint consent' });
  await consent.getByRole('checkbox').check();
  await consent.getByRole('button', { name: 'Record consent' }).click();
  await closeToast(page, `Consent recorded for ${NAME}`);

  await page.getByRole('button', { name: 'Enroll fingerprint' }).click();
  const enroll = page.getByRole('dialog', {
    name: `Enroll a fingerprint for ${ACCESS_MEMBER.firstName}`,
  });
  await expect(enroll.getByText(/Simulated scanner: a fake SIM- ID/)).toBeVisible();
  await enroll.getByRole('button', { name: 'Enroll fingerprint' }).click();
  await closeToast(page, `Fingerprint enrolled on ${SCANNER}`);
  const enrollments = page.getByRole('list', { name: 'Fingerprint enrollments' });
  // Only the masked device user ID is ever shown.
  await expect(enrollments.getByText(/^SIM-••\w{2}$/)).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole('tab', { name: 'Membership' }).click();
  await page.getByRole('button', { name: 'Assign membership' }).first().click();
  const assign = page.getByRole('dialog', { name: `Assign a membership to ${NAME}` });
  const planValue = await assign.locator('option', { hasText: PLAN.name }).getAttribute('value');
  await assign.getByLabel('Plan').selectOption(planValue!);
  await assign.getByRole('button', { name: 'Assign membership' }).click();
  await closeToast(page, `${PLAN.name} assigned to ${NAME}`);
  const current = page.getByRole('region', { name: 'Current membership' });
  await current.getByRole('button', { name: 'Activate' }).click();
  await page
    .getByRole('dialog', { name: `Activate ${NAME}'s membership?` })
    .getByRole('button', { name: 'Activate' })
    .click();
  await expect(current.getByText('Active', { exact: true })).toBeVisible();

  // Scan: the server finds an active membership.
  let kiosk = await scan(page);
  await expect(kiosk.getByText('Access Granted')).toBeVisible();
  await expect(kiosk.getByText(new RegExp(`Welcome, ${ACCESS_MEMBER.firstName}`))).toBeVisible();
  await expect(kiosk.getByRole('note')).toHaveText(BANNER);
  await expectNoAxeViolations(page);

  // Cancel the membership, then scan again straight away.
  await openMember(page);
  await page.getByRole('tab', { name: 'Membership' }).click();
  await current.getByRole('button', { name: 'Cancel membership' }).click();
  const cancel = page.getByRole('dialog', { name: `Cancel ${NAME}'s membership?` });
  await cancel.getByLabel(/Reason/).fill('Asked to stop');
  await cancel.getByRole('button', { name: 'Cancel membership' }).click();
  await expect(current.getByText('Cancelled', { exact: true })).toBeVisible();

  kiosk = await scan(page);
  await expect(kiosk.getByText('Access Denied')).toBeVisible();
  await expect(kiosk.getByText(/cancelled/i)).toBeVisible();
  await expect(kiosk.getByText('Access Granted')).toHaveCount(0);

  // Both attempts are logged; only the granted one became a check-in.
  await page.goto(`/access-log?q=${encodeURIComponent(ACCESS_MEMBER.lastName)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Access log');
  const attempts = page.getByRole('list', { name: 'Access attempts' }).getByRole('listitem');
  await expect(attempts).toHaveCount(2);
  await expect(attempts.first()).toContainText('Cancelled');
  await expect(attempts.last()).toContainText('Granted');
  await expectNoAxeViolations(page);

  await page.goto('/attendance');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Attendance');
  const checkIns = page.getByRole('list', { name: 'Check-ins' }).getByRole('listitem');
  await expect(checkIns.filter({ hasText: NAME })).toHaveCount(1);
  await expectNoAxeViolations(page);

  // The member sees the one visit in their portal.
  await page.context().clearCookies();
  await signIn(page, ACCESS_MEMBER.email, PASSWORD);
  await expect(page).toHaveURL(/\/portal$/);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My attendance' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My attendance');
  const visits = page.getByRole('list', { name: 'My check-ins' }).getByRole('listitem');
  await expect(visits).toHaveCount(1);
  await expect(visits.first()).toContainText('Test scanner');
});

test('the full-screen kiosk fits phones, tablets and desktops and is accessible', async ({
  page,
}) => {
  await signInAs(page, 'RECEPTIONIST');
  await page.goto('/check-in');
  await page.getByRole('link', { name: 'Full-screen kiosk' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Entrance kiosk · /);
  const kiosk = page.getByRole('region', { name: 'Entrance screen' });
  await expect(kiosk.getByText('Place your thumb on the scanner')).toBeVisible();
  await expect(kiosk.getByRole('note')).toHaveText(BANNER);

  for (const { width, height } of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
  }

  await page.getByRole('link', { name: 'Exit kiosk' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check-in desk');
});
