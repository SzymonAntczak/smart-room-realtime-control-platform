import { expect, test } from '@playwright/test';

import {
    configureMockHistory,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createOnlineLedRoomSnapshot,
    createOnlineTemperatureDeviceProjection,
} from './mock-bff/mock-bff-fixtures';
import {
    createAvailabilityHistoryItem,
    createHistoryItems,
    createHistoryPage,
    createPowerHistoryItem,
} from './mock-bff/recent-feed-fixtures';

test.use({ timezoneId: 'UTC' });

test('opens LED details from the accessible icon and presents only paged events for that device', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.devices.push(createOnlineTemperatureDeviceProjection());
    await setMockRoomSnapshot(page.request, snapshot);

    const ledEvents = createHistoryItems(49);
    const temperatureEvent = createAvailabilityHistoryItem(80, 'offline');
    const olderLedEvent = createPowerHistoryItem(101, '2026-06-07T09:00:00Z', 101, 'on');
    const firstPage = [...ledEvents, temperatureEvent].sort(
        (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );
    await configureMockHistory(page.request, {
        pages: [createHistoryPage(firstPage, 'older-cursor'), createHistoryPage([olderLedEvent])],
    });

    await page.goto('/');
    await page.evaluate(() => {
        const startViewTransition = document.startViewTransition.bind(document);
        (window as typeof window & { viewTransitionCalls: number }).viewTransitionCalls = 0;
        Object.defineProperty(document, 'startViewTransition', {
            configurable: true,
            value: (callback: () => void) => {
                (window as typeof window & { viewTransitionCalls: number }).viewTransitionCalls +=
                    1;

                return startViewTransition(callback);
            },
        });
    });
    const detailsLink = page.getByRole('link', { name: /Szczegóły urządzenia: Główne LED/ });
    await expect(detailsLink).toBeVisible();
    const pageRequest = page.waitForRequest((request) => {
        const url = new URL(request.url());

        return url.pathname === '/room/history/user-history' && url.searchParams.has('deviceId');
    });
    await detailsLink.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/device-details\/led-main$/);
    expect(
        await page.evaluate(
            () => (window as typeof window & { viewTransitionCalls: number }).viewTransitionCalls,
        ),
    ).toBeGreaterThan(0);
    await expect(
        page.getByRole('heading', { name: /Szczegóły urządzenia: Główne LED/, level: 1 }),
    ).toBeFocused();
    const firstEvent = page.getByTestId(`history-item-${ledEvents[0]?.recordId}`);
    await expect(firstEvent).toBeVisible();
    await pageRequest;
    await expect(page.getByText(/dostępne zachowane wpisy historii użytkownika/i)).toBeVisible();
    await expect(page.getByTestId(`history-item-${temperatureEvent.recordId}`)).toHaveCount(0);

    const scrollRegion = page.getByTestId('led-history-scroll');
    await expect(scrollRegion).toBeVisible();
    expect((await scrollRegion.boundingBox())?.height).toBeGreaterThan(500);
    await expect(page.getByRole('button', { name: 'Wczytaj starsze wpisy' })).toHaveCount(0);
    const olderPageRequest = page.waitForRequest((request) => {
        const url = new URL(request.url());

        return (
            url.pathname === '/room/history/user-history' &&
            url.searchParams.get('cursor') === 'older-cursor'
        );
    });
    await scrollRegion.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await olderPageRequest;
    const olderEvent = page.getByTestId(`history-item-${olderLedEvent.recordId}`);
    await expect(olderEvent).toBeVisible();
    await expect(olderEvent).toHaveAttribute('aria-setsize', '50');
    await expect(
        page.getByRole('status').filter({ hasText: /Koniec dostępnych zachowanych wpisów/ }),
    ).toBeVisible();

    await expect(scrollRegion).toContainText(/Koniec/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('link', { name: 'Wróć do Dashboardu' }).click();
    await expect(page).toHaveURL('/');
    expect(
        await page.evaluate(
            () => (window as typeof window & { viewTransitionCalls: number }).viewTransitionCalls,
        ),
    ).toBeGreaterThan(1);
    const reducedMotionDuration = await page.evaluate(() => {
        const duration = getComputedStyle(
            document.documentElement,
            '::view-transition-new(root)',
        ).animationDuration;

        return duration.endsWith('ms')
            ? Number.parseFloat(duration)
            : Number.parseFloat(duration) * 1000;
    });
    expect(reducedMotionDuration).toBeLessThanOrEqual(1);
    await expect(page.getByRole('main')).toBeFocused();
    await page.reload();
    await expect(
        page.getByRole('link', { name: /Szczegóły urządzenia: Główne LED/ }),
    ).toBeVisible();
});

test('a direct LED details URL survives refresh and an unknown device does not request history', async ({
    page,
}) => {
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    await setMockRoomSnapshot(page.request, snapshot);
    await configureMockHistory(page.request, { pages: [createHistoryPage([])] });

    const historyRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/room/history/user-history')) {
            historyRequests.push(request.url());
        }
    });
    await page.goto('/device-details/unknown-device');
    await expect(page.getByText(/Nie znaleziono urządzenia/)).toBeVisible();
    expect(historyRequests).toEqual([]);

    await page.goto('/device-details/led-main');
    await expect(page.getByRole('heading', { name: /Historia zdarzeń LED/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: /Historia zdarzeń LED/ })).toBeVisible();
    await expect(
        page.getByRole('status').filter({ hasText: /Brak zachowanych wpisów/ }),
    ).toBeVisible();
    expect(historyRequests.length).toBeGreaterThanOrEqual(2);
    expect(
        historyRequests.every((url) => new URL(url).searchParams.get('deviceId') === 'led-main'),
    ).toBe(true);
});

test('browser Back and Forward restore Dashboard and Device Details routes', async ({ page }) => {
    await resetMockRoom(page.request);
    await setMockRoomSnapshot(page.request, createOnlineLedRoomSnapshot());
    await configureMockHistory(page.request, { pages: [createHistoryPage([])] });

    await page.goto('/');
    const deviceDetailsLink = page.locator('a[href="/device-details/led-main"]');
    await expect(deviceDetailsLink).toBeVisible();
    await deviceDetailsLink.click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(deviceDetailsLink).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/device-details\/led-main$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
