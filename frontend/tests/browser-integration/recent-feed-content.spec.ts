import { expect, test } from '@playwright/test';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';

import {
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createCommandsUpdatedMessage,
    createConfirmedLedDeviceProjection,
    createDeviceUpdatedMessage,
    createOnlineLedRoomSnapshot,
    createPlatformUpdatedMessage,
} from './mock-bff/mock-bff-fixtures';
import { RecentFeedDashboard } from './page-objects/recent-feed-dashboard';

test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await resetMockRoom(page.request);
});

test('presents user history with device and time without command diagnostics', async ({ page }) => {
    const fixtures = createUserHistoryFixtures();
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.userHistory = [fixtures.timeout];
    snapshot.platform.storage = {
        status: 'available',
        changedAt: snapshot.updatedAt,
        historyGenerationId: 'mock-history-generation',
        storedThroughSequence: 7,
    };
    await setMockRoomSnapshot(page.request, snapshot);
    const dashboard = new RecentFeedDashboard(page);
    await dashboard.open();
    await expect(dashboard.feedEntries).toHaveCount(1);
    await expect(dashboard.feedEntries.first()).toContainText('Główne LED');
    await expect(dashboard.feedEntries.first().getByRole('time')).toHaveAttribute(
        'datetime',
        fixtures.timeout.occurredAt,
    );
    await expect(dashboard.feed.getByText('Szczegóły', { exact: true })).toHaveCount(0);
    await expect(dashboard.feedEntries.first()).not.toContainText(fixtures.timeout.recordId);
});

test('adds one BFF observed change while command progress remains at the control', async ({
    page,
}) => {
    const snapshot = createOnlineLedRoomSnapshot();
    await setMockRoomSnapshot(page.request, snapshot);
    const dashboard = new RecentFeedDashboard(page);
    await dashboard.open();
    await publishMockRoomUpdate(page.request, createCommandsUpdatedMessage(0));
    await expect(dashboard.feedEntries).toHaveCount(0);
    const change = createUserHistoryFixtures().powerChange;
    const device = createConfirmedLedDeviceProjection();

    await publishMockRoomUpdate(
        page.request,
        createDeviceUpdatedMessage(1, { ...device, reportedState: { power: 'on' } }, [change]),
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(2, 7, '2026-09-10T10:00:01.000Z'),
    );
    await expect(dashboard.feedEntries).toHaveCount(1);
    await expect(dashboard.feedEntries.first()).toHaveRole('listitem');
});
