import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The server signs up throwaway users, so it only ever runs against a *_test database.
const DATABASE_URL = process.env.DATABASE_URL_TEST ?? '';
if (!DATABASE_URL.split('?')[0]?.endsWith('_test')) {
  throw new Error(
    'Set DATABASE_URL_TEST to a database whose name ends in _test (see .env.example)',
  );
}

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end tests against a production build on :3200, using the riff_test database.
 * Tests tagged @live also need the real Audius API. Chrome is used by default (it plays
 * every stream codec); set PLAYWRIGHT_CHANNEL=chromium after `pnpm exec playwright install
 * chromium` where Chrome isn't installed.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    // `next` directly (not through pnpm), so stopping the server stops next-server too.
    command: `next build && next start -p ${PORT}`,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DATABASE_URL,
      BETTER_AUTH_URL: BASE_URL,
      ALLOW_SIGNUPS: 'true',
    },
  },
});
