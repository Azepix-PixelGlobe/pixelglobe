import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import { importX } from 'eslint-plugin-import-x';
import globals from 'globals';
import babelParser from '@babel/eslint-parser';

export default [
  {
    ignores: [
      'dist/', 'node_modules/', 'tests/',
      /* maybe we fix those at some point in the future */
      'deployment/scripts/', 'scripts/',
    ],
  },

  js.configs.recommended,
  importX.flatConfigs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  stylistic.configs.customize({
    indent: 2,
    quotes: 'single',
    semi: true,
    jsx: true,
    braceStyle: '1tbs',
  }),

  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: babelParser,
      parserOptions: {
        babelOptions: {
          rootMode: 'upward',
        },
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },

    rules: {
      'no-shadow': 'error',
      'no-await-in-loop': 'error',
      'camelcase': 'error',
      'no-underscore-dangle': 'warn',
      'class-methods-use-this': 'error',
      'consistent-return': 'error',
      'eqeqeq': ['error', 'always', { null: 'always' }],
      'max-len': ['warn', {
        code: 80,
        tabWidth: 2,
        ignoreUrls: true,
        ignorePattern: '^\\s*//\\s*t:|^\\s*/\\*\\s*t:',
      }],
      '@stylistic/arrow-parens': ['error', 'always', {
        requireForBlockBody: true,
      }],
      '@stylistic/no-multiple-empty-lines': 'off',
      '@stylistic/multiline-ternary': 'off',
      '@stylistic/quote-props': 'off',
      '@stylistic/jsx-one-expression-per-line': 'off',
      '@stylistic/jsx-closing-tag-location': 'off',
      '@stylistic/jsx-closing-bracket-location': 'off',
      '@stylistic/max-statements-per-line': 'off',
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      'jsx-a11y/control-has-associated-label': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'react/prop-types': 'off',
      /*
       * react rule we did not have before and we are still unsure about
       */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },

    settings: {
      react: { version: '18.0' },
      'import-x/extensions': ['.js', '.jsx'],
      'import-x/resolver': { node: true },
    },
  },
];
