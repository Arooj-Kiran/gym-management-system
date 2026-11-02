import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow, signInAs } from './helpers';

const ITEM = 'Treadmill 3';

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

test('a manager registers equipment, records a repair and takes it out of service; reception only reads', async ({
  page,
}) => {
  test.setTimeout(120_000);

  await signInAs(page, 'MANAGER');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Equipment' })
    .click();
  await settled(page, 'Equipment');
  await expect(page.getByText('The register is empty')).toBeVisible();

  await page.getByRole('button', { name: 'Add equipment' }).first().click();
  const form = page.getByRole('dialog', { name: 'Add equipment' });
  await form.getByLabel('Name').fill(ITEM);
  await form.getByLabel('Category').selectOption({ label: 'Cardio' });
  await form.getByLabel('Condition').selectOption({ label: 'Fair' });
  await form.getByLabel(/Location/).fill('Cardio floor, row 2');
  await form.getByLabel(/Serial number/).fill('TM-55-0193');
  await form.getByLabel(/Purchase cost/).fill('450,000');
  await form.getByLabel(/Service every/).fill('30');
  await expectNoAxeViolations(page);
  await form.getByRole('button', { name: 'Add equipment' }).click();
  await closeToast(page, new RegExp(`${ITEM} added as EQ-`));
  await settled(page, ITEM);
  await expect(page.getByText('Fair condition', { exact: true })).toBeVisible();
  await expect(page.getByText('No maintenance recorded')).toBeVisible();

  // A repair: the item's condition and next service date follow the latest record.
  await page.getByRole('button', { name: 'Record maintenance' }).first().click();
  const record = page.getByRole('dialog', { name: 'Record maintenance' });
  await record.getByLabel('Type').selectOption({ label: 'Repair' });
  await record
    .getByLabel('What was done')
    .fill('Replaced the running belt and lubricated the deck.');
  await record.getByLabel('Condition afterwards').selectOption({ label: 'Excellent' });
  await record.getByLabel(/Done by/).fill('FitServe Technicians');
  await record.getByLabel(/Cost/).fill('12000');
  await expectNoAxeViolations(page);
  await record.getByRole('button', { name: 'Save record' }).click();
  await closeToast(page, /Maintenance recorded · next due/);
  await expect(page.getByText('Excellent condition', { exact: true })).toBeVisible();
  const history = page.getByRole('list', { name: 'Maintenance history' });
  await expect(history.getByRole('listitem')).toHaveCount(1);
  await expect(history).toContainText('Replaced the running belt');
  await expect(history).toContainText('By FitServe Technicians');
  await expect(history).toContainText('12,000');

  // Out of service needs a reason, shown on the item.
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('menuitem', { name: 'Take out of service' }).click();
  const confirm = page.getByRole('dialog', { name: `Take ${ITEM} out of service?` });
  await confirm.getByLabel(/Reason/).fill('Console display flickers; part ordered');
  await expectNoAxeViolations(page);
  await confirm.getByRole('button', { name: 'Take out of service' }).click();
  await closeToast(page, `${ITEM} taken out of service`);
  await expect(page.getByRole('status').filter({ hasText: 'Out of service.' })).toContainText(
    'part ordered',
  );
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page);

  // Reception sees the register and history, but not costs or any action.
  await page.context().clearCookies();
  await signInAs(page, 'RECEPTIONIST');
  await page.goto('/equipment');
  await settled(page, 'Equipment');
  const row = page
    .getByRole('list', { name: 'Equipment' })
    .getByRole('link', { name: new RegExp(ITEM) });
  await expect(row).toContainText('Out of service');
  await expect(page.getByRole('button', { name: 'Add equipment' })).toHaveCount(0);
  await row.click();
  await settled(page, ITEM);
  await expect(page.getByRole('list', { name: 'Maintenance history' })).toContainText(
    'Replaced the running belt',
  );
  await expect(page.getByRole('main')).not.toContainText('12,000');
  await expect(page.getByRole('main')).not.toContainText('450,000');
  await expect(page.getByRole('button', { name: 'Record maintenance' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change status' })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
