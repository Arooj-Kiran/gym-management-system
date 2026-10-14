import { expect, test } from '@playwright/test';
import { FORCED_CHANGE, PASSWORD, signIn, signInAs, USERS } from './helpers';

test('protected pages send signed-out visitors to login and back', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
  await signIn(page, USERS.ADMIN.email);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
});

test('wrong password shows one generic message', async ({ page }) => {
  await signIn(page, USERS.ADMIN.email, 'Definitely-wrong-password');
  await expect(page.getByRole('alert')).toContainText(/email or password/i);
  await expect(page).toHaveURL(/\/login/);
});

test('a new account must replace its temporary password first', async ({ page }) => {
  await signIn(page, FORCED_CHANGE.email);
  await expect(page).toHaveURL(/\/change-password$/);

  // The rest of the app stays closed until the password is changed.
  await page.goto('/account');
  await expect(page).toHaveURL(/\/change-password$/);

  await page.getByLabel('Temporary password').fill(PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill('Mango-orchard-sunrise-42');
  await page.getByLabel('Repeat new password').fill('Mango-orchard-sunrise-42');
  await page.getByRole('button', { name: /set password|change password|continue/i }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(FORCED_CHANGE.firstName);
});

test('navigation and routes follow the role', async ({ page }) => {
  await signInAs(page, 'RECEPTIONIST');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Staff' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);

  await page.goto('/staff');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'You do not have access to this page',
  );
});

test('manager can view settings but not change them', async ({ page }) => {
  await signInAs(page, 'MANAGER');
  await page.goto('/settings');
  await expect(page.getByText('Only an Admin can change them.')).toBeVisible();
  await expect(page.getByLabel('Gym name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(0);
});

test('sign out ends the session', async ({ page }) => {
  await signInAs(page, 'TRAINER');
  await page.goto('/account');
  await page
    .getByRole('button', { name: /account menu|Usman Tariq/i })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login/);
});
