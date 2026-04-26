// Permissive baseline ESLint config.
// Goal: catch obvious bugs going forward without rewriting the codebase.
// Suppression comments using `no-console`, `global-require`, and
// `react-hooks/exhaustive-deps` already exist in the codebase, so the rules
// they reference must remain registered to keep those suppressions meaningful.
module.exports = {
  env: { node: true, browser: true, es2022: true },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  settings: {
    react: { version: 'detect' },
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'global-require': 'warn',
    // Downgrade rules that fire against existing code patterns. Goal of this
    // baseline is to catch *new* obvious bugs — not to rewrite the codebase.
    // Re-enable as 'error' incrementally once the existing offenders are
    // cleaned up.
    'no-useless-escape': 'warn',
    'no-case-declarations': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-catch': 'warn',
    'no-prototype-builtins': 'warn',
    'react/no-unescaped-entities': 'warn',
    'react/display-name': 'warn',
    'react/jsx-key': 'warn',
    'react/no-unknown-property': 'warn',
  },
  overrides: [
    {
      files: ['server/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
      env: { node: true, browser: false },
      parserOptions: { sourceType: 'script' },
    },
    {
      files: ['test/**/*.js'],
      // Tests can use console freely and may have unused signature params.
      rules: {
        'no-unused-vars': 'off',
      },
    },
  ],
};
