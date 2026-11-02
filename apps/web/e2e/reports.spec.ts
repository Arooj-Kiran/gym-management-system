import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, signInAs } from './helpers';

const CSV_NAME = /^attendance_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/;

test('the receptionist gets attendance reports only, and downloads one as CSV', async ({
  page,
}) => {
  await signInAs(page, 'RECEPTIONIST');
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Reports' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reports');
  await expect(page.getByRole('heading', { level: 2, name: 'Attendance' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible();

  const types = page.getByRole('navigation', { name: 'Report types' }).getByRole('link');
  await expect(types).toHaveText(['Attendance', 'Denied entry attempts']);
  await expectNoAxeViolations(page);

  // A financial report in the URL falls back to one the role may open.
  await page.goto('/reports?type=revenue');
  await expect(page.getByRole('heading', { level: 2, name: 'Attendance' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(CSV_NAME);
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.split(/\r?\n/)[0]).toContain('Member');
  await expect(page.getByText(/^Downloaded attendance_/)).toBeVisible();

  // The server refuses the financial report outright.
  const refused = await page.request.get('/api/v1/reports/revenue');
  expect(refused.status()).toBe(403);
});

test('the manager moves between reports and periods, and the dashboard links to them', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signInAs(page, 'MANAGER');

  const trends = page.getByRole('region', { name: 'Trends' });
  await expect(trends.getByRole('heading', { name: 'Revenue' })).toBeVisible();
  await expect(trends.getByRole('heading', { name: 'Attendance' })).toBeVisible();
  await expect(trends.getByText('Net revenue')).toBeVisible();
  await trends.getByRole('button', { name: '7 days' }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0);
  await expectNoAxeViolations(page);

  await trends.getByRole('link', { name: /Open the reports/ }).click();
  await expect(page).toHaveURL(/\/reports\?from=\d{4}-\d{2}-\d{2}&to=/);
  await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page
    .getByRole('navigation', { name: 'Report types' })
    .getByRole('link', { name: 'Revenue' })
    .click();
  await expect(page.getByRole('heading', { level: 2, name: 'Revenue' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible();
  await expect(page).toHaveURL(/type=revenue/);
  await expect(page).toHaveURL(/from=/);
  await expectNoAxeViolations(page);

  // A backwards period is refused on the page; nothing is downloaded.
  // By role: the "Totals for the period" list also matches the label "To".
  await page.getByRole('textbox', { name: 'From', exact: true }).fill('2026-10-20');
  await page.getByRole('textbox', { name: 'To', exact: true }).fill('2026-10-01');
  await expect(page.getByRole('alert')).toContainText('"To" must be on or after "From"');
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
});
