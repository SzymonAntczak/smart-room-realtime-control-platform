import { expect, test } from '@playwright/test';

import { mockBffUrls } from './browser-test-runtime';
import {
    configureMockCommandResponse,
    isMockCommandResponseHeld,
    publishMockRoomUpdate,
    releaseMockCommandResponse,
    resetMockRoom,
} from './mock-bff/mock-bff-control';
import {
    createCommandsUpdatedMessage,
    createConfirmedLedCommand,
    createConfirmedLedDeviceProjection,
    createPendingLedCommand,
    createPendingLedDeviceProjection,
    createPlatformUpdatedMessage,
    createStorageProjection,
} from './mock-bff/mock-bff-fixtures';
import { LedCard } from './page-objects/led-card';

const recoveryMessage = 'Retry after storage recovery.';

test('keeps controls available with volatile admission while storage is degraded', async ({
    page,
}) => {
    await resetMockRoom(page.request);
    const realtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await page.goto('/');
    await realtimeRequest;

    const ledCard = new LedCard(page, 'led-main');
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            0,
            0,
            '2026-06-08T09:30:01Z',
            createStorageProjection('degraded', 0, '2026-06-08T09:30:01Z'),
        ),
    );

    await expect(page.getByRole('alert')).toContainText('nieutrwalone');
    await expect(page.getByRole('alert')).toContainText('utracone po restarcie');
    await expect(ledCard.powerToggle).toBeEnabled();

    await configureMockCommandResponse(page.request, { outcome: 'volatile-accepted' });
    const commandResponse = page.waitForResponse(
        (response) => response.url() === mockBffUrls.commands && response.status() === 202,
    );
    await ledCard.powerToggle.click();
    const accepted = await commandResponse;
    expect(await accepted.json()).toMatchObject({
        commandId: 'mock-command-1',
        status: 'accepted',
        durability: 'volatile',
        lifecycleDurability: 'volatile',
    });

    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');
    const admission = page.getByRole('group', { name: 'Wynik przyjęcia żądania' });
    await expect(admission).toContainText('Zlecenie');
    await expect(admission).toContainText('dane nieutrwalone');
    await expect(page.getByText('Brak istotnych zdarzeń.')).toBeVisible();

    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(1, {
            devices: [createPendingLedDeviceProjection()],
            activeCommands: [createPendingLedCommand('volatile')],
        }),
    );
    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');

    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(2, {
            devices: [createConfirmedLedDeviceProjection('volatile')],
            recentCommands: [createConfirmedLedCommand('volatile')],
        }),
    );
    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'true');
});

test('disables new commands while recovering and restores idle controls when available', async ({
    page,
}) => {
    await resetMockRoom(page.request);
    const realtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await page.goto('/');
    await realtimeRequest;

    const ledCard = new LedCard(page, 'led-main');
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            0,
            0,
            '2026-06-08T09:30:01Z',
            createStorageProjection('recovering', 0, '2026-06-08T09:30:01Z'),
        ),
    );

    await expect(page.getByRole('alert')).toContainText('chwilowo niedostępne');
    await expect(ledCard.powerToggle).toBeDisabled();
    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');

    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            1,
            0,
            '2026-06-08T09:30:02Z',
            createStorageProjection('available', 0, '2026-06-08T09:30:02Z'),
        ),
    );

    await expect(ledCard.powerToggle).toBeEnabled();
    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');
});

test('does not invent a command or retry when recovering SSE arrives before HTTP 503', async ({
    page,
}) => {
    await page.clock.install({ time: new Date('2026-06-08T09:30:00Z') });
    await resetMockRoom(page.request);
    const requests: string[] = [];
    page.on('request', (request) => {
        if (request.url() === mockBffUrls.commands && request.method() === 'POST') {
            requests.push(request.url());
        }
    });

    const realtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await page.goto('/');
    await realtimeRequest;
    const ledCard = new LedCard(page, 'led-main');
    await configureMockCommandResponse(page.request, { outcome: 'recovering', hold: true });

    const responsePromise = page.waitForResponse(
        (response) => response.url() === mockBffUrls.commands && response.status() === 503,
    );
    await ledCard.powerToggle.click();
    await expect.poll(() => isMockCommandResponseHeld(page.request)).toBe(true);

    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            0,
            0,
            '2026-06-08T09:30:01Z',
            createStorageProjection('recovering', 0, '2026-06-08T09:30:01Z'),
        ),
    );
    await expect(ledCard.powerToggle).toBeDisabled();
    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');
    await releaseMockCommandResponse(page.request);
    const response = await responsePromise;
    expect(await response.json()).toEqual({
        error: 'platform_recovering',
        message: recoveryMessage,
        retryable: true,
    });

    await expect(ledCard.commandStatus).toContainText(recoveryMessage);
    await expect(ledCard.commandStatus).not.toContainText('Zażądano:');
    await expect(ledCard.commandStatus).not.toContainText('dane nieutrwalone');
    await expect(page.getByRole('group', { name: 'Wynik przyjęcia żądania' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Bieżące polecenie' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Ostatni wynik polecenia' })).toHaveCount(0);
    await expect(page.getByText('Brak istotnych zdarzeń.')).toBeVisible();

    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            1,
            0,
            '2026-06-08T09:30:02Z',
            createStorageProjection('available', 0, '2026-06-08T09:30:02Z'),
        ),
    );
    await expect(ledCard.powerToggle).toBeEnabled();
    await page.clock.fastForward(60_000);
    expect(requests).toHaveLength(1);

    await configureMockCommandResponse(page.request, { outcome: 'volatile-accepted' });
    const retryResponsePromise = page.waitForResponse(
        (candidate) => candidate.url() === mockBffUrls.commands && candidate.status() === 202,
    );
    await ledCard.powerToggle.click();
    const retryResponse = await retryResponsePromise;
    expect(await retryResponse.json()).toMatchObject({ commandId: 'mock-command-1' });
    expect(requests).toHaveLength(2);
});

test('does not retry when HTTP 503 arrives before recovering SSE', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-08T09:30:00Z') });
    await resetMockRoom(page.request);
    const requests: string[] = [];
    page.on('request', (request) => {
        if (request.url() === mockBffUrls.commands && request.method() === 'POST') {
            requests.push(request.url());
        }
    });

    const realtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await page.goto('/');
    await realtimeRequest;
    const ledCard = new LedCard(page, 'led-main');
    await configureMockCommandResponse(page.request, { outcome: 'recovering' });

    const responsePromise = page.waitForResponse(
        (response) => response.url() === mockBffUrls.commands && response.status() === 503,
    );
    await ledCard.powerToggle.click();
    const response = await responsePromise;
    expect(await response.json()).toMatchObject({ error: 'platform_recovering' });
    await expect(ledCard.commandStatus).toContainText(recoveryMessage);
    await expect(ledCard.powerToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('group', { name: 'Wynik przyjęcia żądania' })).toHaveCount(0);

    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            0,
            0,
            '2026-06-08T09:30:01Z',
            createStorageProjection('recovering', 0, '2026-06-08T09:30:01Z'),
        ),
    );
    await expect(ledCard.powerToggle).toBeDisabled();
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(
            1,
            0,
            '2026-06-08T09:30:02Z',
            createStorageProjection('available', 0, '2026-06-08T09:30:02Z'),
        ),
    );
    await expect(ledCard.powerToggle).toBeEnabled();
    await page.clock.fastForward(60_000);
    expect(requests).toHaveLength(1);
});
