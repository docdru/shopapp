import { expect, test, type Page } from '@playwright/test';
import { ANNA, BEN, CARLA, addViaEnter, diagnostics, entry, login, visible } from './helpers';

// Changing your own password (Account sheet). Uses Carla, who no other test
// signs in as. Runs first (one worker, alphabetical).

test.afterEach(() => {
  diagnostics.length = 0;
});

const NEW_PASSWORD = 'carla-new-password-42';

async function openAccount(page: Page) {
  await page.getByRole('button', { name: 'Account' }).click();
  return page.getByRole('dialog');
}

test('change password: validation, other devices signed out, new password works', async ({ browser }) => {
  const phone = await login(browser, CARLA);
  const tablet = await login(browser, CARLA);

  const sheet = await openAccount(phone);
  await expect(sheet).toContainText('carla@example.com');

  // Wrong current password is rejected by the server.
  await sheet.getByLabel('Current password').fill('not-my-password');
  await sheet.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await sheet.getByLabel('Repeat new password').fill(NEW_PASSWORD);
  await sheet.getByRole('button', { name: 'Change password' }).click();
  await expect(sheet.getByRole('alert')).toContainText('current password is wrong');

  // Mismatch and too short are caught before sending.
  await sheet.getByLabel('Current password').fill(CARLA.password);
  await sheet.getByLabel('Repeat new password').fill('something-else-123');
  await sheet.getByRole('button', { name: 'Change password' }).click();
  await expect(sheet.getByRole('alert')).toContainText("don't match");

  await sheet.getByLabel('New password', { exact: true }).fill('short');
  await sheet.getByLabel('Repeat new password').fill('short');
  await sheet.getByRole('button', { name: 'Change password' }).click();
  await expect(sheet.getByRole('alert')).toContainText('at least 10');

  // Success: this phone stays signed in.
  await sheet.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await sheet.getByLabel('Repeat new password').fill(NEW_PASSWORD);
  await sheet.getByRole('button', { name: 'Change password' }).click();
  await expect(phone.getByRole('status')).toContainText('Password changed');
  await expect(sheet).toHaveCount(0);

  // ...and still receives live updates from others.
  const anna = await login(browser, ANNA);
  await addViaEnter(anna, 'After password change');
  await visible(entry(phone, 'After password change'));

  // The tablet's session is revoked: its next action signs it out.
  await addViaEnter(tablet, 'From the old session');
  await expect(tablet).toHaveURL(/\/login$/);

  // Old password no longer works, the new one does.
  await tablet.getByLabel('Email').fill(CARLA.email);
  await tablet.getByLabel('Password').fill(CARLA.password);
  await tablet.getByRole('button', { name: 'Sign in' }).click();
  await expect(tablet.getByRole('alert')).toContainText('Login failed');
  await tablet.getByLabel('Password').fill(NEW_PASSWORD);
  await tablet.getByRole('button', { name: 'Sign in' }).click();
  await visible(entry(tablet, 'After password change'));

  // Tidy up the list.
  await entry(anna, 'After password change').locator('.rowmain').click();
  await anna.getByRole('dialog').getByRole('button', { name: 'Not needed' }).click();
  await expect(entry(phone, 'After password change')).toHaveCount(0);

  // Log out from the Account sheet.
  const again = await openAccount(phone);
  await again.getByRole('button', { name: 'Log out' }).click();
  await expect(phone).toHaveURL(/\/login$/);
});

// The 10-character minimum isn't only a rule of the account sheet: the server
// refuses shorter passwords too, for anyone who talks to the API directly.
test('the server refuses a new password under 10 characters', async ({ request }) => {
  const auth = await request.post('/api/collections/users/auth-with-password', {
    data: { identity: BEN.email, password: BEN.password }
  });
  expect(auth.status()).toBe(200);
  const { token, record } = await auth.json();

  const change = await request.patch(`/api/collections/users/records/${record.id}`, {
    headers: { Authorization: token },
    data: { oldPassword: BEN.password, password: '123456789', passwordConfirm: '123456789' }
  });
  expect(change.status()).toBe(400);
  expect((await change.json()).data.password.code).toBe('validation_min_text_constraint');
});
