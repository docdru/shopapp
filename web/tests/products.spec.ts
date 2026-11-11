import { expect, test, type Page } from '@playwright/test';
import { ANNA, BEN, addField, diagnostics, entry, login, notNeeded, oneOffAt, visible } from './helpers';

/** An item suggestion in the add field (not a product suggestion). */
const itemOption = (page: Page, name: string) =>
  page.locator('.sugg [role="option"]:not(.product-option)').filter({ hasText: name });

/** A generic list entry (not a specific product). */
const generic = (page: Page, name: string) =>
  page.locator('[data-testid="entry"]:not(.pinned)').filter({ hasText: name });
/** A list entry for a specific product. */
const specific = (page: Page, name: string) =>
  page.locator('[data-testid="entry"].pinned').filter({ hasText: name });

// Specific products of an item: verdicts, stores, prices, and the
// recommendation shown on the list (spec: products, store filter rules).

test.afterEach(() => {
  diagnostics.length = 0;
});

const chip = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Shopping at' }).getByRole('button', { name, exact: true });

async function newItem(page: Page, name: string, category: string) {
  await page.getByRole('link', { name: 'Items' }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Name', { exact: true }).fill(name);
  await sheet.getByLabel('Category').selectOption({ label: category });
  await sheet.getByRole('button', { name: 'Save item' }).click();
  await expect(sheet).toHaveCount(0);
}

/** Fill the open product sheet. offers: store → price ('' = sold, no price) or 'not'. */
async function fillProduct(
  page: Page,
  p: { name: string; qty?: string; unit?: string; verdict: 'Preferred' | 'OK' | "Don't buy"; why?: string },
  offers: Record<string, string>
) {
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading')).toHaveText('New product');
  await sheet.getByLabel('Brand and name').fill(p.name);
  if (p.qty) await sheet.locator('#product-qty').fill(p.qty);
  if (p.unit) await sheet.getByLabel('Pack unit').selectOption({ label: p.unit });
  await sheet.getByRole('group', { name: 'Verdict' }).getByRole('button', { name: p.verdict }).click();
  if (p.why) await sheet.getByLabel('Why not', { exact: true }).fill(p.why);
  for (const [store, value] of Object.entries(offers)) {
    const row = sheet.getByTestId(`offer-${store}`);
    if (value === 'not') {
      await row.getByRole('button', { name: 'Not here' }).click();
    } else {
      const sold = row.getByRole('button', { name: 'Sold here' });
      if ((await sold.getAttribute('aria-pressed')) !== 'true') await sold.click();
      if (value) await sheet.getByLabel(`Price at ${store}`).fill(value);
    }
  }
  await sheet.getByRole('button', { name: 'Add product' }).click();
}

test('add products to an item and get the recommendation on the list', async ({ browser }) => {
  const anna = await login(browser, ANNA);

  // Item with two products: a preferred one at Edeka and Aldi, a don't-buy at Aldi.
  await newItem(anna, 'Coffee beans', 'Pantry');
  await anna.getByTestId('item-Coffee beans').locator('.rowmain').click();
  const itemSheet = anna.getByRole('dialog');
  await expect(itemSheet.getByTestId('products')).toContainText('No specific products yet');
  await itemSheet.getByRole('button', { name: '+ Add product' }).click();
  await fillProduct(
    anna,
    { name: 'Lavazza Crema e Aroma', qty: '1', unit: 'kg', verdict: 'Preferred' },
    { Edeka: '13,95', Aldi: '12.99' }
  );
  // Back on the item sheet, with the product listed.
  const lavazza = itemSheet.getByTestId('product-Lavazza Crema e Aroma');
  await visible(lavazza);
  await expect(lavazza).toContainText('preferred');
  await expect(lavazza).toContainText('recommended');
  await expect(lavazza).toContainText(/Edeka 13,95\s€/);
  await expect(lavazza).toContainText(/Aldi 12,99\s€/);

  await itemSheet.getByRole('button', { name: '+ Add product' }).click();
  await fillProduct(
    anna,
    { name: 'Barista Gold', qty: '1', unit: 'kg', verdict: "Don't buy", why: 'tastes stale' },
    { Aldi: '7,99' }
  );
  await expect(itemSheet.getByTestId('product-Barista Gold')).toContainText("don't buy: tastes stale");
  await itemSheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(anna.getByTestId('item-Coffee beans')).toContainText('2 products');

  // Typing the item also offers its (buyable) products as their own suggestions.
  await anna.getByRole('link', { name: 'List' }).click();
  await addField(anna).fill('coff');
  await expect(anna.getByRole('option', { name: /Lavazza Crema e Aroma/ })).toBeVisible();
  await expect(anna.getByRole('option', { name: /Barista Gold/ })).toHaveCount(0);
  await itemOption(anna, 'Coffee beans').click();
  await expect(anna.getByRole('status')).toContainText('Added Coffee beans');

  // On the list with "All": just the stores, the ones with a preferred
  // product in green and bold (don't-buy product ignored); no product line.
  const row = generic(anna, 'Coffee beans');
  await expect(row.getByTestId('stores')).toHaveText('Edeka · Aldi');
  await expect(row.locator('.pref')).toHaveText(['Edeka', 'Aldi']);
  await expect(row.locator('.hint')).toHaveCount(0);
  await expect(row).not.toContainText('Anna');

  // Live on Ben's phone too.
  const ben = await login(browser, BEN);
  await expect(generic(ben, 'Coffee beans').getByTestId('stores')).toContainText('Aldi');

  // At Edeka: the preferred products sold there, with price.
  await chip(anna, 'Edeka').click();
  await expect(row.locator('.hint')).toHaveText([/Lavazza Crema e Aroma 1 kg · 13,95\s€/]);

  // At dm nobody knows the product: hidden behind "other stores". (The dm
  // chip needs something on the list for dm.)
  await oneOffAt(anna, 'Cotton swabs', 'dm');
  await chip(anna, 'dm').click();
  await expect(row).toHaveCount(0);
  await expect(anna.getByRole('button', { name: /for other stores/ })).toBeVisible();

  // While at Edeka, add a product you're looking at: Edeka is pre-selected.
  await chip(anna, 'Edeka').click();
  await row.locator('.rowmain').click();
  const es = anna.getByRole('dialog');
  await expect(es.getByTestId('hint')).toContainText('Get Lavazza Crema e Aroma');
  await es.getByRole('button', { name: '+ Add product' }).click();
  const ps = anna.getByRole('dialog');
  await expect(ps.getByTestId('offer-Edeka')).toContainText("you're here");
  await expect(ps.getByTestId('offer-Edeka').getByRole('button', { name: 'Sold here' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await fillProduct(anna, { name: 'Edeka Bio Espresso', qty: '500', unit: 'g', verdict: 'OK' }, { Edeka: '6,49' });
  await expect(es.getByTestId('product-Edeka Bio Espresso')).toContainText(/Edeka 6,49\s€/);
  await es.getByRole('button', { name: 'Not needed' }).click();
  await expect(row).toHaveCount(0);
  await chip(anna, 'All').click();
  await notNeeded(anna, 'Cotton swabs');
});

test("only don't-buy products at a store: better elsewhere", async ({ browser }) => {
  const anna = await login(browser, ANNA);
  await newItem(anna, 'Butter', 'Dairy');
  await anna.getByTestId('item-Butter').locator('.rowmain').click();
  await anna.getByRole('dialog').getByRole('button', { name: '+ Add product' }).click();
  await fillProduct(anna, { name: 'Cheap butter', verdict: "Don't buy", why: 'greasy' }, { Aldi: '1,49' });
  await anna.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await anna.getByRole('link', { name: 'List' }).click();
  await addField(anna).fill('Butter');
  await itemOption(anna, 'Butter').click();
  await oneOffAt(anna, 'Ice cubes', 'Aldi');
  await chip(anna, 'Aldi').click();
  const better = anna.getByTestId('better-elsewhere');
  await expect(better).toContainText('Butter');
  await expect(better).toContainText("Only don't-buy products here");

  await chip(anna, 'All').click();
  await notNeeded(anna, 'Ice cubes');
  await entry(anna, 'Butter').locator('.rowmain').click();
  await anna.getByRole('dialog').getByRole('button', { name: 'Not needed' }).click();
  await expect(entry(anna, 'Butter')).toHaveCount(0);
});

test('put a specific product on the list, next to the generic item', async ({ browser }) => {
  // Uses "Coffee beans" and its products from the first test.
  const anna = await login(browser, ANNA);

  // Typing the product's name offers it directly.
  await addField(anna).fill('lav');
  await anna.locator('.product-option').filter({ hasText: 'Lavazza Crema e Aroma' }).click();
  const pinned = specific(anna, 'Lavazza Crema e Aroma');
  await visible(pinned);
  await expect(pinned.getByTestId('item-tag')).toHaveText('Coffee beans');
  // Where it's sold; the cheaper store highlighted.
  await expect(pinned.getByTestId('stores')).toHaveText('Edeka · Aldi');
  await expect(pinned.locator('.pref')).toHaveText(['Aldi']);

  // The generic item can be on the list at the same time.
  await addField(anna).fill('Coffee beans');
  await addField(anna).press('Enter');
  await visible(generic(anna, 'Coffee beans'));
  await expect(specific(anna, 'Lavazza Crema e Aroma')).toHaveCount(1);

  // At dm it isn't sold: hidden. At Edeka: shown with its price there.
  await oneOffAt(anna, 'Cotton swabs', 'dm');
  await chip(anna, 'dm').click();
  await expect(pinned).toHaveCount(0);
  await chip(anna, 'Edeka').click();
  await expect(pinned).toContainText(/13,95\s€/);
  await chip(anna, 'All').click();
  await notNeeded(anna, 'Cotton swabs');

  // Switching the generic entry to that product merges the two.
  await generic(anna, 'Coffee beans').locator('.rowmain').click();
  await anna.getByRole('group', { name: 'Which one' }).getByRole('button', { name: 'Lavazza Crema e Aroma' }).click();
  await expect(generic(anna, 'Coffee beans')).toHaveCount(0);
  await expect(pinned).toContainText('2×');

  // And back to "any".
  await pinned.locator('.rowmain').click();
  await anna.getByRole('group', { name: 'Which one' }).getByRole('button', { name: 'Any' }).click();
  await visible(generic(anna, 'Coffee beans'));
  await expect(specific(anna, 'Lavazza Crema e Aroma')).toHaveCount(0);

  // Tidy up.
  await anna.getByRole('dialog').getByRole('button', { name: 'Not needed' }).click();
  await expect(generic(anna, 'Coffee beans')).toHaveCount(0);
});
