import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const STATE_FILE = fileURLToPath(new URL('../.state/platform.json', import.meta.url));

/**
 * Creates the platform's super administrator, who provisions a school for
 * each spec. Runs after the API has started, so the database is migrated and
 * the compiled command-line tool exists.
 */
export default function globalSetup(): void {
  const envFile = `${root}.env`;
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const database = new URL(process.env['DATABASE_URL'] ?? '');
  if (!database.pathname.endsWith('_test')) database.pathname += '_test';

  const email = `e2e-${randomBytes(5).toString('hex')}@test.example`;
  const password = randomBytes(18).toString('base64url');
  execFileSync('node', ['dist/cli/create-super-admin.js'], {
    cwd: `${root}apps/api`,
    env: {
      ...process.env,
      DATABASE_URL: database.toString(),
      SUPERADMIN_EMAIL: email,
      SUPERADMIN_PASSWORD: password,
    },
    stdio: 'pipe',
  });

  mkdirSync(fileURLToPath(new URL('../.state/', import.meta.url)), { recursive: true });
  // Held only for the length of the run, in a git-ignored file.
  writeFileSync(STATE_FILE, JSON.stringify({ email, password }), { mode: 0o600 });
}
