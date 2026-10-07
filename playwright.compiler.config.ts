import { defineConfig } from '@playwright/test';

import { browserIntegrationConfig } from './playwright.shared.config';

export default defineConfig({
    ...browserIntegrationConfig,
    metadata: { reactCompiler: true },
    outputDir: 'test-results/frontend-integration-compiler',
    projects: [
        {
            name: 'chromium-react-compiler',
            use: { browserName: 'chromium' },
        },
    ],
});
