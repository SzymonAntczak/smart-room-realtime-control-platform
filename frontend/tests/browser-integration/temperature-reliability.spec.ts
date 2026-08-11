import { expect, test } from '@playwright/test';

import { mockBffUrls } from './browser-test-runtime';
import {
    disconnectMockRealtime,
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createFreshTemperatureAfterRecoveryDeviceProjection,
    createFreshTemperatureDeviceProjection,
    createOfflineTemperatureDeviceProjection,
    createOnlineTemperatureRoomSnapshot,
    createRecoveredTemperatureDeviceProjection,
    createStaleTemperatureDeviceProjection,
    createTemperatureDeviceUpdatedMessage,
} from './mock-bff/mock-bff-fixtures';
import { TemperatureCard } from './page-objects/temperature-card';

test('renders both temperature sensors from a multi-device room snapshot', async ({ page }) => {
    await resetMockRoom(page.request);
    await setMockRoomSnapshot(page.request, createOnlineTemperatureRoomSnapshot());

    const realtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await page.goto('/');
    await realtimeRequest;

    const deskTemperatureCard = new TemperatureCard(page, 'temp-desk');
    const windowTemperatureCard = new TemperatureCard(page, 'temp-window');

    await expect(deskTemperatureCard.card).toBeVisible();
    await expect(deskTemperatureCard.heading).toHaveAccessibleName('Temperatura biurka');
    await expect(windowTemperatureCard.card).toBeVisible();
    await expect(windowTemperatureCard.heading).toHaveAccessibleName('Temperatura okna');
});

test('shows fresh telemetry and keeps the reported temperature visible when it becomes stale', async ({
    page,
}) => {
    await resetMockRoom(page.request);
    await setMockRoomSnapshot(page.request, createOnlineTemperatureRoomSnapshot());
    await page.goto('/');

    const temperatureCard = new TemperatureCard(page, 'temp-desk');
    await expect(temperatureCard.reading).toContainText('22.4');

    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(0, createFreshTemperatureDeviceProjection()),
    );
    await expect(temperatureCard.reading).toContainText('22.8');
    await expectAvailability(temperatureCard, 'Online');

    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(1, createStaleTemperatureDeviceProjection()),
    );
    await expect(temperatureCard.reading).toContainText('22.8');
    await expectAvailability(temperatureCard, 'Online');
    await expect(temperatureCard.alert).toHaveAttribute('role', 'alert');
});

test('keeps the last observation through offline and restores freshness only after a new report', async ({
    page,
}) => {
    await resetMockRoom(page.request);
    await setMockRoomSnapshot(page.request, createOnlineTemperatureRoomSnapshot());
    await page.goto('/');

    const temperatureCard = new TemperatureCard(page, 'temp-desk');

    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(0, createOfflineTemperatureDeviceProjection()),
    );
    await expect(temperatureCard.reading).toContainText('22.8');
    await expectAvailability(temperatureCard, 'Offline');
    await expect(temperatureCard.alert).toHaveAttribute('role', 'alert');

    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(1, createRecoveredTemperatureDeviceProjection()),
    );
    await expect(temperatureCard.reading).toContainText('22.8');
    await expectAvailability(temperatureCard, 'Online');
    await expect(temperatureCard.alert).toHaveAttribute('role', 'alert');

    await publishMockRoomUpdate(
        page.request,
        createTemperatureDeviceUpdatedMessage(
            2,
            createFreshTemperatureAfterRecoveryDeviceProjection(),
        ),
    );
    await expect(temperatureCard.reading).toContainText('23.1');
    await expect(temperatureCard.alert).not.toHaveAttribute('role', 'alert');
});

test('retains the temperature card while the realtime stream reconnects', async ({ page }) => {
    await resetMockRoom(page.request);
    await setMockRoomSnapshot(page.request, createOnlineTemperatureRoomSnapshot());

    const initialRealtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await page.goto('/');
    await initialRealtimeRequest;

    const temperatureCard = new TemperatureCard(page, 'temp-desk');
    await expect(temperatureCard.reading).toContainText('22.4');

    const reconnectedRealtimeRequest = page.waitForRequest(mockBffUrls.realtime);
    await disconnectMockRealtime(page.request);

    await expect(temperatureCard.reading).toContainText('22.4');
    await expect(temperatureCard.alert).toHaveAttribute('role', 'alert');
    await reconnectedRealtimeRequest;
    await expect(temperatureCard.alert).not.toHaveAttribute('role', 'alert');
});

async function expectAvailability(
    temperatureCard: TemperatureCard,
    availability: 'Online' | 'Offline',
): Promise<void> {
    await expect(temperatureCard.status).toHaveAttribute('role', 'status');
    await expect(temperatureCard.status).toHaveText(availability);
}
