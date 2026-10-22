import { expect, test } from '@playwright/test';

import { mockBffUrls } from './browser-test-runtime';
import { resetMockRoom } from './mock-bff/mock-bff-control';

test('renders the Polish development trigger after the development bootstrap', async ({ page }) => {
    await resetMockRoom(page.request);

    const realtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await page.goto('/');
    await realtimeRequest;

    await expect(page.getByRole('button', { name: 'Scenariusze programistyczne' })).toBeVisible();
});
