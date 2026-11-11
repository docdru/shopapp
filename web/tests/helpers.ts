import { expect, type Browser, type Locator, type Page } from '@playwright/test';

// Shared helpers for the e2e tests.

// Two family members, same household (created by the CI setup script).
export const ANNA = { email: 'anna@example.com', password: 'test-password-1' };
export const BEN = { email: 'ben@example.com', password: 'test-password-2' };
export const CARLA = { email: 'carla@example.com', password: 'test-password-3' };

// Browser console errors and failed API calls, appended to failures so CI
// annotations show what went wrong.
export const diagnostics: string[] = [];

export function watch(page: Page, who: string) {
  page.on('console', (m) => {
    if (m.type() === 'error') diagnostics.push(`[${who}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => diagnostics.push(`[${who}] pageerror: ${e.message}`));
  page.on('response', async (r) => {
    if (!r.url().includes('/api/')) return;
    const body = r.status() >= 400 ? await r.text().catch(() => '') : '';
    diagnostics.push(`[${who}] ${r.request().method()} ${r.url()} -> ${r.status()} ${body}`);
  });
  page.on('requestfailed', (r) => diagnostics.push(`[${who}] FAILED ${r.url()} ${r.failure()?.errorText}`));
}

/** Like expect(...).toBeVisible(), but failures include the diagnostics. */
export async function visible(locator: Locator) {
  try {
    await expect(locator).toBeVisible();
  } catch (err) {
    const text = await locator.page().locator('body').innerText().catch(() => '?');
    throw new Error(
      `${(err as Error).message}\n--- page ---\n${text}\n--- diagnostics ---\n${diagnostics.join('\n')}`
    );
  }
}

export async function login(browser: Browser, who: typeof ANNA): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  watch(page, who.email);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(addField(page)).toBeVisible();
  return page;
}

export function addField(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Add item' });
}

/** Type into the add field and press Enter. */
export async function addViaEnter(page: Page, text: string) {
  await addField(page).fill(text);
  await addField(page).press('Enter');
}

export function entry(page: Page, name: string): Locator {
  return page.getByTestId('entry').filter({ hasText: name });
}

/** Add a one-off and set its Buy at store in the entry sheet. */
export async function oneOffAt(page: Page, label: string, store: string) {
  await addViaEnter(page, label);
  await entry(page, label).locator('.rowmain').click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('group', { name: 'Buy at' }).getByRole('button', { name: store, exact: true }).click();
  await expect(sheet).toContainText(`Only shown at ${store}.`);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
}

/** Remove an entry with Not needed. */
export async function notNeeded(page: Page, label: string) {
  await entry(page, label).first().locator('.rowmain').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Not needed' }).click();
  await expect(entry(page, label)).toHaveCount(0);
}
