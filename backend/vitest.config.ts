import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['src/**/*.test.ts'],
                    exclude: ['src/testing/integration/**'],
                    testTimeout: 10_000,
                    hookTimeout: 10_000,
                },
            },
            {
                test: {
                    name: 'integration',
                    environment: 'node',
                    include: ['src/testing/integration/**/*.test.ts'],
                    setupFiles: ['src/testing/integration/integration-setup.ts'],
                    testTimeout: 10_000,
                    hookTimeout: 10_000,
                },
            },
        ],
    },
});
