// Writes Netlify's routing and header rules into the web build.
//
// - /api/* is proxied to the API (API_ORIGIN), so the app and the API share
//   an origin from the browser's point of view.
// - Every other path serves the single-page application.
// - Security headers match deploy/nginx/security-headers.conf.
import { writeFileSync } from 'node:fs';

const origin = process.env.API_ORIGIN?.replace(/\/+$/, '');
if (!origin || !/^https:\/\/[^/]+$/.test(origin)) {
  console.error(
    'API_ORIGIN must be set to the https address of the API, e.g. https://api.example.com',
  );
  process.exit(1);
}

const dist = new URL('../apps/web/dist/', import.meta.url);

writeFileSync(
  new URL('_redirects', dist),
  [`/api/*  ${origin}/api/:splat  200!`, '/*  /index.html  200', ''].join('\n'),
);

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

writeFileSync(
  new URL('_headers', dist),
  [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
    '  Cross-Origin-Opener-Policy: same-origin',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '/index.html',
    '  Cache-Control: no-cache',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
);

console.log(`Netlify routes written: /api/* → ${origin}`);
