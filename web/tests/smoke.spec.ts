import { expect, test } from '@playwright/test';
import { ANNA, BEN, addViaEnter, diagnostics, entry, login, visible } from './helpers';

test.afterEach(() => {
  diagnostics.length = 0;
});

test('wrong password shows an error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ANNA.email);
  await page.getByLabel('Password').fill('nope-nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Login failed');
});

test('list syncs live between two family members', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  const ben = await login(browser, BEN);

  // Anna adds a one-off item; Ben sees it without reloading.
  await addViaEnter(anna, 'Birthday candles');
  const annaRow = entry(anna, 'Birthday candles');
  await visible(annaRow);
  const benRow = entry(ben, 'Birthday candles');
  await visible(benRow);

  // Ben buys it; it moves to the cart for both.
  await benRow.getByRole('button', { name: 'Bought' }).click();
  await expect(anna.getByTestId('cart-entry').filter({ hasText: 'Birthday candles' })).toBeVisible();
  await expect(annaRow).toHaveCount(0);

  // Undo puts it back on the list; Not needed (in the entry sheet) removes it.
  await anna.getByTestId('cart-entry').filter({ hasText: 'Birthday candles' }).getByRole('button', { name: 'Undo' }).click();
  await visible(benRow);
  await benRow.locator('.rowmain').click();
  await ben.getByRole('dialog').getByRole('button', { name: 'Not needed' }).click();
  await expect(annaRow).toHaveCount(0);
  await expect(benRow).toHaveCount(0);
});

test('the app is installable (manifest + service worker)', async ({ page }) => {
  const res = await page.request.get('/manifest.webmanifest');
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).display).toBe('standalone');
  await page.goto('/login');
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active?.scriptURL ?? '';
  });
  expect(sw).toContain('service-worker');
});

test('a Content-Security-Policy is active and nothing violates it', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  const csp = await page.locator('meta[http-equiv="content-security-policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(violations).toEqual([]);
});
