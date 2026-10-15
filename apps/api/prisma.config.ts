import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// The monorepo keeps a single `.env` at the repository root. In CI and in
// production the variables are provided by the environment instead.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // `prisma generate` does not need a database, so the URL is only attached
  // when present; migrate commands fail with Prisma's own error without it.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
