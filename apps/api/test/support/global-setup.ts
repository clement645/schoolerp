import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveTestDatabase } from './test-database.js';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Creates, migrates and empties the dedicated test database. */
export default async function setup(): Promise<void> {
  const { url, adminUrl, name } = resolveTestDatabase();

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      // `name` is validated against /^[a-zA-Z0-9_]+$/ in resolveTestDatabase.
      await admin.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });

  // Start every run from a clean slate. The role catalogue is kept: the
  // application re-synchronises it on start-up.
  const db = new pg.Client({ connectionString: url.split('?')[0] });
  await db.connect();
  try {
    await db.query(
      'TRUNCATE "audit_logs", "refresh_tokens", "user_roles", "users", "schools", "tenants" CASCADE',
    );
  } finally {
    await db.end();
  }
}
