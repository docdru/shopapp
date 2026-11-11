import { expect, test, type Locator, type Page } from '@playwright/test';
import { ANNA, BEN, addField, diagnostics, login, visible } from './helpers';

// Product photos (spec: Products and prices): taken in the product sheet,
// shrunk on the phone, shown on the list, protected on the server.

test.afterEach(() => {
  diagnostics.length = 0;
});

const specific = (page: Page, name: string) =>
  page.locator('[data-testid="entry"].pinned').filter({ hasText: name });

/** A big "camera" photo, made in the browser: 2000 × 1500 px PNG. */
async function cameraPhoto(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 2000;
    c.height = 1500;
    const x = c.getContext('2d')!;
    x.fillStyle = '#2a7';
    x.fillRect(0, 0, 2000, 1500);
    x.fillStyle = '#fff';
    x.fillRect(600, 300, 800, 900);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/** Width of a loaded image (0 until it has loaded from the server). */
async function loadedWidth(img: Locator) {
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(0);
  return img.evaluate((i: HTMLImageElement) => i.naturalWidth);
}

test('add a product photo, see it on the list, remove it', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  const ben = await login(browser, BEN);

  // New item with one product, sold at dm, with a photo.
  await anna.getByRole('link', { name: 'Items' }).click();
  await anna.getByRole('button', { name: '+ New item' }).click();
  let sheet = anna.getByRole('dialog');
  await sheet.getByLabel('Name', { exact: true }).fill('Oat drink');
  await sheet.getByRole('button', { name: 'Save item' }).click();
  await expect(sheet).toHaveCount(0);

  await anna.getByTestId('item-Oat drink').locator('.rowmain').click();
  sheet = anna.getByRole('dialog');
  await sheet.getByRole('button', { name: '+ Add product' }).click();
  await sheet.getByLabel('Brand and name').fill('Oatly Barista');
  await sheet.getByRole('group', { name: 'Verdict' }).getByRole('button', { name: 'Preferred' }).click();
  await sheet.getByTestId('offer-dm').getByRole('button', { name: 'Sold here' }).click();
  await sheet.getByLabel('Price at dm').fill('2,29');

  await expect(sheet.getByTestId('photo')).toContainText('No photo');
  await sheet.locator('input[type="file"]').setInputFiles({
    name: 'IMG_0001.png',
    mimeType: 'image/png',
    buffer: await cameraPhoto(anna)
  });
  // Preview from the phone, already shrunk to 1024 px.
  const preview = sheet.getByTestId('photo').locator('img');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  expect(await loadedWidth(preview)).toBe(1024);
  await sheet.getByRole('button', { name: 'Add product' }).click();

  // Back in the item sheet: the product row has its thumbnail from the server.
  const thumb = sheet.getByTestId('product-Oatly Barista').locator('img.thumb');
  expect(await loadedWidth(thumb)).toBe(96);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);

  // On the list as a specific product: thumbnail on Anna's and Ben's phones.
  await anna.getByRole('link', { name: 'List' }).click();
  await addField(anna).fill('Oatly');
  await anna.locator('.sugg .product-option').filter({ hasText: 'Oatly Barista' }).click();
  const row = specific(anna, 'Oatly Barista');
  await visible(row);
  expect(await loadedWidth(row.getByTestId('entry-photo'))).toBe(96);
  await visible(specific(ben, 'Oatly Barista'));
  expect(await loadedWidth(specific(ben, 'Oatly Barista').getByTestId('entry-photo'))).toBe(96);

  // Protected: without the file token the server doesn't hand it out.
  const src = (await row.getByTestId('entry-photo').getAttribute('src'))!;
  const bare = src.replace(/([?&])token=[^&]*&?/, '$1');
  expect(await anna.evaluate(async (u) => (await fetch(u)).status, bare)).not.toBe(200);
  expect(await anna.evaluate(async (u) => (await fetch(u)).status, src)).toBe(200);

  // The entry sheet shows it bigger.
  await row.locator('.rowmain').click();
  sheet = anna.getByRole('dialog');
  expect(await loadedWidth(sheet.getByTestId('entry-sheet-photo'))).toBe(480);

  // Remove the photo: gone on both phones.
  await sheet.getByTestId('product-Oatly Barista').click();
  await sheet.getByRole('button', { name: 'Remove photo' }).click();
  await expect(sheet.getByTestId('photo')).toContainText('No photo');
  await sheet.getByRole('button', { name: 'Save' }).click();
  // back in the entry sheet, without the photo
  await visible(sheet.getByTestId('products'));
  await expect(sheet.getByTestId('entry-sheet-photo')).toHaveCount(0);
  await anna.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(row.getByTestId('entry-photo')).toHaveCount(0);
  await expect(specific(ben, 'Oatly Barista').getByTestId('entry-photo')).toHaveCount(0);
});
