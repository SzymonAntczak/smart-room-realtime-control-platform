import { expect, test } from '@playwright/test';

import { resetMockRoom } from './mock-bff/mock-bff-control';

test('renders the reported LED power state from the room snapshot', async ({ page }) => {
    await resetMockRoom(page.request);

    const realtimeRequest = page.waitForRequest('http://127.0.0.1:4311/room/realtime');

    await page.goto('/');

    await expect(page).toHaveTitle('Smart Room Control');
    await realtimeRequest;
    await expect(page.getByTestId('led-main-power-toggle')).toHaveAttribute(
        'aria-pressed',
        'false',
    );
});
