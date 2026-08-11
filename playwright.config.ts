import { defineConfig } from '@playwright/test';

export default defineConfig({
    globalSetup: './frontend/tests/browser-integration/mock-bff/test-runtime.ts',
    outputDir: 'test-results/frontend-integration',
    testDir: 'frontend/tests/browser-integration',
    testMatch: '**/*.spec.ts',
    use: {
        baseURL: 'http://127.0.0.1:5174',
        headless: true,
        locale: 'pl-PL',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
