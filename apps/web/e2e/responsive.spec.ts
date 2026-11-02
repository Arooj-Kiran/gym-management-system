import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  MEMBER,
  signInAs,
  signInAsMember,
  VIEWPORTS,
} from './helpers';

const ADMIN_PAGES = [
  { path: '/', heading: /Good (morning|afternoon|evening)/ },
  { path: '/members', heading: 'Members' },
  { path: '/memberships', heading: 'Memberships' },
  { path: '/memberships?expiring=7', heading: 'Expiring soon' },
  { path: '/plans', heading: 'Membership plans' },
  { path: '/invoices', heading: 'Invoices' },
  { path: '/payments', heading: 'Payments' },
  { path: '/check-in', heading: 'Check-in desk' },
  { path: '/attendance', heading: 'Attendance' },
  { path: '/access-log', heading: 'Access log' },
  { path: '/devices', heading: 'Scanners' },
  { path: '/classes', heading: 'Classes' },
  { path: '/appointments', heading: 'Appointments' },
  { path: '/trainers', heading: 'Trainers' },
  { path: '/shifts', heading: 'Staff shifts' },
  { path: '/exercises', heading: 'Exercise library' },
  { path: '/workout-plans', heading: 'Workout plans' },
  { path: '/workout-assignments', heading: 'Assigned workouts' },
  { path: '/staff', heading: 'Staff' },
  { path: '/equipment', heading: 'Equipment' },
  { path: '/settings', heading: 'Settings' },
  { path: '/notification-channels', heading: 'Notification channels' },
  { path: '/notifications', heading: 'Notifications' },
  { path: '/reports', heading: 'Reports' },
  { path: '/reports?type=revenue&from=2026-01-01&to=2026-10-26', heading: 'Reports' },
  { path: '/reports?type=membership-status', heading: 'Reports' },
  { path: '/audit-log', heading: 'Audit log' },
  { path: '/account', heading: 'My account' },
];

const PORTAL_PAGES = [
  { path: '/portal', heading: 'My profile' },
  { path: '/portal/membership', heading: 'My membership' },
  { path: '/portal/attendance', heading: 'My attendance' },
  { path: '/portal/payments', heading: 'My payments' },
  { path: '/portal/plans', heading: 'Membership plans' },
  { path: '/portal/classes', heading: 'Classes' },
  { path: '/portal/schedule', heading: 'My schedule' },
  { path: '/portal/trainers', heading: 'Trainers' },
  { path: '/portal/workouts', heading: 'My workouts' },
  { path: '/portal/progress', heading: 'My progress' },
  { path: '/notifications', heading: 'Notifications' },
  { path: '/account', heading: 'My account' },
];

const TRAINER_PAGES = [
  { path: '/', heading: /Good (morning|afternoon|evening)/ },
  { path: '/classes', heading: 'Classes' },
  { path: '/appointments', heading: 'Appointments' },
  { path: '/trainers', heading: 'Trainers' },
  { path: '/my-members', heading: 'My members' },
  { path: '/shifts', heading: 'My shifts' },
  { path: '/exercises', heading: 'Exercise library' },
  { path: '/workout-plans', heading: 'Workout plans' },
  { path: '/workout-assignments', heading: 'Assigned workouts' },
  { path: '/equipment', heading: 'Equipment' },
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
      // One test walks every admin screen with an axe scan each; the budget grows with the list.
      test.setTimeout(10_000 * ADMIN_PAGES.length);
      await signInAs(page, 'ADMIN');
      const desktop = viewport.width >= 1024;

      for (const { path, heading } of ADMIN_PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        // Wait for data so skeletons are not what gets scanned.
        await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
        // A load failure must not pass as a rendered screen.
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);

        await expect(page.getByTestId('sidebar')).toBeVisible({ visible: desktop });
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible({
          visible: !desktop,
        });
        // Exactly one notification bell is on screen: in the sidebar or the mobile top bar.
        await expect(page.getByTestId('notification-bell').locator('visible=true')).toHaveCount(1);
        await expectNoAxeViolations(page);
      }
    });

    test('member detail fits and is accessible', async ({ page }) => {
      test.setTimeout(60_000);
      await signInAs(page, 'ADMIN');
      await page.goto('/members');
      const name = `${MEMBER.firstName} ${MEMBER.lastName}`;
      await page.getByRole('link', { name: new RegExp(name) }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
      await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
      // A load failure must not pass as a rendered screen.
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      for (const tab of ['Membership', 'Attendance', 'Payments', 'Workouts']) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible();
        await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
    });

    test('the payment form fits and is accessible', async ({ page }) => {
      test.setTimeout(60_000);
      const charge = `Layout check · ${viewport.width} px`;
      await signInAs(page, 'ADMIN');
      await page.goto('/members');
      const name = `${MEMBER.firstName} ${MEMBER.lastName}`;
      await page.getByRole('link', { name: new RegExp(name) }).click();
      await page.getByRole('tab', { name: 'Payments' }).click();

      await page.getByRole('button', { name: 'New charge' }).click();
      const create = page.getByRole('dialog', { name: 'New charge' });
      await create.getByLabel('Description').fill(charge);
      await create.getByLabel(/Amount/).fill('300');
      await expectNoHorizontalOverflow(page);
      await create.getByRole('button', { name: 'Create invoice' }).click();
      await expect(create).toBeHidden();

      const row = page
        .getByRole('list', { name: 'Invoices' })
        .getByRole('listitem')
        .filter({ hasText: charge });
      await row.getByRole('button', { name: 'Pay' }).click();
      const pay = page.getByRole('dialog', { name: 'Record payment' });
      await expect(pay.getByLabel(/Amount/)).toHaveValue('300');
      await expect(pay.getByRole('button', { name: 'Record payment' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      // Pay it, so the check leaves no open balance behind for later specs.
      await pay.getByRole('button', { name: 'Record payment' }).click();
      await expect(pay).toBeHidden();
      await expect(row.getByText('Paid', { exact: true })).toBeVisible();
    });

    test('member portal screens fit and are accessible', async ({ page }) => {
      test.setTimeout(10_000 * PORTAL_PAGES.length);
      await signInAsMember(page);
      for (const { path, heading } of PORTAL_PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
        // A load failure must not pass as a rendered screen.
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
    });

    test('trainer screens fit and are accessible', async ({ page }) => {
      test.setTimeout(10_000 * TRAINER_PAGES.length);
      await signInAs(page, 'TRAINER');
      for (const { path, heading } of TRAINER_PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
        // A load failure must not pass as a rendered screen.
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
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
