import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/*
 * Browser tests of the critical workflows, run against the real API, a real
 * PostgreSQL database and the real web application — nothing is mocked.
 *
 *   npm run infra:up      # PostgreSQL, Redis and object storage
 *   npm run e2e
 *
 * They use the dedicated `<database>_test` database and their own storage
 * bucket, so development data is never touched. Each spec provisions a school
 * of its own, so specs do not depend on one another.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = `${root}.env`;
if (existsSync(envFile)) process.loadEnvFile(envFile);

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is not set — run `npm run setup` first.');
const testDatabase = new URL(databaseUrl);
if (!testDatabase.pathname.endsWith('_test')) testDatabase.pathname += '_test';

export const API_PORT = 4020;
export const WEB_PORT = 5200;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}/api/v1`;

const serverEnv = {
  ...process.env,
  DATABASE_URL: testDatabase.toString(),
  S3_BUCKET: 'edumaster-test',
  API_HOST: '127.0.0.1',
  API_PORT: String(API_PORT),
  WEB_PORT: String(WEB_PORT),
  CORS_ORIGINS: WEB_URL,
  // The suite signs in far more often than a person would.
  RATE_LIMIT_LOGIN_PER_MINUTE: '2000',
  RATE_LIMIT_PER_MINUTE: '100000',
  RATE_LIMIT_NAMESPACE: `e2e-${Date.now()}`,
} as Record<string, string>;

export default defineConfig({
  testDir: './tests',
  outputDir: '../test-results',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  workers: 2,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  // Generous: each spec first provisions a whole school through the API,
  // which hashes several passwords with Argon2.
  timeout: 150_000,
  expect: { timeout: 10_000 },
  reporter: process.env['CI']
    ? [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]]
    : [['list']],
  use: {
    baseURL: WEB_URL,
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Use an installed Chromium instead of Playwright's download, e.g.
      // PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run e2e
      executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] || undefined,
    },
  },
  webServer: [
    {
      command:
        'npm run prisma:migrate:deploy -w @edumaster/api && npm run build -w @edumaster/api && node apps/api/dist/main.js',
      cwd: root,
      env: serverEnv,
      url: `${API_URL}/health/live`,
      timeout: 300_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npm run dev -w @edumaster/web',
      cwd: root,
      env: serverEnv,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
