import { expect, test, type Page } from '@playwright/test';
import { ANNA, BEN, diagnostics, entry, login, notNeeded, oneOffAt, visible } from './helpers';

// The suggestion strip above the list (spec: Recommendations). "Usually
// bought now" needs weeks of purchases, so its rule is tested without a
// browser in rhythm.spec.ts; here: "Low at home", the store filter, adding
// with one tap and "not today".

test.afterEach(() => {
  diagnostics.length = 0;
});

function chip(page: Page, name: string) {
  return page.getByRole('group', { name: 'Shopping at' }).getByRole('button', { name, exact: true });
}

test('low stock is suggested, can be hidden for today, and added with one tap', async ({ browser }) => {
  const anna = await login(browser, ANNA);
  const ben = await login(browser, BEN);

  // A tracked item bought at dm.
  await anna.getByRole('link', { name: 'Items' }).click();
  await anna.getByRole('button', { name: '+ New item' }).click();
  const sheet = anna.getByRole('dialog');
  await sheet.getByLabel('Name', { exact: true }).fill('Sponges');
  await sheet.getByLabel('Keep in stock at home').check();
  await sheet.getByTestId('rule-dm').getByRole('button', { name: 'Buy here' }).click();
  await sheet.getByRole('button', { name: 'Save item' }).click();
  await expect(sheet).toHaveCount(0);

  // Low (the item restocks at Out): not on the list, but suggested.
  await anna.getByRole('link', { name: 'Stock' }).click();
  await anna.getByTestId('stock-Sponges').getByRole('button', { name: 'Low' }).click();
  await anna.getByRole('link', { name: 'List' }).click();
  const pill = anna.getByTestId('suggestion-Sponges');
  await visible(pill);
  await expect(pill).toContainText('low at home');
  await expect(entry(anna, 'Sponges')).toHaveCount(0);

  // Ben's phone shows it too.
  await visible(ben.getByTestId('suggestion-Sponges'));

  // Only for stores it's bought at (chips need something on the list there).
  await oneOffAt(anna, 'Foil', 'Aldi');
  await oneOffAt(anna, 'Cotton pads', 'dm');
  await chip(anna, 'Aldi').click();
  await expect(pill).toHaveCount(0);
  await chip(anna, 'dm').click();
  await visible(pill);
  await expect(anna.getByTestId('suggestions')).toContainText('Suggestions for dm');
  await chip(anna, 'All').click();
  await notNeeded(anna, 'Foil');
  await notNeeded(anna, 'Cotton pads');

  // × hides it on this phone for the rest of the day, also after a reload.
  await pill.getByRole('button', { name: 'Not today: Sponges' }).click();
  await expect(pill).toHaveCount(0);
  await anna.reload();
  await visible(chip(anna, 'All'));
  await expect(anna.getByTestId('suggestion-Sponges')).toHaveCount(0);
  await visible(ben.getByTestId('suggestion-Sponges'));

  // One tap on Ben's phone adds it; the suggestion goes away.
  await ben.getByTestId('suggestion-Sponges').getByRole('button', { name: /Sponges/ }).first().click();
  await visible(entry(ben, 'Sponges'));
  await expect(ben.getByTestId('suggestion-Sponges')).toHaveCount(0);
  await visible(entry(anna, 'Sponges'));

  // Bought: stock is OK again, nothing to suggest.
  await entry(ben, 'Sponges').getByRole('button', { name: 'Bought' }).click();
  await expect(ben.getByTestId('suggestion-Sponges')).toHaveCount(0);
  await anna.getByRole('link', { name: 'Stock' }).click();
  await expect(anna.getByTestId('stock-Sponges').getByRole('button', { name: 'OK' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
