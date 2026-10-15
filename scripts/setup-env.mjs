#!/usr/bin/env node
// Creates or completes the local `.env` from `.env.example`.
//
// - No `.env` yet: copies the example, replacing every `change-me-*`
//   placeholder with a freshly generated random secret.
// - `.env` exists: appends only the variables it is missing (new ones added
//   by later versions), generating secrets for them. Existing values are
//   never modified, so credentials of a running database are not clobbered.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const examplePath = `${root}.env.example`;
const envPath = `${root}.env`;

const secrets = new Map();
const secretFor = (placeholder) => {
  if (!secrets.has(placeholder)) {
    // Hex keeps the value safe to embed in connection URLs without escaping.
    secrets.set(placeholder, randomBytes(32).toString('hex'));
  }
  return secrets.get(placeholder);
};
const fill = (line) => line.replace(/change-me-[a-z0-9-]+/g, secretFor);
const keyOf = (line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];

const exampleLines = readFileSync(examplePath, 'utf8').split('\n');

if (!existsSync(envPath)) {
  const content = exampleLines.map((line) => (line.startsWith('#') ? line : fill(line))).join('\n');
  writeFileSync(envPath, content, { mode: 0o600 });
  console.log(`Created .env with ${secrets.size} generated secret(s).`);
  process.exit(0);
}

const current = readFileSync(envPath, 'utf8');
const present = new Set(current.split('\n').map(keyOf).filter(Boolean));
const missing = exampleLines.filter((line) => keyOf(line) && !present.has(keyOf(line)));

if (missing.length === 0) {
  console.log('.env is complete — nothing to add.');
  process.exit(0);
}

const addition = ['', '# Added by `npm run setup`', ...missing.map(fill), ''].join('\n');
writeFileSync(envPath, current.replace(/\n*$/, '\n') + addition, { mode: 0o600 });
console.log(`Added to .env: ${missing.map(keyOf).join(', ')}`);
