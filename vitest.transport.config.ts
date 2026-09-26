import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/transport-integration/**/*.test.ts'],
        testTimeout: 10_000,
    },
});
