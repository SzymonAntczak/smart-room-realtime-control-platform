import { expect, test } from '@playwright/test';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';

import {
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createCommandsUpdatedMessage,
    createConfirmedLedCommand,
    createConfirmedLedDeviceProjection,
    createOnlineLedDeviceProjection,
    createPlatformUpdatedMessage,
    createTemperatureDeviceUpdatedMessage,
} from './mock-bff/mock-bff-fixtures';
import {
    createAcceptedLedCommandProjection,
    createAvailabilityFact,
    createAvailabilityHealthSnapshot,
    createCommandFeedSnapshot,
    createConfirmedFact,
    createDispatchedFact,
    createHealthFact,
    createNoFeedSnapshot,
    createReportedFact,
    createRequestedFact,
    createTemperatureHealthRecovery,
    recentFeedFixtureTimes,
} from './mock-bff/recent-feed-fixtures';
import { RecentFeedDashboard } from './page-objects/recent-feed-dashboard';

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await resetMockRoom(page.request);
});

test('explains availability and health transitions with device, time and reason', async ({
    page,
}) => {
    const dashboard = new RecentFeedDashboard(page);
    const snapshot = createAvailabilityHealthSnapshot();
    const onlineFact = createAvailabilityFact(
        2,
        'offline',
        'online',
        recentFeedFixtureTimes.online,
        2,
    );
    const degradedFact = createHealthFact(
        3,
        'healthy',
        'degraded',
        recentFeedFixtureTimes.degraded,
        3,
    );

    await setMockRoomSnapshot(page.request, snapshot);
    await dashboard.open();

    const offlineDevice = findDevice(snapshot.devices, 'temp-desk');
    const onlineDevice = {
        ...offlineDevice,
        availability: 'online' as const,
        availabilityChangedAt: recentFeedFixtureTimes.online,
        availabilityReason: undefined,
    };

    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(0, onlineDevice, [onlineFact], onlineFact.occurredAt),
    );

    const healthyOnlineDevice = {
        ...onlineDevice,
        health: 'degraded' as const,
        healthChangedAt: recentFeedFixtureTimes.degraded,
        healthReason: 'partial_data',
    };
    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(
            1,
            healthyOnlineDevice,
            [degradedFact],
            degradedFact.occurredAt,
        ),
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(2, 3, '2026-09-10T10:03:01.000Z'),
    );

    const offlineEntry = dashboard.entryContaining('online → offline');
    const onlineEntry = dashboard.entryContaining('offline → online');
    const healthEntry = dashboard.entryContaining('pogorszony');

    await expect(dashboard.feedEntries).toHaveCount(3);
    await expect(dashboard.feedEntries.nth(0)).toContainText(
        'Stan działania zmienił się: prawidłowy → pogorszony.',
    );
    await expect(dashboard.feedEntries.nth(1)).toContainText(
        'Dostępność zmieniła się: offline → online.',
    );
    await expect(dashboard.feedEntries.nth(2)).toContainText(
        'Dostępność zmieniła się: online → offline.',
    );
    await expect(offlineEntry).toContainText('Temperatura biurka');
    await expect(dashboard.eventTime('online → offline')).toHaveAttribute(
        'dateTime',
        recentFeedFixtureTimes.offline,
    );
    await expect(onlineEntry).toContainText('offline');
    await expect(onlineEntry).toContainText('online');
    await expect(onlineEntry).toContainText('Temperatura biurka');
    await expect(dashboard.eventTime('offline → online')).toHaveAttribute(
        'dateTime',
        recentFeedFixtureTimes.online,
    );
    await expect(healthEntry).toContainText('prawidłowy');
    await expect(healthEntry).toContainText('pogorszony');
    await expect(healthEntry).toContainText('Temperatura biurka');
    await expect(dashboard.eventTime('Stan działania zmienił się')).toHaveAttribute(
        'dateTime',
        recentFeedFixtureTimes.degraded,
    );

    await dashboard.eventDetails('offline → online').click();
    await dashboard.eventDetails('Stan działania zmienił się').click();
    await expect(onlineEntry).toContainText('reconnected');
    await expect(healthEntry).toContainText('partial_data');
    await expect(healthEntry).not.toContainText('offline');
    await expect(healthEntry).not.toContainText('online');
    await expect(healthEntry).not.toContainText('Dostępność');
});

test('follows a command from user request through LED report and confirmation', async ({
    page,
}) => {
    const dashboard = new RecentFeedDashboard(page);
    await setMockRoomSnapshot(page.request, createCommandFeedSnapshot());
    await dashboard.open();

    const powerButton = page.getByTestId('led-main-power-toggle');
    await expect(powerButton).toHaveAttribute('aria-pressed', 'false');
    const commandResponse = page.waitForResponse(
        (response) => response.url().includes('/room/commands') && response.status() === 202,
    );
    await powerButton.click();
    await commandResponse;

    const requestFact = createRequestedFact(11, recentFeedFixtureTimes.requested);
    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(0, {
            devices: [{ ...createOnlineLedDeviceProjection(), activeCommandId: 'mock-command-1' }],
            activeCommands: [createAcceptedLedCommandProjection()],
            recentEvents: [requestFact],
            sentAt: requestFact.occurredAt,
        }),
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(1, 1, '2026-09-10T10:01:01.000Z'),
    );

    const requestedEntry = dashboard.entryContaining('Zażądano zasilania');
    await expect(requestedEntry).toBeVisible();
    await expect(requestedEntry).toContainText('Główne LED');
    await expect(dashboard.eventTime('Zażądano zasilania')).toHaveAttribute(
        'dateTime',
        recentFeedFixtureTimes.requested,
    );
    await dashboard.eventDetails('Zażądano zasilania').click();
    await expect(requestedEntry).toContainText('mock-command-1');

    const dispatchedFact = createDispatchedFact(12, recentFeedFixtureTimes.dispatched);
    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(2, {
            devices: [{ ...createOnlineLedDeviceProjection(), activeCommandId: 'mock-command-1' }],
            activeCommands: [
                {
                    ...createAcceptedLedCommandProjection(),
                    status: 'pending',
                    delivery: {
                        status: 'handed_off',
                        dispatchedAt: recentFeedFixtureTimes.dispatched,
                        deadlineAt: '2026-09-10T10:01:06.000Z',
                    },
                },
            ],
            recentEvents: [dispatchedFact],
            sentAt: dispatchedFact.occurredAt,
        }),
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(3, 2, recentFeedFixtureTimes.dispatched),
    );

    const dispatchedEntry = dashboard.entryContaining('Polecenie wysłano');
    await expect(dispatchedEntry).toContainText('Główne LED');
    await expect(dashboard.eventTime('Polecenie wysłano')).toHaveAttribute(
        'dateTime',
        recentFeedFixtureTimes.dispatched,
    );
    await dashboard.eventDetails('Polecenie wysłano').click();
    await expect(dispatchedEntry).toContainText('mock-command-1');
    await expect(powerButton).toBeDisabled();
    await expect(powerButton).toHaveAttribute('aria-pressed', 'false');

    const reportedFact = createReportedFact(13, recentFeedFixtureTimes.reported);
    const confirmedFact = createConfirmedFact(14, recentFeedFixtureTimes.confirmed);
    const confirmedDevice = {
        ...createConfirmedLedDeviceProjection(),
        observationStatus: {
            power: {
                freshness: 'fresh' as const,
                lastObservedAt: recentFeedFixtureTimes.reported,
                durability: 'durable' as const,
            },
        },
    };
    const confirmedCommand = {
        ...createConfirmedLedCommand(),
        requestedAt: recentFeedFixtureTimes.requested,
        delivery: {
            status: 'handed_off' as const,
            dispatchedAt: recentFeedFixtureTimes.dispatched,
            deadlineAt: '2026-09-10T10:01:06.000Z',
        },
        confirmedAt: recentFeedFixtureTimes.confirmed,
    };
    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(4, {
            devices: [confirmedDevice],
            recentCommands: [confirmedCommand],
            recentEvents: [confirmedFact, reportedFact],
            sentAt: recentFeedFixtureTimes.confirmed,
        }),
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(5, 4, recentFeedFixtureTimes.confirmed),
    );

    await expect(dashboard.feedEntries).toHaveCount(4);
    await expect(dashboard.feedEntries.nth(0)).toContainText('Polecenie potwierdzono');
    await expect(dashboard.feedEntries.nth(1)).toContainText('Urządzenie zgłosiło zasilanie');
    await expect(dashboard.feedEntries.nth(2)).toContainText('Polecenie wysłano');
    await expect(dashboard.feedEntries.nth(3)).toContainText('Zażądano zasilania');
    const reportedEntry = dashboard.entryContaining('Urządzenie zgłosiło zasilanie');
    const confirmedEntry = dashboard.entryContaining('Polecenie potwierdzono');
    await expect(reportedEntry).toContainText('Główne LED');
    await expect(confirmedEntry).toContainText('Główne LED');
    await expect(dashboard.eventTime('Urządzenie zgłosiło zasilanie')).toHaveAttribute(
        'dateTime',
        recentFeedFixtureTimes.reported,
    );
    await expect(dashboard.eventTime('Polecenie potwierdzono')).toHaveAttribute(
        'dateTime',
        recentFeedFixtureTimes.confirmed,
    );
    await dashboard.eventDetails('Polecenie potwierdzono').click();
    await expect(confirmedEntry).toContainText('mock-command-1');
    await expect(powerButton).toHaveAttribute('aria-pressed', 'true');
    await expect(powerButton).toBeEnabled();
});

test('keeps telemetry, a no-change late LED report and non-applying facts out of the feed', async ({
    page,
}) => {
    const dashboard = new RecentFeedDashboard(page);
    const snapshot = createNoFeedSnapshot();
    await setMockRoomSnapshot(page.request, snapshot);
    await dashboard.open();

    await expect(dashboard.feedEntries).toHaveCount(2);
    await expect(dashboard.feed).toContainText('Nie otrzymano potwierdzenia polecenia w czasie.');

    const { telemetrySample } = createHistoryIdentityFixtures();
    const liveTelemetry = {
        ...telemetrySample,
        occurredAt: recentFeedFixtureTimes.telemetry,
        storageSequence: 3,
    };
    const temperatureDevice = findDevice(snapshot.devices, 'temp-desk');
    await publishMockRoomUpdate(page.request, {
        messageType: 'device.updated',
        previousRevision: 0,
        revision: 1,
        sentAt: liveTelemetry.occurredAt,
        payload: {
            ...temperatureDevice,
            reportedState: { temperature: liveTelemetry.value, temperatureUnit: 'celsius' },
            observationStatus: {
                temperature: {
                    freshness: 'fresh',
                    lastObservedAt: liveTelemetry.occurredAt,
                    durability: 'durable',
                },
            },
        },
        telemetrySample: liveTelemetry,
    });
    await expect(dashboard.temperatureCard.reading).toContainText('22.5');
    await expect(dashboard.feedEntries).toHaveCount(2);

    const noChangeAt = recentFeedFixtureTimes.noChange;
    const ledNoChange = {
        ...createOnlineLedDeviceProjection(),
        observationStatus: {
            power: {
                freshness: 'fresh' as const,
                lastObservedAt: noChangeAt,
                durability: 'durable' as const,
            },
        },
    };
    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(1, ledNoChange, undefined, noChangeAt),
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(2, 6, recentFeedFixtureTimes.watermark),
    );

    const recovery = createTemperatureHealthRecovery();
    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(
            3,
            recovery.device,
            [recovery.event],
            recovery.sentAt,
        ),
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(4, 7, '2026-09-10T10:04:01.000Z'),
    );

    await expect(dashboard.feedEntries).toHaveCount(3);
    await expect(dashboard.feedEntries.nth(0)).toContainText(
        'Stan działania zmienił się: pogorszony → prawidłowy.',
    );
    await expect(dashboard.feedEntries.nth(1)).toContainText(
        'Nie otrzymano potwierdzenia polecenia w czasie.',
    );
    await expect(dashboard.feedEntries.nth(2)).toContainText(
        'Stan działania zmienił się: prawidłowy → pogorszony.',
    );
    await expect(dashboard.feed).toContainText('Nie otrzymano potwierdzenia polecenia w czasie.');
    await expect(dashboard.feed).toContainText(
        'Stan działania zmienił się: prawidłowy → pogorszony.',
    );
    await expect(dashboard.feed).not.toContainText('[object Object]');
    await expect(page.getByTestId('led-main-command-status')).toContainText(
        'Upłynął limit czasu polecenia',
    );
});

function findDevice(
    devices: ReturnType<typeof createAvailabilityHealthSnapshot>['devices'],
    deviceId: string,
) {
    const device = devices.find((candidate) => candidate.deviceId === deviceId);

    if (!device) {
        throw new Error(`Expected device ${deviceId} in the room snapshot.`);
    }

    return device;
}
