/**
 * MCP Servers ESLint設定 (Flat Config - ESLint v9)
 */

const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const customRules = require('./eslint-rules');

module.exports = [
  // 無視するファイル
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'eslint-rules/**',
      'eslint.config.js',
    ],
  },

  // TypeScriptファイル共通設定
  {
    files: ['packages/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'custom': customRules,
    },
    rules: {
      // TypeScript関連
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // 一般的なルール
      'prefer-const': 'warn',
    },
  },

  // single-params-object を全パッケージに適用
  {
    files: [
      'packages/*/src/**/*.ts',
    ],
    rules: {
      'custom/single-params-object': ['error', {
        maxParams: 1,
        ignoreConstructors: true,
        ignoreArrowFunctions: true,  // .map((a, b) => ...) 等を除外
      }],
    },
  },

  // テストファイルでは緩和
  {
    files: ['packages/**/__tests__/**/*.ts', 'packages/**/*.test.ts'],
    rules: {
      'custom/single-params-object': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
