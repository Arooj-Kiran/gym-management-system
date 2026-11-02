import { expect, test, type Page } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  NOTIFY_MEMBER,
  signIn,
  signInAs,
} from './helpers';

const NAME = `${NOTIFY_MEMBER.firstName} ${NOTIFY_MEMBER.lastName}`;

/** The bell that is on screen (the sidebar and the mobile top bar each carry one). */
const bell = (page: Page) => page.getByTestId('notification-bell').locator('visible=true');

test('suspending a membership notifies the member in the app; other channels are not configured', async ({
  page,
}) => {
  test.setTimeout(120_000);

  // Manager suspends the member's membership.
  await signInAs(page, 'MANAGER');
  await page.goto('/members');
  await page.getByRole('link', { name: new RegExp(NAME) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
  await page.getByRole('tab', { name: 'Membership' }).click();
  const current = page.getByRole('region', { name: 'Current membership' });
  await current.getByRole('button', { name: 'Suspend' }).click();
  const suspend = page.getByRole('dialog', { name: `Suspend ${NAME}'s membership?` });
  await suspend.getByLabel(/Reason/).fill('Travelling abroad for a month');
  await suspend.getByRole('button', { name: 'Suspend membership' }).click();
  await expect(current.getByText('Suspended', { exact: true })).toBeVisible();

  // The channels screen: in-app always on, the others waiting for credentials.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Notification channels' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notification channels');
  for (const channel of ['Email', 'SMS', 'WhatsApp']) {
    const card = page.getByRole('region', { name: channel });
    await expect(card).toContainText('Requires configuration');
    await expect(card).toContainText('Not configured');
  }
  await expect(page.getByRole('main')).not.toContainText('Configured');
  await expectNoAxeViolations(page);

  // The member sees it in the bell, opens it, and it is read.
  await page.context().clearCookies();
  await signIn(page, NOTIFY_MEMBER.email);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');
  await bell(page).click();
  const menu = page.getByRole('menu');
  await expect(menu).toContainText('1 unread');
  await expectNoAxeViolations(page);
  await menu.getByRole('menuitem', { name: /Membership suspended/ }).click();
  await expect(page).toHaveURL(/\/portal\/membership$/);
  await expect(bell(page)).toHaveAccessibleName('Notifications');

  // The full list keeps it, now read.
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');
  const list = page.getByRole('list', { name: 'Notifications' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('Gym entry is paused until it is reactivated.');
  await expect(list.getByRole('button', { name: /Mark as read/ })).toHaveCount(0);
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Unread' }).click();
  await expect(page.getByText('No unread notifications')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);
});
