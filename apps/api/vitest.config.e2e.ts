import { defineConfig } from 'vitest/config';
import { resolveTestDatabase } from './test/support/test-database.js';

// End-to-end tests boot the real application against real PostgreSQL and
// Redis (`npm run infra:up`), using a dedicated database so development data
// is never touched.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    env: {
      DATABASE_URL: resolveTestDatabase().url,
      // Uploads made by the tests are kept out of the development bucket.
      S3_BUCKET: 'edumaster-test',
      // Suites sign in far more often than a person would; the limiter has
      // its own suite that lowers this again.
      RATE_LIMIT_LOGIN_PER_MINUTE: '10000',
      RATE_LIMIT_PER_MINUTE: '100000',
    },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
