import { expect, test, type Page } from '@playwright/test';
import { ANNA, BEN, addField, diagnostics, entry, login, visible } from './helpers';

// Items, stock and log, following the add-item flow and stock rules in
// docs/spec.md. Runs before smoke.spec.ts (one worker, alphabetical).

test.afterEach(() => {
  diagnostics.length = 0;
});

async function tab(page: Page, name: 'List' | 'Stock' | 'Items' | 'Log') {
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name }).click();
}

test('create an item, run out of it, buy it again', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  const ben = await login(browser, BEN);

  // Items: create Detergent, tracked, not at Aldi.
  await tab(anna, 'Items');
  await anna.getByRole('button', { name: '+ New item' }).click();
  const sheet = anna.getByRole('dialog');
  await sheet.getByLabel('Name', { exact: true }).fill('Detergent');
  await sheet.getByLabel('Other names').fill('Waschmittel');
  await sheet.getByLabel('Category').selectOption({ label: 'Cleaning' });
  await sheet.getByLabel('Keep in stock at home').check();
  await sheet.getByTestId('rule-dm').getByRole('button', { name: 'Buy here' }).click();
  await sheet.getByTestId('rule-Aldi').getByRole('button', { name: 'Not here' }).click();
  await sheet.getByLabel('Why not at Aldi').fill('smells odd');
  await sheet.getByRole('button', { name: 'Save item' }).click();
  await expect(sheet).toHaveCount(0);

  const row = anna.getByTestId('item-Detergent');
  await visible(row);
  await expect(row).toContainText('Buy at dm');
  await expect(row).toContainText('not Aldi');
  await expect(row).toContainText('stock ok');

  // Stock: "Out" puts it on the list, also on Ben's phone.
  await tab(anna, 'Stock');
  const stockRow = anna.getByTestId('stock-Detergent');
  await stockRow.getByRole('button', { name: 'Out' }).click();
  await expect(anna.getByRole('status')).toContainText('added to the list');
  await expect(stockRow.getByRole('button', { name: 'Out' })).toHaveAttribute('aria-pressed', 'true');

  const benRow = entry(ben, 'Detergent');
  await visible(benRow);
  await expect(benRow).toContainText('from stock');
  await expect(benRow).toContainText('not Aldi');

  // Search by alias finds it; adding again bumps the quantity instead of a duplicate.
  await addField(ben).fill('wasch');
  await ben.getByRole('option', { name: /Detergent/ }).click();
  await expect(entry(ben, 'Detergent')).toHaveCount(1);
  await expect(entry(ben, 'Detergent')).toContainText('2×');

  // Ben buys it: Anna's stock goes back to OK.
  await benRow.getByRole('button', { name: 'Bought' }).click();
  await expect(stockRow.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-pressed', 'true');

  // Log shows who did what.
  await tab(anna, 'Log');
  const log = anna.getByTestId('event');
  await expect(log.filter({ hasText: 'used up' }).filter({ hasText: 'Detergent' }).first()).toContainText('Anna');
  await expect(log.filter({ hasText: 'bought' }).filter({ hasText: 'Detergent' }).first()).toContainText('Ben');
  await expect(log.filter({ hasText: 'created' }).filter({ hasText: 'Detergent' }).first()).toBeVisible();

  // Clean up the cart for the next tests.
  await tab(ben, 'List');
  await ben.getByRole('button', { name: 'Clear cart' }).click();
});

test('unknown text: save as an item, or add once and convert later', async ({ browser }) => {
  const anna = await login(browser, ANNA);

  // Save as an item → item sheet prefilled → saved and on the list.
  await addField(anna).fill('Toothpaste');
  await anna.getByRole('option', { name: 'Save “Toothpaste” as an item…' }).click();
  const sheet = anna.getByRole('dialog');
  await expect(sheet.getByLabel('Name', { exact: true })).toHaveValue('Toothpaste');
  await sheet.getByLabel('Category').selectOption({ label: 'Drugstore' });
  await sheet.getByRole('button', { name: 'Save and add to list' }).click();
  const tp = entry(anna, 'Toothpaste');
  await visible(tp);
  await expect(tp).not.toContainText('one-off');

  // A one-off, edited in its sheet (quantity, unit, note), then saved as an item.
  await addField(anna).fill('Party cups');
  await anna.getByRole('option', { name: 'Add “Party cups” just this once' }).click();
  const cups = entry(anna, 'Party cups');
  await visible(cups);
  await expect(cups).toContainText('one-off');

  await cups.locator('.rowmain').click();
  const es = anna.getByRole('dialog');
  await es.getByRole('button', { name: 'More' }).click();
  await es.getByRole('group', { name: 'Unit' }).getByRole('button', { name: 'pack' }).click();
  await es.getByLabel('Note').fill('the big ones');
  await es.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(cups).toContainText('2 pk');
  await expect(cups).toContainText('the big ones');

  await cups.locator('.rowmain').click();
  await anna.getByRole('dialog').getByRole('button', { name: 'Save as an item for the future' }).click();
  await anna.getByRole('dialog').getByRole('button', { name: 'Save item' }).click();
  await expect(cups).not.toContainText('one-off');

  // Tidy up: both entries "not needed".
  for (const name of ['Toothpaste', 'Party cups']) {
    await entry(anna, name).locator('.rowmain').click();
    await anna.getByRole('dialog').getByRole('button', { name: 'Not needed' }).click();
    await expect(entry(anna, name)).toHaveCount(0);
  }
});
