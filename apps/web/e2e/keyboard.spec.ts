import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoAxeViolations, MEMBER, PASSWORD, USERS } from './helpers';

/**
 * Scenario 14: login → members → record payment with the keyboard alone. Nothing below clicks;
 * every control is reached with Tab (or the arrow keys inside a tab list) and used with Enter.
 */

const NAME = `${MEMBER.firstName} ${MEMBER.lastName}`;
const CHARGE = 'Towel service · keyboard check';

const isFocused = (target: Locator) =>
  target.evaluate((element) => element === document.activeElement).catch(() => false);

/** Press Tab until `target` has focus; fails if it is not reachable within `limit` presses. */
async function tabTo(page: Page, target: Locator, limit = 80) {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await isFocused(target)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, `reachable with Tab within ${limit} presses`).toBeFocused();
}

test('the front desk signs in, finds a member and records a payment with the keyboard only', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto('/login');

  await tabTo(page, page.getByLabel('Email'));
  await page.keyboard.type(USERS.RECEPTIONIST.email);
  await tabTo(page, page.getByLabel('Password', { exact: true }));
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(USERS.RECEPTIONIST.firstName);

  // The skip link comes first, so a keyboard user can pass the navigation in one key.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();

  await tabTo(
    page,
    page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Members', exact: true }),
  );
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Members');

  await tabTo(page, page.getByLabel('Search members'));
  await page.keyboard.type(MEMBER.firstName);
  const memberLink = page.getByRole('link', { name: new RegExp(NAME) });
  await expect(memberLink).toBeVisible();
  await tabTo(page, memberLink);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);

  // Tabs take one Tab stop; the arrow keys move between them.
  await tabTo(page, page.getByRole('tab', { selected: true }));
  const payments = page.getByRole('tab', { name: 'Payments' });
  for (let presses = 0; presses < 8 && !(await isFocused(payments)); presses += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await expect(payments).toBeFocused();
  await expect(payments).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Payments' })).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: 'New charge' }));
  await page.keyboard.press('Enter');
  const create = page.getByRole('dialog', { name: 'New charge' });
  await expect(create).toBeVisible();
  await tabTo(page, create.getByLabel('Description'));
  await page.keyboard.type(CHARGE);
  await tabTo(page, create.getByLabel(/Amount/));
  await page.keyboard.type('1200');
  await tabTo(page, create.getByRole('button', { name: 'Create invoice' }));
  await page.keyboard.press('Enter');
  await expect(create).toBeHidden();

  const row = page
    .getByRole('list', { name: 'Invoices' })
    .getByRole('listitem')
    .filter({ hasText: CHARGE });
  await expect(row.getByText('Unpaid', { exact: true })).toBeVisible();
  await tabTo(page, row.getByRole('button', { name: 'Pay' }));
  await page.keyboard.press('Enter');

  const pay = page.getByRole('dialog', { name: 'Record payment' });
  await expect(pay.getByLabel(/Amount/)).toHaveValue('1200');
  await expectNoAxeViolations(page);
  await tabTo(page, pay.getByRole('button', { name: 'Record payment' }));
  await page.keyboard.press('Enter');
  await expect(pay).toBeHidden();
  await expect(page.getByText(/received · RCP-/)).toBeVisible();
  await expect(row.getByText('Paid', { exact: true })).toBeVisible();
  // The paid row has no "Pay" button any more: focus moves to the row's next control, not the body.
  await expect(row.getByRole('button', { name: 'Details' })).toBeFocused();
});
