import { expect, test } from '@playwright/test';

test('starts the frontend integration test suite', async ({ page }) => {
    const realtimeRequest = page.waitForRequest('http://127.0.0.1:4311/room/realtime');

    await page.goto('/');

    await expect(page).toHaveTitle('Smart Room Control');
    await expect(page.locator('#root')).not.toBeEmpty();
    await realtimeRequest;
});
