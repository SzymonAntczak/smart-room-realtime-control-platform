import { defineConfig } from '@playwright/test';

export default defineConfig({
    globalSetup: './frontend/tests/browser-integration/mock-bff/test-runtime.ts',
    outputDir: 'test-results/frontend-integration',
    testDir: 'frontend/tests/browser-integration',
    use: {
        baseURL: 'http://127.0.0.1:5174',
        headless: true,
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
