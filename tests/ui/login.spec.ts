import { test, expect } from '@playwright/test';
import { uniqueSuffix } from '../../src/api';
import { config } from '../../src/config';

// The only UI test in this repo (see README: the frontend is not integrated with the
// new group pre-order endpoints yet, so the scenarios themselves are covered on API level).
test('@smoke customer can sign in through the UI and lands on the main page', async ({ page, request }) => {
  test.skip(!config.uiUrl, 'UI_URL is not set');

  // prepare the account through the API: faster and does not depend on the sign-up form
  const email = `qa.ui.${uniqueSuffix()}@example.com`;
  const password = 'Qa!Passw0rd-2026';
  const reg = await request.post(`${config.apiUrl}/register`, {
    data: { firstName: 'Qa', lastName: 'Ui', email, password, confirmPassword: password },
  });
  expect(reg.status()).toBe(200);

  await page.goto('/login');
  await page.getByPlaceholder('e.g. username@domain.com').fill(email);
  await page.locator('input[formcontrolname="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/\/main/);
});
