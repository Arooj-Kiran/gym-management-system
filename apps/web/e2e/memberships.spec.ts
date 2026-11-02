import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, MEMBER, PLAN, signInAs, signInAsMember } from './helpers';

const NAME = `${MEMBER.firstName} ${MEMBER.lastName}`;

async function openMembershipTab(page: Page) {
  await page.goto('/members');
  await page.getByRole('link', { name: new RegExp(NAME) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
  await page.getByRole('tab', { name: 'Membership' }).click();
  await expect(page).toHaveURL(/\?tab=membership$/);
  return page.getByRole('region', { name: 'Current membership' });
}

test('the front desk assigns and activates a membership; a manager cancels it', async ({
  page,
}) => {
  // Reception: assign the plan (pending), then activate it.
  await signInAs(page, 'RECEPTIONIST');
  await openMembershipTab(page);
  await expect(page.getByText('No membership yet')).toBeVisible();

  await page.getByRole('button', { name: 'Assign membership' }).first().click();
  const assign = page.getByRole('dialog', { name: `Assign a membership to ${NAME}` });
  const planValue = await assign.locator('option', { hasText: PLAN.name }).getAttribute('value');
  await assign.getByLabel('Plan').selectOption(planValue!);
  await expect(assign.getByText('Membership period')).toBeVisible();
  await expectNoAxeViolations(page);
  await assign.getByRole('button', { name: 'Assign membership' }).click();
  const assigned = page
    .getByRole('listitem')
    .filter({ hasText: `${PLAN.name} assigned to ${NAME}` });
  await expect(assigned).toBeVisible();
  // Dismiss it: a toast fading behind a newer one is mid-animation, not something axe can judge.
  await assigned.getByRole('button', { name: 'Close toast' }).click();
  await expect(assigned).toBeHidden();

  const current = page.getByRole('region', { name: 'Current membership' });
  await expect(current.getByText(PLAN.name)).toBeVisible();
  await expect(current.getByText('Pending', { exact: true })).toBeVisible();
  // Reception may activate but not cancel or suspend.
  await expect(current.getByRole('button', { name: 'Cancel membership' })).toHaveCount(0);

  await current.getByRole('button', { name: 'Activate' }).click();
  const activate = page.getByRole('dialog', { name: `Activate ${NAME}'s membership?` });
  await activate.getByRole('button', { name: 'Activate' }).click();
  const activated = page
    .getByRole('listitem')
    .filter({ hasText: `Membership activated for ${NAME}` });
  await expect(activated).toBeVisible();
  // Dismiss it before the axe scan below: a toast still fading in is not something axe can judge.
  await activated.getByRole('button', { name: 'Close toast' }).click();
  await expect(activated).toBeHidden();
  await expect(current.getByText('Active', { exact: true })).toBeVisible();

  const history = page.getByRole('list', { name: 'Membership history' });
  await expect(history.getByText('Activated')).toBeVisible();
  await expect(history.getByText('Assigned')).toBeVisible();
  await expectNoAxeViolations(page);

  // The member sees it in their portal.
  await page.context().clearCookies();
  await signInAsMember(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My membership' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My membership');
  await expect(page.getByRole('heading', { name: PLAN.name })).toBeVisible();
  await expect(page.getByText('days left, including today')).toBeVisible();

  // Manager: cancelling needs a reason and is recorded in the timeline. The unpaid invoice is
  // voided with it unless the box is unticked.
  await page.context().clearCookies();
  await signInAs(page, 'MANAGER');
  await openMembershipTab(page);
  await current.getByRole('button', { name: 'Cancel membership' }).click();
  const cancel = page.getByRole('dialog', { name: `Cancel ${NAME}'s membership?` });
  await expect(
    cancel.getByRole('checkbox', { name: /Also void its unpaid invoice/ }),
  ).toBeChecked();
  await cancel.getByLabel(/Reason/).fill('Moving to Lahore');
  await expectNoAxeViolations(page);
  await cancel.getByRole('button', { name: 'Cancel membership' }).click();
  await expect(page.getByText(`Membership cancelled for ${NAME}`)).toBeVisible();
  await expect(page.getByText(/Invoice INV-\d+ was voided\./)).toBeVisible();
  await expect(current.getByText('Cancelled', { exact: true })).toBeVisible();
  await expect(history.getByText('Moving to Lahore')).toBeVisible();
  await expect(history.getByText(/invoice INV-\d+ voided/)).toBeVisible();

  // The whole-gym list shows the period with its final status.
  await page.goto('/memberships?status=CANCELLED');
  await expect(page.getByRole('link', { name: new RegExp(NAME) })).toBeVisible();
});
