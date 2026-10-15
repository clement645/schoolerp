import { expect, test } from '@playwright/test';
import {
  failOnBrowserErrors,
  PASSWORD,
  provisionSchool,
  signIn,
  type School,
} from '../support/school';

let school: School;
test.beforeAll(async () => {
  school = await provisionSchool();
});

test('signing in, staying signed in, and signing out', async ({ page }) => {
  const problems = failOnBrowserErrors(page);

  // A protected page sends a visitor to sign in, and back afterwards.
  await page.goto('/students');
  await expect(page).toHaveURL(/\/login\?redirect=/);

  await page.getByLabel('Email address').fill(school.admin);
  await page.locator('input[type="password"]').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText(/incorrect|invalid/i);
  await expect(page).toHaveURL(/\/login/);

  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/students$/);
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible();

  // The session survives a reload: the access token lives in memory only and
  // is renewed from the HttpOnly refresh cookie.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Students', level: 1 })).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);

  await page.getByRole('button', { name: /Grace Head/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/students');
  await expect(page).toHaveURL(/\/login/);
  expect(problems).toEqual([]);
});

test('a new user must replace their temporary password before anything else', async ({ page }) => {
  const email = `clerk-${Date.now()}@test.example`;
  await school.api.post('/users', {
    email,
    firstName: 'Carol',
    lastName: 'Clerk',
    temporaryPassword: 'temporary-passphrase-9',
    roles: ['ACCOUNTANT'],
  });

  await signIn(page, email, 'temporary-passphrase-9');
  await expect(page).toHaveURL(/\/set-password/);
  // Nothing else is reachable until the password is changed.
  await page.goto('/finance/invoices');
  await expect(page).toHaveURL(/\/set-password/);

  await page.getByLabel(/^Current password/).fill('temporary-passphrase-9');
  await page.getByLabel(/^New password/).fill('a-brand-new-passphrase');
  await page.getByLabel(/^Confirm new password/).fill('a-brand-new-passphrase');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // An accountant sees finance but not, say, user administration.
  await page.goto('/finance/invoices');
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await page.goto('/users');
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});
