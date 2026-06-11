import js from '@eslint/js';
import globals from 'globals';
import checkFile from 'eslint-plugin-check-file';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const frontendSourceFiles = ['frontend/**/*.{ts,tsx}'];
const frontendAppComponents = ['frontend/src/app/**/*.tsx', '**/src/app/**/*.tsx'];
const nodeSourceFiles = ['backend/**/*.ts', 'simulator/**/*.ts'];
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
        },
        rules: {
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
        files: nodeSourceFiles,
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
