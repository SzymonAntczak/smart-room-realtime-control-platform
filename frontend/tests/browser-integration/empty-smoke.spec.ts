import { expect, test } from '@playwright/test';

test('starts the frontend integration test suite', async ({ page }) => {
    const realtimeRequest = page.waitForRequest('http://127.0.0.1:4311/room/realtime');

    await page.goto('/');

    await expect(page).toHaveTitle('Smart Room Control');
    await expect(page.locator('#root')).not.toBeEmpty();
    await realtimeRequest;

    const commandResponse = await page.request.post('http://127.0.0.1:4311/room/commands', {
        data: {
            commandType: 'set.power',
            deviceId: 'led-main',
            requestedState: { power: 'on' },
        },
    });

    await expect(commandResponse).toBeOK();
    expect(commandResponse.status()).toBe(202);
    await expect(commandResponse.json()).resolves.toEqual({
        commandId: 'mock-command-1',
        status: 'accepted',
    });
});
