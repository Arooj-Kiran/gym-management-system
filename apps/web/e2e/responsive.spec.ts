import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow, signInAs, VIEWPORTS } from './helpers';

const ADMIN_PAGES = [
  { path: '/', heading: /Good (morning|afternoon|evening)/ },
  { path: '/staff', heading: 'Staff' },
  { path: '/settings', heading: 'Settings' },
  { path: '/audit-log', heading: 'Audit log' },
  { path: '/account', heading: 'My account' },
];

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('login page fits and is accessible', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    });

    test('admin screens fit, use the right navigation and are accessible', async ({ page }) => {
      await signInAs(page, 'ADMIN');
      const desktop = viewport.width >= 1024;

      for (const { path, heading } of ADMIN_PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        // Wait for data so skeletons are not what gets scanned.
        await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);

        await expect(page.getByTestId('sidebar')).toBeVisible({ visible: desktop });
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible({
          visible: !desktop,
        });
        await expectNoAxeViolations(page);
      }
    });

    if (viewport.width < 1024) {
      test('drawer opens, navigates and closes', async ({ page }) => {
        await signInAs(page, 'ADMIN');
        await page.getByRole('button', { name: 'Open navigation' }).click();
        const drawer = page.getByTestId('nav-drawer');
        await expect(drawer).toBeVisible();
        await expectNoAxeViolations(page);

        await drawer.getByRole('link', { name: 'Staff' }).click();
        await expect(page).toHaveURL(/\/staff$/);
        await expect(drawer).toBeHidden();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff');

        await page.getByRole('button', { name: 'Open navigation' }).click();
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
      });
    }
  });
}
