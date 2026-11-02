import { expect, test, type Page } from '@playwright/test';
import { CLASS_MEMBER, MEMBER, signInAs } from './helpers';

const CLASS_MEMBER_NAME = `${CLASS_MEMBER.firstName} ${CLASS_MEMBER.lastName}`;
const MEMBER_NAME = `${MEMBER.firstName} ${MEMBER.lastName}`;

async function closeToast(page: Page, text: string) {
  const toast = page.getByRole('listitem').filter({ hasText: text });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(toast).toBeHidden();
}

test('fast search checks in an eligible member and explains a denied member', async ({ page }) => {
  await signInAs(page, 'RECEPTIONIST');
  await page.goto('/check-in');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check-in desk');

  const search = page.getByRole('combobox', {
    name: 'Search members by name, phone, or member code',
  });
  await search.fill(CLASS_MEMBER.phone);
  const eligible = page.getByRole('option').filter({ hasText: CLASS_MEMBER_NAME });
  await expect(eligible).toContainText(CLASS_MEMBER.phone);
  await expect(eligible).toContainText('Active');
  // Enter submits the highlighted result, keeping the flow keyboard-friendly.
  await search.press('Enter');
  await closeToast(page, `${CLASS_MEMBER_NAME} checked in`);
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();

  await page.goto(`/attendance?q=${encodeURIComponent(CLASS_MEMBER.lastName)}`);
  const attendance = page.getByRole('list', { name: 'Check-ins' });
  const checkIn = attendance.getByRole('listitem').filter({ hasText: CLASS_MEMBER_NAME });
  await expect(checkIn).toContainText('Manual');

  await page.goto(`/access-log?q=${encodeURIComponent(CLASS_MEMBER.lastName)}`);
  const attempts = page.getByRole('list', { name: 'Access attempts' });
  const grantedAttempt = attempts.getByRole('listitem').filter({ hasText: CLASS_MEMBER_NAME });
  await expect(grantedAttempt).toContainText('Granted');
  await expect(grantedAttempt).toContainText('Manual');

  await page.goto('/check-in');
  await search.fill(MEMBER.phone);
  const ineligible = page.getByRole('option').filter({ hasText: MEMBER_NAME });
  await expect(ineligible).toContainText(MEMBER.phone);
  await expect(ineligible).toContainText('No membership');
  await ineligible.click();
  await expect(page.getByRole('alert')).toContainText('Access denied. No membership');
  await expect(search).toHaveValue(MEMBER.phone);
});
