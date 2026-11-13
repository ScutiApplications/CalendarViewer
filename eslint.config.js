const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['vendor/**', 'node_modules/**', 'dist/**', 'brand/**', 'data/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // Sanitizers strip control characters on purpose; rethrown errors carry their message.
      'no-control-regex': 'off',
      'preserve-caught-error': 'off'
    }
  },
  {
    // Server, tools and tests are CommonJS on Node.
    files: ['src/server/**/*.js', 'tools/**/*.js', 'test/**/*.js', '*.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ICAL: 'readonly' } }
  },
  {
    // Shared files load as page scripts and as Node modules (UMD or a typeof module guard).
    files: ['src/shared/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.node, ICAL: 'readonly' } },
    rules: { 'no-undef': 'off' } // backup.js and others use names from sibling page scripts
  },
  {
    // Page scripts are classic scripts that share one global scope, so cross-file names cannot be checked by no-undef
    // or no-unused-vars. test/web-scripts.test.js guards against duplicate top-level names instead.
    files: ['src/web/js/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ICAL: 'readonly', FullCalendar: 'readonly' } },
    rules: { 'no-undef': 'off', 'no-unused-vars': 'off' }
  },
  {
    files: ['e2e/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules: { 'no-undef': 'off' } // page.evaluate callbacks run in the page and use its globals
  },
];
