import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, MEMBER, PLAN, signInAs, signInAsMember } from './helpers';

/** A 1×1 PNG: enough for the server's content check, no real photo needed. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('the receptionist registers a member who shares a phone number', async ({ page }) => {
  await signInAs(page, 'RECEPTIONIST');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Members' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Members');

  await page.getByRole('button', { name: 'Register member' }).click();
  const form = page.getByRole('dialog', { name: 'Register a member' });
  await form.getByLabel('First name').fill('Hira');
  await form.getByLabel('Last name').fill('Hussain');
  // Same number as the existing member, typed the way the front desk would.
  await form.getByLabel('Phone', { exact: true }).fill('0300 1110001');
  await form.getByRole('textbox', { name: /^Email/ }).fill('hira.hussain@example.test');

  // The live check warns before saving and links to the existing record.
  await expect(
    form.getByText('This phone number is already used by another member.'),
  ).toBeVisible();
  await expect(
    form.getByRole('link', { name: new RegExp(`${MEMBER.firstName} ${MEMBER.lastName}`) }),
  ).toBeVisible();

  await expectNoAxeViolations(page);

  await form.getByRole('button', { name: 'Register member' }).click();
  const confirm = page.getByRole('dialog', { name: 'Phone number already in use' });
  await expect(confirm).toBeVisible();
  await confirm.getByLabel(/Why is this number shared/).fill('Sisters sharing one phone');
  await confirm.getByRole('button', { name: 'Save anyway' }).click();

  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hira Hussain');
  await expect(page.getByText('Hira Hussain registered')).toBeVisible();

  await page.getByTestId('photo-input').setInputFiles({
    name: 'hira.png',
    mimeType: 'image/png',
    buffer: PIXEL_PNG,
  });
  await expect(page.getByText('Photo updated')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replace photo' })).toBeVisible();

  // The new member is findable from the list.
  await page.goto('/members');
  await page.getByLabel('Search members').fill('Hira');
  await expect(page.getByRole('link', { name: /Hira Hussain/ })).toBeVisible();
});

test('a member sees their own profile and the plans on offer', async ({ page }) => {
  await signInAsMember(page);
  await expect(page.getByText(`${MEMBER.firstName} ${MEMBER.lastName}`).first()).toBeVisible();

  const contact = page.getByRole('form', { name: 'Emergency contact' });
  await contact.getByLabel('Contact name').fill('Imran Hussain');
  await contact.getByLabel('Relation').fill('Brother');
  await contact.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByText('Emergency contact saved')).toBeVisible();
  await page.reload();
  await expect(contact.getByLabel('Contact name')).toHaveValue('Imran Hussain');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Plans' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Membership plans');
  await expect(page.getByText(PLAN.name)).toBeVisible();

  // Staff screens are not part of the portal.
  await page.goto('/members');
  await expect(page).toHaveURL(/\/portal$/);
});

test('an admin creates an off-peak plan with access limits', async ({ page }) => {
  await signInAs(page, 'ADMIN');
  await page.goto('/plans');
  await page.getByRole('button', { name: 'New plan' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New membership plan' });

  await dialog.getByLabel('Plan name').fill('Off-Peak Quarterly');
  await dialog.getByLabel('Plan type').selectOption({ label: 'Quarterly' });
  await expect(dialog.getByText('3 months')).toBeVisible();
  await dialog.getByRole('textbox', { name: /^Price/ }).fill('15000');
  await dialog.getByRole('button', { name: 'Add benefit' }).click();
  await dialog.getByLabel('Benefit 1', { exact: true }).fill('Gym floor before 4 pm');
  await dialog.getByRole('button', { name: 'Sat' }).click();
  await dialog.getByRole('button', { name: 'Sun' }).click();
  await expect(dialog.getByRole('button', { name: 'Sun' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await dialog.getByLabel('From').fill('06:00');
  await dialog.getByLabel('Until').fill('16:00');
  await expectNoAxeViolations(page);

  await dialog.getByRole('button', { name: 'Create plan' }).click();
  await expect(page.getByText('Off-Peak Quarterly created')).toBeVisible();
  await expect(dialog).toBeHidden();
  const row = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'Off-Peak Quarterly' });
  await expect(row).toContainText('Weekdays');
  await expect(row).toContainText('15,000');
});
