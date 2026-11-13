import { defineConfig } from '@playwright/test';

import { smokeUrls } from './smoke-urls';

export default defineConfig({
    globalSetup: './system-runtime.ts',
    testDir: './tests',
    outputDir: '../test-results/full-system',
    workers: 1,
    retries: 0,
    timeout: 60_000,
    forbidOnly: true,
    use: {
        baseURL: smokeUrls.frontend,
        browserName: 'chromium',
        headless: true,
        locale: 'pl-PL',
        viewport: { width: 1440, height: 900 },
        contextOptions: { reducedMotion: 'reduce' },
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
});
