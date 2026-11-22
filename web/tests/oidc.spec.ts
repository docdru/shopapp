import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ANNA, addField, diagnostics, login, visible, watch } from './helpers';

// Sign-in modes (spec "Sign-in"). The normal e2e run is the password-only
// default (E2E_AUTH unset). scripts/e2e-oidc.sh runs this file again against
// a fresh PocketBase per mode, with the mock provider (scripts/mock-oidc.mjs):
//   both   single sign-on + password
//   off    single sign-on only (PASSWORD_LOGIN=off)
//   guard  PASSWORD_LOGIN=off without a provider: the server keeps password on

const MODE = process.env.E2E_AUTH ?? 'password';
const PROVIDER = 'Test provider';
const ADMIN = { identity: 'admin@example.com', password: 'admin-password-123' };

test.afterEach(() => {
  diagnostics.length = 0;
});

function only(mode: string) {
  test.skip(MODE !== mode, `runs in sign-in mode "${mode}" (scripts/e2e-oidc.sh)`);
}

async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/collections/_superusers/auth-with-password', { data: ADMIN });
  expect(res.status()).toBe(200);
  return (await res.json()).token;
}

async function list(request: APIRequestContext, token: string, collection: string, filter = '') {
  const q = new URLSearchParams({ perPage: '200', ...(filter ? { filter } : {}) });
  const res = await request.get(`/api/collections/${collection}/records?${q}`, { headers: { Authorization: token } });
  expect(res.status()).toBe(200);
  return (await res.json()).items as Record<string, unknown>[];
}

async function passwordLogin(request: APIRequestContext, email: string, password: string) {
  return (await request.post('/api/collections/users/auth-with-password', { data: { identity: email, password } })).status();
}

interface Claims {
  sub: string;
  email?: string;
  verified?: boolean;
  cancel?: boolean;
}

/** Click the provider button and answer the mock provider's form. */
async function signOn(page: Page, c: Claims) {
  await page.goto('/login');
  await page.getByRole('button', { name: `Sign in with ${PROVIDER}` }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:9099\/authorize/);
  await page.getByLabel('sub').fill(c.sub);
  await page.getByLabel('email', { exact: true }).fill(c.email ?? '');
  if (c.verified === false) await page.getByLabel('email_verified').uncheck();
  await page.getByRole('button', { name: c.cancel ? 'Cancel' : 'Sign in' }).click();
}

async function newPage(page: Page, who: string) {
  watch(page, who);
  return page;
}

test.describe('password only (default)', () => {
  test.beforeEach(() => only('password'));

  test('login page has no provider button and the server offers no single sign-on', async ({ page, request }) => {
    await newPage(page, 'default');
    await page.goto('/login');
    await visible(page.getByLabel('Email'));
    await expect(page.getByRole('button', { name: /Sign in with/ })).toHaveCount(0);
    const methods = await (await request.get('/api/collections/users/auth-methods')).json();
    expect(methods.password.enabled).toBe(true);
    expect(methods.oauth2.enabled).toBe(false);
  });
});

test.describe('single sign-on + password', () => {
  test.beforeEach(() => only('both'));

  test('login page offers both', async ({ page }) => {
    await newPage(page, 'both');
    await page.goto('/login');
    await visible(page.getByRole('button', { name: `Sign in with ${PROVIDER}` }));
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('first sign-on links the existing account (even unverified) and its password keeps working', async ({
    page,
    request
  }) => {
    const token = await adminToken(request);
    const household = (await list(request, token, 'households'))[0].id;
    // An admin-created account that was left unverified: PocketBase would
    // reset its password on linking without the hook.
    const dora = { email: 'dora@example.com', password: 'test-password-4' };
    const created = await request.post('/api/collections/users/records', {
      headers: { Authorization: token },
      data: { name: 'Dora', ...dora, passwordConfirm: dora.password, household, verified: false }
    });
    expect(created.status()).toBe(200);
    const usersBefore = (await list(request, token, 'users')).length;

    await newPage(page, 'dora');
    await signOn(page, { sub: 'dora-at-provider', email: dora.email });
    await visible(addField(page));
    await expect(page.getByRole('button', { name: 'Account' })).toHaveText('Dora');

    // Linked, nothing created, password still works.
    const links = await list(request, token, '_externalAuths', `providerId = "dora-at-provider"`);
    expect(links).toHaveLength(1);
    expect(links[0].provider).toBe('oidc');
    expect((await list(request, token, 'users')).length).toBe(usersBefore);
    expect(await passwordLogin(request, dora.email, dora.password)).toBe(200);

    // From now on the link counts, not the email.
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await signOn(page, { sub: 'dora-at-provider', email: 'dora.new@example.org' });
    await visible(addField(page));
    await expect(page.getByRole('button', { name: 'Account' })).toHaveText('Dora');
  });

  test('unknown email: clear message, no account and no link created', async ({ page, request }) => {
    const token = await adminToken(request);
    const usersBefore = (await list(request, token, 'users')).length;
    await newPage(page, 'stranger');
    await signOn(page, { sub: 'stranger', email: 'stranger@example.com' });
    await expect(page).toHaveURL(/\/login$/);
    await visible(page.getByRole('alert'));
    await expect(page.getByRole('alert')).toContainText(`no ShopApp account for your ${PROVIDER} email`);
    expect((await list(request, token, 'users')).length).toBe(usersBefore);
    expect(await list(request, token, '_externalAuths', `providerId = "stranger"`)).toHaveLength(0);
  });

  test('an email the provider has not verified is not used for linking', async ({ page, request }) => {
    const token = await adminToken(request);
    await newPage(page, 'unverified-claim');
    await signOn(page, { sub: 'claims-anna', email: ANNA.email, verified: false });
    await expect(page.getByRole('alert')).toContainText('no ShopApp account');
    expect(await list(request, token, '_externalAuths', `providerId = "claims-anna"`)).toHaveLength(0);
  });

  test('cancelled at the provider', async ({ page }) => {
    await newPage(page, 'cancel');
    await signOn(page, { sub: 'anna-at-provider', email: ANNA.email, cancel: true });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('alert')).toContainText('Sign-in was cancelled.');
  });

  test('a return without a matching state is refused', async ({ page }) => {
    await newPage(page, 'forged');
    await page.goto('/login/callback?code=forged-code&state=forged-state');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('alert')).toContainText('expired or didn’t start here');
  });

  test('the provider failing the token exchange shows an error', async ({ page }) => {
    await newPage(page, 'token-error');
    await signOn(page, { sub: 'token-error', email: ANNA.email });
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('alert')).toContainText(`Signing in with ${PROVIDER} didn’t work`);
  });

  test('account sheet still offers Change password', async ({ browser }) => {
    const page = await login(browser, ANNA);
    await page.getByRole('button', { name: 'Account' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Change password' })).toBeVisible();
  });
});

test.describe('single sign-on only (PASSWORD_LOGIN=off)', () => {
  test.beforeEach(() => only('off'));

  test('login page shows only the provider button', async ({ page }) => {
    await newPage(page, 'off');
    await page.goto('/login');
    await visible(page.getByRole('button', { name: `Sign in with ${PROVIDER}` }));
    await expect(page.getByLabel('Email')).toHaveCount(0);
  });

  test('the server refuses password sign-in', async ({ request }) => {
    expect(await passwordLogin(request, ANNA.email, ANNA.password)).toBe(403);
    const methods = await (await request.get('/api/collections/users/auth-methods')).json();
    expect(methods.password.enabled).toBe(false);
    // The admin is not affected.
    expect((await request.post('/api/collections/_superusers/auth-with-password', { data: ADMIN })).status()).toBe(200);
  });

  test('sign-on works and the account sheet hides Change password', async ({ page }) => {
    await newPage(page, 'anna-sso');
    await signOn(page, { sub: 'anna-at-provider', email: ANNA.email });
    await visible(addField(page));
    await page.getByRole('button', { name: 'Account' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', { name: 'Log out' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Change password' })).toHaveCount(0);
    await expect(sheet.getByLabel('Current password')).toHaveCount(0);
  });
});

test.describe('lock-out guard (PASSWORD_LOGIN=off, no provider)', () => {
  test.beforeEach(() => only('guard'));

  test('password sign-in stays on, and the log says why', async ({ browser, request }) => {
    const methods = await (await request.get('/api/collections/users/auth-methods')).json();
    expect(methods.password.enabled).toBe(true);
    expect(methods.oauth2.enabled).toBe(false);
    const page = await login(browser, ANNA);
    await expect(page.getByRole('button', { name: /Sign in with/ })).toHaveCount(0);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('/tmp/pb_e2e.log', 'utf8')).toContain('PASSWORD_LOGIN=off is ignored');
  });
});
