import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { loadEnv } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

// The monorepo keeps a single `.env` at the repository root. Only variables
// prefixed with VITE_ ever reach the browser bundle; the unprefixed ones read
// below are used by the dev server alone.
const envDir = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const apiTarget = `http://127.0.0.1:${env.API_PORT || '4000'}`;

  return {
    envDir,
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: Number(env.WEB_PORT || 5180),
      strictPort: true,
      // Same-origin API calls in development: no CORS preflights, and the
      // same shape as production where Nginx fronts both web and API.
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      // The first test of a file compiles every module it imports; on a busy
      // machine that alone can pass Vitest's 5-second default.
      testTimeout: 15_000,
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  };
});
