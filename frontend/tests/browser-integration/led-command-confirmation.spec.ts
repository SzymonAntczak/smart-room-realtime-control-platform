import { expect, test } from '@playwright/test';

import { mockBffUrls } from './browser-test-runtime';
import { publishMockRoomUpdate, resetMockRoom } from './mock-bff/mock-bff-control';
import {
    createCommandsUpdatedMessage,
    createConfirmedLedCommand,
    createConfirmedLedDeviceProjection,
    createPendingLedCommand,
    createPendingLedDeviceProjection,
} from './mock-bff/mock-bff-fixtures';
import { LedCard } from './page-objects/led-card';

test('keeps reported LED power unchanged until an accepted command is confirmed by realtime', async ({
    page,
}) => {
    await resetMockRoom(page.request);

    const realtimeRequest = page.waitForRequest(mockBffUrls.realtime);

    await page.goto('/');

    await expect(page).toHaveTitle('Smart Room Control');
    await realtimeRequest;
    const ledCard = new LedCard(page, 'led-main');
    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(ledCard.powerToggle).toBeEnabled();

    const commandResponse = page.waitForResponse(
        (response) => response.url() === mockBffUrls.commands && response.status() === 202,
    );
    await ledCard.powerToggle.click();
    await commandResponse;

    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');

    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(0, {
            device: createPendingLedDeviceProjection(),
            activeCommands: [createPendingLedCommand()],
        }),
    );

    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(ledCard.powerToggle).toBeDisabled();
    await expect(ledCard.commandStatus).toContainText('Zażądano:');

    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(1, {
            device: createConfirmedLedDeviceProjection(),
            recentCommands: [createConfirmedLedCommand()],
        }),
    );

    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(ledCard.powerToggle).toBeEnabled();
});
