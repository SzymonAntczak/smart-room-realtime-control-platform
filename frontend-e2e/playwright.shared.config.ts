import type { PlaywrightTestConfig } from '@playwright/test';

import { browserTestUrls } from './tests/browser-test-runtime';

export const browserIntegrationConfig = {
    globalSetup: './tests/mock-bff/test-runtime.ts',
    testDir: './tests',
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
} satisfies PlaywrightTestConfig;
