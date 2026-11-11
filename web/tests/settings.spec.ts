import { expect, test, type Page } from '@playwright/test';
import { ANNA, BEN, diagnostics, login, visible } from './helpers';

// Stores & categories screen (Account → Stores & categories). Creates and
// deletes its own store and category; leaves the seeded ones alone.

test.afterEach(() => {
  diagnostics.length = 0;
});

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Stores & categories' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Stores & categories');
}

function storeNames(page: Page) {
  return page.getByTestId('stores').locator('.row .name').allTextContents();
}

test('add, reorder, rename and delete a store', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  const ben = await login(browser, BEN);
  await openSettings(anna);
  await openSettings(ben);

  // Add: appears last, also on Ben's screen.
  await anna.getByRole('button', { name: '+ Add store' }).click();
  const sheet = anna.getByRole('dialog');
  await sheet.getByLabel('Name').fill('Rewe');
  await sheet.getByLabel('Type').fill('supermarket');
  await sheet.getByRole('button', { name: 'Add store' }).click();
  await visible(anna.getByTestId('store-Rewe'));
  await visible(ben.getByTestId('store-Rewe'));
  expect((await storeNames(anna)).at(-1)).toBe('Rewe');

  // Duplicate names are refused.
  await anna.getByRole('button', { name: '+ Add store' }).click();
  await anna.getByRole('dialog').getByLabel('Name').fill('rewe');
  await anna.getByRole('dialog').getByRole('button', { name: 'Add store' }).click();
  await expect(anna.getByRole('status')).toContainText('already a store called Rewe');
  await anna.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // Move up one place.
  const before = await storeNames(anna);
  await anna.getByRole('button', { name: 'Move Rewe up' }).click();
  await expect
    .poll(() => storeNames(anna))
    .toEqual([...before.slice(0, -2), 'Rewe', before.at(-2)!]);

  // Rename.
  await anna.getByTestId('store-Rewe').locator('.rowmain').click();
  await anna.getByRole('dialog').getByLabel('Name').fill('Rewe City');
  await anna.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await visible(anna.getByTestId('store-Rewe City'));

  // Use it in an item rule, then delete the store: the warning names the rule.
  await anna.getByRole('link', { name: 'Items' }).click();
  await anna.getByRole('button', { name: '+ New item' }).click();
  const item = anna.getByRole('dialog');
  await item.getByLabel('Name', { exact: true }).fill('Oat milk');
  await item.getByTestId('rule-Rewe City').getByRole('button', { name: 'Buy here' }).click();
  await item.getByRole('button', { name: 'Save item' }).click();
  await expect(anna.getByTestId('item-Oat milk')).toContainText('Buy at Rewe City');

  await openSettings(anna);
  await anna.getByTestId('store-Rewe City').locator('.rowmain').click();
  const del = anna.getByRole('dialog');
  await del.getByRole('button', { name: 'Delete' }).click();
  await expect(del.getByRole('alert')).toContainText('rules on 1 item go with it');
  await del.getByRole('button', { name: 'Tap again to delete' }).click();
  await expect(anna.getByTestId('store-Rewe City')).toHaveCount(0);
  await expect(ben.getByTestId('store-Rewe City')).toHaveCount(0);

  await anna.getByRole('link', { name: 'Items' }).click();
  await expect(anna.getByTestId('item-Oat milk')).toContainText('any store');
});

test('add a category, move it to the top, delete it: its items go to Other', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  await openSettings(anna);

  await anna.getByRole('button', { name: '+ Add category' }).click();
  await anna.getByRole('dialog').getByLabel('Name').fill('Frozen');
  await anna.getByRole('dialog').getByRole('button', { name: 'Add category' }).click();
  await visible(anna.getByTestId('category-Frozen'));

  // Move it all the way up, one step at a time.
  const categoryNames = () => anna.getByTestId('categories').locator('.row .name').allTextContents();
  const steps = (await categoryNames()).indexOf('Frozen');
  const up = anna.getByRole('button', { name: 'Move Frozen up' });
  for (let k = 0; k < steps; k++) {
    await expect(up).toBeEnabled();
    await up.click();
  }
  await expect(up).toBeDisabled();
  await expect
    .poll(async () => (await anna.getByTestId('categories').locator('.row .name').allTextContents())[0])
    .toBe('Frozen');

  // An item in it, then delete the category.
  await anna.getByRole('link', { name: 'Items' }).click();
  await anna.getByRole('button', { name: '+ New item' }).click();
  await anna.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Ice cream');
  await anna.getByRole('dialog').getByLabel('Category').selectOption({ label: 'Frozen' });
  await anna.getByRole('dialog').getByRole('button', { name: 'Save item' }).click();
  await expect(anna.getByTestId('group-Frozen')).toContainText('Ice cream');

  await openSettings(anna);
  await anna.getByTestId('category-Frozen').locator('.rowmain').click();
  await anna.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(anna.getByRole('dialog').getByRole('alert')).toContainText('1 item move to “Other”');
  await anna.getByRole('dialog').getByRole('button', { name: 'Tap again to delete' }).click();
  await expect(anna.getByTestId('category-Frozen')).toHaveCount(0);

  await anna.getByRole('link', { name: 'Items' }).click();
  await expect(anna.getByTestId('group-Other')).toContainText('Ice cream');
});
