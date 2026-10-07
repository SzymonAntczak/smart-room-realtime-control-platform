import { defineConfig } from '@playwright/test';

import { browserIntegrationConfig } from './playwright.shared.config';

export default defineConfig({
    ...browserIntegrationConfig,
    outputDir: 'test-results/frontend-integration',
    testIgnore: '**/react-compiler-evidence.spec.ts',
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
});
