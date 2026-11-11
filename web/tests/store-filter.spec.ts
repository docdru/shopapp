import { expect, test, type Page } from '@playwright/test';
import { ANNA, addField, addViaEnter, diagnostics, entry, login, notNeeded, oneOffAt, visible } from './helpers';

// "Shopping at" store filter on the list (spec: store filter rules).

test.afterEach(() => {
  diagnostics.length = 0;
});

async function newItem(page: Page, name: string, rule?: { store: string; verdict: 'Buy here' | 'Not here'; why?: string }) {
  await page.getByRole('link', { name: 'Items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  if (rule) {
    await sheet.getByTestId(`rule-${rule.store}`).getByRole('button', { name: rule.verdict }).click();
    if (rule.why) await sheet.getByLabel(`Why not at ${rule.store}`).fill(rule.why);
  }
  await sheet.getByRole('button', { name: 'Save item' }).click();
  await expect(sheet).toHaveCount(0);
}

async function addKnown(page: Page, name: string) {
  await addField(page).fill(name);
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
  await visible(entry(page, name));
}

function chip(page: Page, name: string) {
  return page.getByRole('group', { name: 'Shopping at' }).getByRole('button', { name, exact: true });
}

test('filter the list by store', async ({ browser }) => {
  const anna = await login(browser, ANNA);

  await newItem(anna, 'Rye bread', { store: 'Aldi', verdict: 'Not here', why: "kids don't like it" });
  await newItem(anna, 'Shampoo', { store: 'dm', verdict: 'Buy here' });
  await newItem(anna, 'Apples');
  await newItem(anna, 'Rice drink', { store: 'Aldi', verdict: 'Buy here' });

  await anna.getByRole('link', { name: 'List' }).click();
  for (const name of ['Rye bread', 'Shampoo', 'Apples', 'Rice drink']) await addKnown(anna, name);
  await addViaEnter(anna, 'Birthday balloons');
  await visible(entry(anna, 'Birthday balloons'));

  // Chips only for stores with something on the list, plus Other.
  for (const name of ['All', 'dm', 'Aldi', 'Other']) await visible(chip(anna, name));
  await expect(chip(anna, 'Weekly market')).toHaveCount(0);

  // At Aldi: oat milk is here; rye bread is "better elsewhere" with the
  // reason; shampoo (dm only) is hidden behind "more items for other stores";
  // apples and the one-off (no clear store) are listed below, separately.
  await chip(anna, 'Aldi').click();
  await expect(chip(anna, 'Aldi')).toHaveAttribute('aria-pressed', 'true');
  const better = anna.getByTestId('better-elsewhere');
  await expect(better).toContainText('Rye bread');
  await expect(better).toContainText("Not here: kids don't like it");
  await expect(entry(anna, 'Shampoo')).toHaveCount(0);
  await visible(entry(anna, 'Rice drink'));
  await expect(anna.getByTestId('no-clear-store').getByTestId('entry')).toHaveText([/Apples/, /Birthday balloons/]);
  await expect(anna.getByRole('button', { name: /for other stores\. Show all/ })).toBeVisible();

  // The choice is remembered on this device.
  await anna.reload();
  await expect(chip(anna, 'Aldi')).toHaveAttribute('aria-pressed', 'true');

  // "Show all" switches back to All.
  await anna.getByRole('button', { name: /for other stores\. Show all/ }).click();
  await expect(chip(anna, 'All')).toHaveAttribute('aria-pressed', 'true');
  await visible(entry(anna, 'Shampoo'));

  // At dm: shampoo is here; bread has no rule for dm, so it's here too.
  await chip(anna, 'dm').click();
  await visible(entry(anna, 'Shampoo'));
  await visible(entry(anna, 'Rye bread'));
  await expect(anna.getByTestId('better-elsewhere')).toHaveCount(0);

  // Buying while filtered records the store in the log.
  await entry(anna, 'Shampoo').getByRole('button', { name: 'Bought' }).click();
  await anna.getByRole('link', { name: 'Log' }).click();
  await expect(
    anna.getByTestId('event').filter({ hasText: 'bought' }).filter({ hasText: 'Shampoo' }).first()
  ).toContainText('at dm');

  // Tidy up.
  await anna.getByRole('link', { name: 'List' }).click();
  await chip(anna, 'All').click();
  await anna.getByRole('button', { name: 'Clear cart' }).click();
  for (const name of ['Rye bread', 'Apples', 'Rice drink', 'Birthday balloons']) await notNeeded(anna, name);
});

test('Other filter and a Buy at store for one-offs', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  await newItem(anna, 'Dish soap', { store: 'dm', verdict: 'Buy here' });
  await newItem(anna, 'Pears');
  await anna.getByRole('link', { name: 'List' }).click();
  await addKnown(anna, 'Dish soap');
  await addKnown(anna, 'Pears');
  await addViaEnter(anna, 'Party hats');
  await visible(entry(anna, 'Party hats'));

  // Other: everything without a clear store.
  await chip(anna, 'Other').click();
  await visible(entry(anna, 'Pears'));
  await visible(entry(anna, 'Party hats'));
  await expect(entry(anna, 'Dish soap')).toHaveCount(0);
  await expect(anna.getByRole('button', { name: /more items? (is|are) for other stores/ })).toBeVisible();

  // Buy at Weekly market (nothing else there): leaves Other, and the
  // store gets a chip.
  await expect(chip(anna, 'Weekly market')).toHaveCount(0);
  await entry(anna, 'Party hats').locator('.rowmain').click();
  const sheet = anna.getByRole('dialog');
  await expect(sheet).toContainText('No store: under Other, and at every store.');
  await sheet.getByRole('group', { name: 'Buy at' }).getByRole('button', { name: 'Weekly market', exact: true }).click();
  await expect(sheet).toContainText('Only shown at Weekly market.');
  await anna.keyboard.press('Escape');
  await expect(entry(anna, 'Party hats')).toHaveCount(0);

  // With All: its store in green; at Weekly market it's listed, at dm hidden.
  await chip(anna, 'All').click();
  await expect(entry(anna, 'Party hats').locator('.pref')).toHaveText('Weekly market');
  await chip(anna, 'Weekly market').click();
  await visible(entry(anna, 'Party hats'));
  await expect(anna.getByTestId('no-clear-store')).toContainText('Pears');
  await chip(anna, 'dm').click();
  await expect(entry(anna, 'Party hats')).toHaveCount(0);

  // Nothing left for Weekly market: its chip goes away again.
  await chip(anna, 'All').click();
  for (const name of ['Pears', 'Dish soap', 'Party hats']) await notNeeded(anna, name);
  await expect(chip(anna, 'Weekly market')).toHaveCount(0);
});

test('+ New store from the one-off and item sheets', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  await anna.getByRole('link', { name: 'List' }).click();
  await addViaEnter(anna, 'Picture hooks');

  // One-off: the store sheet replaces the entry sheet, then the new store is
  // its Buy at store.
  await entry(anna, 'Picture hooks').locator('.rowmain').click();
  const sheet = anna.getByRole('dialog');
  await sheet.getByLabel('Note').fill('the small ones');
  await sheet.getByRole('button', { name: '+ New store' }).click();
  await expect(sheet.getByRole('heading')).toHaveText('New store');
  await sheet.getByLabel('Name').fill('Hardware store');
  await sheet.getByRole('button', { name: 'Add store' }).click();
  await expect(sheet).toContainText('Only shown at Hardware store.');
  await expect(sheet.getByLabel('Note')).toHaveValue('the small ones');
  await expect(
    sheet.getByRole('group', { name: 'Buy at' }).getByRole('button', { name: 'Hardware store' })
  ).toHaveAttribute('aria-pressed', 'true');
  await anna.keyboard.press('Escape');
  await visible(chip(anna, 'Hardware store'));

  // Item: the draft stays, and the new store starts as Buy here.
  await anna.getByRole('link', { name: 'Items' }).click();
  await anna.getByRole('button', { name: '+ New item' }).click();
  const item = anna.getByRole('dialog');
  await item.getByLabel('Name', { exact: true }).fill('Wall plugs');
  await item.getByRole('button', { name: '+ New store' }).click();
  await item.getByLabel('Name').fill('Garden centre');
  await item.getByRole('button', { name: 'Add store' }).click();
  await expect(item.getByLabel('Name', { exact: true })).toHaveValue('Wall plugs');
  await expect(item.getByTestId('rule-Garden centre').getByRole('button', { name: 'Buy here' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  // Cancel in the store sheet goes back to the item, nothing added.
  await item.getByRole('button', { name: '+ New store' }).click();
  await item.getByRole('button', { name: 'Cancel' }).click();
  await expect(item.getByLabel('Name', { exact: true })).toHaveValue('Wall plugs');
  await item.getByRole('button', { name: 'Save item' }).click();
  await expect(anna.getByTestId('item-Wall plugs')).toContainText('Buy at Garden centre');

  // Tidy up: the one-off, and both stores.
  await anna.getByRole('link', { name: 'List' }).click();
  await notNeeded(anna, 'Picture hooks');
  for (const name of ['Hardware store', 'Garden centre']) {
    await anna.getByRole('button', { name: 'Account' }).click();
    await anna.getByRole('dialog').getByRole('button', { name: 'Stores & categories' }).click();
    await anna.getByTestId(`store-${name}`).locator('.rowmain').click();
    await anna.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await anna.getByRole('dialog').getByRole('button', { name: 'Tap again to delete' }).click();
    await expect(anna.getByTestId(`store-${name}`)).toHaveCount(0);
    await anna.getByRole('link', { name: 'List', exact: true }).click();
  }
});

test('store pickers show the five most used stores, the rest on demand', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  const settings = async () => {
    await anna.getByRole('button', { name: 'Account' }).click();
    await anna.getByRole('dialog').getByRole('button', { name: 'Stores & categories' }).click();
  };
  // Two unused stores: six in all, so one is hidden.
  await settings();
  for (const name of ['Corner shop', 'Kiosk']) {
    await anna.getByRole('button', { name: '+ Add store' }).click();
    await anna.getByRole('dialog').getByLabel('Name').fill(name);
    await anna.getByRole('dialog').getByRole('button', { name: 'Add store' }).click();
    await visible(anna.getByTestId(`store-${name}`));
  }

  // Item sheet: unused stores last; Kiosk behind "Show 1 more store".
  await anna.getByRole('link', { name: 'Items' }).click();
  await anna.getByRole('button', { name: '+ New item' }).click();
  const item = anna.getByRole('dialog');
  await expect(item.locator('.rule')).toHaveCount(5);
  await expect(item.getByTestId('rule-Kiosk')).toHaveCount(0);
  await item.getByRole('button', { name: 'Show 1 more store' }).click();
  await item.getByTestId('rule-Kiosk').getByRole('button', { name: 'Buy here' }).click();
  // A store set in the sheet stays visible when collapsed again.
  await item.getByRole('button', { name: 'Show fewer stores' }).click();
  await visible(item.getByTestId('rule-Kiosk'));
  await anna.keyboard.press('Escape');

  // One-off: top five chips, the rest behind More….
  await anna.getByRole('link', { name: 'List', exact: true }).click();
  await addViaEnter(anna, 'Stamps');
  await entry(anna, 'Stamps').locator('.rowmain').click();
  const buyAt = anna.getByRole('dialog').getByRole('group', { name: 'Buy at' });
  await expect(buyAt.getByRole('button', { name: 'Kiosk' })).toHaveCount(0);
  await buyAt.getByRole('button', { name: 'More…' }).click();
  await buyAt.getByRole('button', { name: 'Kiosk' }).click();
  await expect(anna.getByRole('dialog')).toContainText('Only shown at Kiosk.');
  await buyAt.getByRole('button', { name: 'Fewer' }).click();
  await expect(buyAt.getByRole('button', { name: 'Kiosk' })).toHaveAttribute('aria-pressed', 'true');
  await anna.keyboard.press('Escape');
  await notNeeded(anna, 'Stamps');

  // Tidy up.
  for (const name of ['Corner shop', 'Kiosk']) {
    await settings();
    await anna.getByTestId(`store-${name}`).locator('.rowmain').click();
    await anna.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await anna.getByRole('dialog').getByRole('button', { name: 'Tap again to delete' }).click();
    await expect(anna.getByTestId(`store-${name}`)).toHaveCount(0);
    await anna.getByRole('link', { name: 'List', exact: true }).click();
  }
});
