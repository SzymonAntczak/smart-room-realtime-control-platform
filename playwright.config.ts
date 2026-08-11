import { defineConfig } from '@playwright/test';

export default defineConfig({
    outputDir: 'test-results/frontend-integration',
    testDir: 'frontend/tests/browser-integration',
    use: {
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
