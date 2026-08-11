import js from '@eslint/js';
import globals from 'globals';
import checkFile from 'eslint-plugin-check-file';
import playwright from 'eslint-plugin-playwright';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

const frontendSourceFiles = ['frontend/**/*.{ts,tsx}'];
const frontendAppComponents = ['frontend/src/app/**/*.tsx', '**/src/app/**/*.tsx'];
const browserIntegrationSpecFiles = ['**/tests/browser-integration/**/*.spec.ts'];
const mockBffSourceFiles = ['**/tests/browser-integration/mock-bff/**/*.ts'];
const nodeSourceFiles = ['backend/**/*.ts', 'simulator/**/*.ts'];
const nodeScriptFiles = ['scripts/**/*.mjs'];
const sharedSourceFiles = ['shared/**/*.ts'];
const configFiles = ['*.config.js', 'frontend/*.config.js'];

export default tseslint.config(
    {
        ignores: [
            '**/coverage/**',
            '**/dist/**',
            '**/node_modules/**',
            'frontend/src/vite-env.d.ts',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        plugins: {
            'check-file': checkFile,
            'simple-import-sort': simpleImportSort,
        },
        rules: {
            curly: ['error', 'all'],
            'padding-line-between-statements': [
                'error',
                { blankLine: 'always', prev: 'directive', next: '*' },
                { blankLine: 'any', prev: 'directive', next: 'directive' },
                { blankLine: 'always', prev: '*', next: 'return' },
                { blankLine: 'always', prev: '*', next: 'throw' },
                { blankLine: 'always', prev: '*', next: 'block-like' },
                { blankLine: 'always', prev: 'block-like', next: '*' },
            ],
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    prefer: 'type-imports',
                    fixStyle: 'inline-type-imports',
                },
            ],
            'simple-import-sort/imports': [
                'error',
                {
                    groups: [['^\\u0000'], ['^node:'], ['^@?\\w'], ['^\\.\\.(?:/|$)'], ['^\\./']],
                },
            ],
            'check-file/filename-naming-convention': [
                'error',
                {
                    '**/*.{ts,tsx}': 'KEBAB_CASE',
                },
                {
                    ignoreMiddleExtensions: true,
                },
            ],
        },
    },
    {
        files: frontendSourceFiles,
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.browser,
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        },
    },
    {
        files: frontendAppComponents,
        rules: {
            'check-file/filename-naming-convention': [
                'error',
                {
                    '**/*.tsx': 'PASCAL_CASE',
                },
                {
                    ignoreMiddleExtensions: true,
                },
            ],
        },
    },
    {
        files: browserIntegrationSpecFiles,
        ...playwright.configs['flat/recommended'],
        rules: {
            ...playwright.configs['flat/recommended'].rules,
            'playwright/no-focused-test': 'error',
            'playwright/no-skipped-test': 'error',
        },
    },
    {
        files: mockBffSourceFiles,
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: [...nodeSourceFiles, ...nodeScriptFiles],
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: sharedSourceFiles,
        languageOptions: {
            ecmaVersion: 2022,
        },
    },
    {
        files: configFiles,
        languageOptions: {
            ecmaVersion: 2022,
            globals: {
                ...globals.node,
            },
        },
    },
);
