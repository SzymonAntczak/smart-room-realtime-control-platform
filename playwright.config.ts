import { defineConfig } from '@playwright/test';

import { browserTestUrls } from './frontend/tests/browser-integration/browser-test-runtime';

export default defineConfig({
    globalSetup: './frontend/tests/browser-integration/mock-bff/test-runtime.ts',
    outputDir: 'test-results/frontend-integration',
    testDir: 'frontend/tests/browser-integration',
    testMatch: '**/*.spec.ts',
    workers: 1,
    use: {
        baseURL: browserTestUrls.frontend,
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
