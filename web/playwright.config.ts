import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a real PocketBase serving the built app
// (see the "e2e" job in .github/workflows/ci.yml, or README → Testing).
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  // One shared test database: run files one after another.
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8090',
    // CI also runs the sync test through nginx with a self-signed cert.
    ignoreHTTPSErrors: true,
    ...devices['Pixel 7']
  }
});
