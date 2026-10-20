import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import fixtures from './users.json' with { type: 'json' };

export type FixtureRole = keyof typeof fixtures.users;
export const PASSWORD = fixtures.password;
export const USERS = fixtures.users;
export const FORCED_CHANGE = fixtures.forcedChange;
/** A member with a portal login; their phone is reused to trigger the duplicate-phone warning. */
export const MEMBER = fixtures.member;
/** A member with a portal login used only by the entrance (access) flow. */
export const ACCESS_MEMBER = fixtures.accessMember;
export const PLAN = fixtures.plan;

export const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await submitSignInForm(page, email, password);
}

/** Fill in the sign-in form already on screen (keeps the URL, e.g. its `?next=`). */
export async function submitSignInForm(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAs(page: Page, role: FixtureRole) {
  await signIn(page, USERS[role].email);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(USERS[role].firstName);
}

/** Members land on their portal profile. */
export async function signInAsMember(page: Page) {
  await signIn(page, MEMBER.email);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My profile');
}

/** The page must never scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

/** WCAG 2.1 A/AA scan of the current page. */
export async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary).toEqual([]);
}
