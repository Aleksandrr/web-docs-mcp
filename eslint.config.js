// ESLint flat config for web-docs-mcp (ESLint v9+)
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Allow unused params with underscore prefix (useful for MCP tool handlers)
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      // Allow explicit any for edge cases (common in MCP/zod handling)
      '@typescript-eslint/no-explicit-any': 'off',
      // Don't require return types on all functions (too noisy)
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Allow non-null assertions where needed
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Console is fine for logging in MCP servers
      'no-console': 'off',
      // Disable strict error preservation rules (not relevant for this codebase)
      'preserve-caught-error': 'off',
      // Allow useless assignments in some cases
      'no-useless-assignment': 'warn',
      // Don't enforce escape character rules strictly
      'no-useless-escape': 'warn',
    },
  },
  {
    ignores: ['build/', 'node_modules/', '.cache/', 'docs/']
  }
);
