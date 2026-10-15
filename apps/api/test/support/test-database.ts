import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end tests never run against the development database. They use
 * `TEST_DATABASE_URL` when set, otherwise a sibling of `DATABASE_URL` whose
 * name ends in `_test` (created on demand by the global setup).
 */
export function resolveTestDatabase(): { url: string; adminUrl: string; name: string } {
  const rootEnvFile = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(rootEnvFile)) {
    process.loadEnvFile(rootEnvFile);
  }

  const baseUrl = process.env['DATABASE_URL'];
  if (!baseUrl) {
    throw new Error('DATABASE_URL must be set to run the end-to-end tests.');
  }

  const explicit = process.env['TEST_DATABASE_URL'];
  const target = new URL(explicit ?? baseUrl);
  if (!explicit) {
    target.pathname = `${target.pathname.replace(/_test$/, '')}_test`;
  }

  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Unsupported test database name: ${name}`);
  }

  // Connect to the always-present maintenance database to create ours.
  const admin = new URL(target);
  admin.pathname = '/postgres';
  admin.search = '';

  return { url: target.toString(), adminUrl: admin.toString(), name };
}
