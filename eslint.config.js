import globals from 'globals';

// Window-level APIs that modules still share through `window.X = …` (see docs/Code_Map.md,
// "Оставшиеся глобальные API"). Reading them bare is allowed; new code should import instead.
import windowApis from './tools/window-apis.json' with { type: 'json' };

export default [
  {
    files: ['js/**/*.js'],
    ignores: ['js/bootstrap/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        GPUBufferUsage: 'readonly', GPUTextureUsage: 'readonly', GPUShaderStage: 'readonly', GPUMapMode: 'readonly', GPUColorWrite: 'readonly',
        ...Object.fromEntries(windowApis.map((n) => [n, 'readonly'])),
      },
    },
    rules: {
      'no-undef': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-dupe-keys': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['js/bootstrap/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.browser },
    rules: { 'no-undef': 'error' },
  },
];
