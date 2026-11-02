import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, MEMBER, signInAs, signInAsMember } from './helpers';

const NAME = `${MEMBER.firstName} ${MEMBER.lastName}`;
const CHARGE = 'Locker rental · October';

async function openPaymentsTab(page: Page) {
  await page.goto('/members');
  await page.getByRole('link', { name: new RegExp(NAME) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(NAME);
  await page.getByRole('tab', { name: 'Payments' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Payments' })).toBeVisible();
}

/** Dismiss a toast so the next one (and axe) is not judged mid-animation. */
async function closeToast(page: Page, text: string | RegExp) {
  const toast = page.getByRole('listitem').filter({ hasText: text });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(toast).toBeHidden();
}

const chargeRow = (page: Page) =>
  page.getByRole('list', { name: 'Invoices' }).getByRole('listitem').filter({ hasText: CHARGE });

/** Pay from the invoice row; the dialog prefills the balance, `amount` overrides it. */
async function payFromRow(page: Page, expectedPrefill: string, amount?: string) {
  await chargeRow(page).getByRole('button', { name: 'Pay' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record payment' });
  const field = dialog.getByLabel(/Amount/);
  await expect(field).toHaveValue(expectedPrefill);
  if (amount) await field.fill(amount);
  await expect(dialog.getByRole('radio', { name: /Online/ })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Record payment' }).click();
  await closeToast(page, /received · RCP-/);
  await expect(dialog).toBeHidden();
}

test('the desk bills a charge and takes it in two payments; a manager refunds; the member sees it', async ({
  page,
}) => {
  // Three roles, a receipt tab and three axe scans in one flow: more than the default 30 s.
  test.setTimeout(90_000);
  // Reception: a manual charge, a part payment, then the rest.
  await signInAs(page, 'RECEPTIONIST');
  await openPaymentsTab(page);
  await page.getByRole('button', { name: 'New charge' }).click();
  const create = page.getByRole('dialog', { name: 'New charge' });
  await create.getByLabel('Description').fill(CHARGE);
  await create.getByLabel(/Amount/).fill('2000');
  await create.getByRole('button', { name: 'Create invoice' }).click();
  await closeToast(page, /INV-\d+ created/);
  await expect(chargeRow(page).getByText('Unpaid', { exact: true })).toBeVisible();

  await payFromRow(page, '2000', '500');
  await expect(chargeRow(page).getByText('Partially paid', { exact: true })).toBeVisible();
  await expect(chargeRow(page).getByText(/1,500(\.00)? left/)).toBeVisible();

  await payFromRow(page, '1500');
  await expect(chargeRow(page).getByText('Paid', { exact: true })).toBeVisible();
  await expect(chargeRow(page).getByRole('button', { name: 'Pay' })).toHaveCount(0);
  const payments = page.getByRole('list', { name: 'Payments' }).getByRole('listitem');
  await expect(payments).toHaveCount(2);
  // Reception may not refund.
  await expect(page.getByRole('button', { name: 'Refund' })).toHaveCount(0);
  await expectNoAxeViolations(page);

  // The printable receipt opens in its own tab.
  const [receipt] = await Promise.all([
    page.context().waitForEvent('page'),
    payments.first().getByRole('button', { name: 'Receipt' }).click(),
  ]);
  await expect(receipt.getByRole('heading', { level: 1 })).toHaveText('Payment receipt');
  await expect(receipt.getByRole('article', { name: /^Receipt RCP-/ })).toContainText(CHARGE);
  await expect(receipt.getByRole('button', { name: 'Print' })).toBeEnabled();
  await expectNoAxeViolations(receipt);
  await receipt.close();

  // Manager: a part refund of the latest payment reopens the invoice.
  await page.context().clearCookies();
  await signInAs(page, 'MANAGER');
  await openPaymentsTab(page);
  await page
    .getByRole('list', { name: 'Payments' })
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: 'Refund' })
    .click();
  const refund = page.getByRole('dialog', { name: /^Refund RCP-/ });
  await expect(refund.getByLabel(/Amount/)).toHaveValue('1500');
  await refund.getByLabel(/Amount/).fill('200');
  await refund.getByLabel(/Reason/).fill('Locker broken for two days');
  await refund.getByRole('button', { name: /^Refund/ }).click();
  await closeToast(page, /refunded from RCP-/);
  await expect(page.getByText(/200(\.00)? refunded/)).toBeVisible();
  await expect(chargeRow(page).getByText('Partially paid', { exact: true })).toBeVisible();

  // The member sees both payments, the balance, and that online payment is not set up.
  await page.context().clearCookies();
  await signInAsMember(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My payments' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My payments');
  await expect(page.getByRole('list', { name: 'My payments' }).getByRole('listitem')).toHaveCount(
    2,
  );
  await expect(
    page.getByRole('list', { name: 'My invoices' }).getByText('Partially paid', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay online' })).toBeDisabled();
  await expect(page.getByText('Requires configuration')).toBeVisible();
  await expectNoAxeViolations(page);
});
