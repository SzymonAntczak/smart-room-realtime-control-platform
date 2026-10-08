import { expect, test } from '@playwright/test';

import {
    configureMockHistory,
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createOnlineLedRoomSnapshot,
    createOnlineTemperatureDeviceProjection,
    createTemperatureDeviceUpdatedMessage,
} from './mock-bff/mock-bff-fixtures';
import { createAvailabilityHistoryItem, createHistoryPage } from './mock-bff/recent-feed-fixtures';
import { expandHistory, historyEntry, openHistory } from './page-objects/history';

test.use({ timezoneId: 'UTC' });

for (const width of [1440, 390]) {
    test(
        'AC-2/AC-4 retains sensor history after reload and isolates search until Refresh at ' +
            width +
            'px',
        async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await resetMockRoom(page.request);
            const offline = createAvailabilityHistoryItem(1, 'offline');
            const online = createAvailabilityHistoryItem(2, 'online');
            const snapshot = createOnlineLedRoomSnapshot();
            snapshot.devices.push(createOnlineTemperatureDeviceProjection());
            snapshot.userHistory = [online, offline];
            snapshot.platform.storage = {
                ...snapshot.platform.storage,
                status: 'available',
                historyGenerationId: 'mock-history-generation',
                storedThroughSequence: 10000,
            };
            await setMockRoomSnapshot(page.request, snapshot);
            await configureMockHistory(page.request, {
                pages: [createHistoryPage([], 'sparse'), createHistoryPage([online, offline])],
            });
            await openHistory(page);
            await expect(historyEntry(page, offline.recordId)).toBeVisible();
            await expect(historyEntry(page, online.recordId)).toHaveRole('listitem');
            await page.reload();
            await expandHistory(page);
            await expect(historyEntry(page, offline.recordId)).toBeVisible();
            await expect(historyEntry(page, online.recordId)).toBeVisible();

            await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            await dialog.getByRole('combobox').selectOption('temp-desk');
            await dialog.getByRole('button', { name: 'Szukaj', exact: true }).click();
            const result = (id: string) => dialog.getByTestId('history-item-' + id);
            await expect(result(offline.recordId)).toBeVisible();
            await expect(result(online.recordId)).toHaveRole('listitem');
            const searchRequests: string[] = [];
            page.on('request', (request) => {
                if (
                    request.url().includes('/room/history/user-history') &&
                    new URL(request.url()).searchParams.has('deviceId')
                ) {
                    searchRequests.push(request.url());
                }
            });
            const latest = createAvailabilityHistoryItem(3, 'offline');
            await configureMockHistory(page.request, {
                pages: [createHistoryPage([latest, online, offline])],
            });
            const device = {
                ...createOnlineTemperatureDeviceProjection(),
                availability: 'offline' as const,
                availabilityReason: 'transport_disconnected',
                availabilityChangedAt: latest.occurredAt,
            };
            await publishMockRoomUpdate(
                page.request,
                createTemperatureDeviceUpdatedMessage(0, device, [latest], latest.occurredAt),
            );
            const sidebar = page.getByRole('region', { name: /Przewijana/, includeHidden: true });
            await expect(sidebar.getByTestId('history-item-' + latest.recordId)).toHaveRole(
                'listitem',
            );
            await expect(result(latest.recordId)).toHaveCount(0);
            await expect(result(offline.recordId)).toBeVisible();
            expect(searchRequests).toEqual([]);
            await dialog.getByRole('button', { name: /^Od.*wyniki$/i }).click();
            await expect(result(latest.recordId)).toBeVisible();
            await expect(result(online.recordId)).toBeVisible();
            await expect(result(offline.recordId)).toBeVisible();
            expect(searchRequests).toHaveLength(1);
            const lowerBoundary = {
                ...createAvailabilityHistoryItem(4, 'online'),
                occurredAt: '2026-09-20T00:00:00.000Z',
            };
            const upperBoundary = {
                ...createAvailabilityHistoryItem(5, 'offline'),
                occurredAt: '2026-09-21T00:00:00.000Z',
            };
            const beforeRange = {
                ...createAvailabilityHistoryItem(6, 'offline'),
                occurredAt: '2026-09-19T23:59:59.999Z',
            };
            await configureMockHistory(page.request, {
                pages: [
                    createHistoryPage([
                        upperBoundary,
                        latest,
                        online,
                        offline,
                        lowerBoundary,
                        beforeRange,
                    ]),
                ],
            });
            await dialog.getByLabel('Od', { exact: true }).fill('2026-09-20');
            await dialog.getByLabel('Do', { exact: true }).fill('2026-09-20');
            await dialog.getByRole('button', { name: 'Szukaj', exact: true }).click();
            await expect(result(lowerBoundary.recordId)).toBeVisible();
            await expect(result(online.recordId)).toBeVisible();
            await expect(result(upperBoundary.recordId)).toHaveCount(0);
            await expect(result(beforeRange.recordId)).toHaveCount(0);
        },
    );
}
