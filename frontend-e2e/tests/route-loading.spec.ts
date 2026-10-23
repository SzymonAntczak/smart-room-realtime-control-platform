import { expect, test } from '@playwright/test';

import {
    configureMockHistory,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import { createOnlineLedRoomSnapshot } from './mock-bff/mock-bff-fixtures';
import { createHistoryPage } from './mock-bff/recent-feed-fixtures';

const detailsModule = '**/pages/device-details/DeviceDetails.tsx*';

test.beforeEach(async ({ request }) => {
    await resetMockRoom(request);
    await setMockRoomSnapshot(request, createOnlineLedRoomSnapshot());
    await configureMockHistory(request, { pages: [createHistoryPage([])] });
});

test('defers details until navigation and keeps the current page and SSE during its import', async ({
    page,
}) => {
    let release: () => void = () => {
        throw new Error('Import gate is not initialized.');
    };

    const pending = new Promise<void>((resolve) => {
        release = resolve;
    });
    const moduleRequests: string[] = [];
    const streamRequests: string[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());

        if (url.pathname.endsWith('/DeviceDetails.tsx')) {
            moduleRequests.push(request.url());
        }

        if (url.pathname === '/room/realtime') {
            streamRequests.push(request.url());
        }
    });
    await page.route(detailsModule, async (route) => {
        await pending;
        await route.continue();
    });
    await page.goto('/');
    const detailsLink = page.getByRole('link', { name: /Szczegóły urządzenia/ });
    await expect(detailsLink).toBeVisible();
    expect(moduleRequests).toHaveLength(0);
    expect(streamRequests).toHaveLength(1);
    await detailsLink.click();
    await expect(page.getByRole('status').filter({ hasText: /Ładowanie strony/ })).toBeVisible();
    await expect(detailsLink).toBeVisible();
    expect(moduleRequests).toHaveLength(1);
    expect(streamRequests).toHaveLength(1);
    release();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Szczegóły');
    await expect(page.getByRole('status').filter({ hasText: /Ładowanie strony/ })).toHaveCount(0);
    expect(streamRequests).toHaveLength(1);
    await page.getByRole('link', { name: /Wróć/ }).click();
    await expect(detailsLink).toBeVisible();
    expect(streamRequests).toHaveLength(1);
    expect(moduleRequests).toHaveLength(1);
});

test('offers a full-page reload after a failed direct route import and recovers', async ({
    page,
}) => {
    await page.route(detailsModule, (route) => route.abort('failed'));
    await page.goto('/device-details/led-main');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Nie udało');
    await page.unroute(detailsModule);
    const reload = page.waitForEvent('domcontentloaded');
    await page.getByRole('link', { name: /Odśwież/ }).click();
    await reload;
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Szczegóły');
    await expect(page.getByRole('alert')).toHaveCount(0);
});
