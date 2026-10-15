import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/api/src/generated/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    name: 'edumaster/node-scripts',
    files: ['scripts/**/*.mjs', '*.js'],
    languageOptions: { globals: globals.node },
  },

  {
    // Type-aware linting for the API: unhandled promises and unsafe `any`
    // flows are the bugs most likely to become data-integrity problems.
    name: 'edumaster/api',
    files: ['apps/api/**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // NestJS modules are legitimately empty decorated classes.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },

  {
    name: 'edumaster/web',
    files: ['apps/web/**/*.{ts,vue}'],
    extends: [pluginVue.configs['flat/recommended']],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // Optional props are typed `T | undefined` and handled explicitly;
      // TypeScript already enforces what this rule guards in plain JS.
      'vue/require-default-prop': 'off',
    },
  },

  {
    name: 'edumaster/web-tooling',
    files: ['apps/web/*.config.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
