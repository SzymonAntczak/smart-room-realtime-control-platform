import { expect, test } from '@playwright/test';

import {
    configureMockHistory,
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createDeviceUpdatedMessage,
    createOnlineLedDeviceProjection,
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

test('shows sensor telemetry alongside retained history scoped to that sensor', async ({
    page,
}) => {
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.devices.push(createOnlineTemperatureDeviceProjection());
    await setMockRoomSnapshot(page.request, snapshot);
    const older = {
        ...createAvailabilityHistoryItem(1, 'offline'),
        occurredAt: '2026-09-19T10:00:00Z',
    };
    const newer = {
        ...createAvailabilityHistoryItem(2, 'online'),
        occurredAt: '2026-09-20T10:00:00Z',
    };
    const ledEntry = createPowerHistoryItem(3, '2026-09-21T10:00:00Z', 3, 'on');
    await configureMockHistory(page.request, {
        pages: [createHistoryPage([ledEntry, newer, older])],
        queries: [
            { criteria: { deviceId: 'temp-desk' }, pages: [createHistoryPage([newer, older])] },
            {
                criteria: { deviceId: 'temp-desk', from: '2026-09-20T00:00:00Z' },
                pages: [createHistoryPage([newer])],
            },
        ],
    });
    const requests: URL[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());

        if (url.pathname === '/room/history/user-history') {
            requests.push(url);
        }
    });
    await page.goto('/device-details/temp-desk');
    await expect(page.getByRole('img', { name: 'Wykres temperatury w czasie' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Pomiary temperatury' })).toBeVisible();
    const history = page.getByRole('region', { name: 'Przewijana historia zdarzeń urządzenia' });
    await expect(history.getByTestId(`history-item-${older.recordId}`)).toBeVisible();
    await expect(history.getByTestId(`history-item-${newer.recordId}`)).toBeVisible();
    await expect(history.getByTestId(`history-item-${ledEntry.recordId}`)).toHaveCount(0);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    const initialRequestCount = requests.length;
    expect(initialRequestCount).toBeGreaterThan(0);
    await page.getByLabel('Od', { exact: true }).fill('2026-09-20');
    expect(requests).toHaveLength(initialRequestCount);
    await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
    await expect(history.getByTestId(`history-item-${newer.recordId}`)).toBeVisible();
    await expect(history.getByTestId(`history-item-${older.recordId}`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await expect(history.getByTestId(`history-item-${older.recordId}`)).toBeVisible();
    expect(requests.every((url) => url.searchParams.get('deviceId') === 'temp-desk')).toBe(true);
    await expect(page.getByRole('table', { name: 'Pomiary temperatury' })).toBeVisible();
});

test('filters LED history by dates and clears back to its automatically loaded device history', async ({
    page,
}) => {
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.platform.storage = {
        ...snapshot.platform.storage,
        status: 'available',
        historyGenerationId: 'mock-history-generation',
        storedThroughSequence: 10000,
    };
    await setMockRoomSnapshot(page.request, snapshot);
    const older = createPowerHistoryItem(1, '2026-06-07T09:00:00Z', 1, 'on');
    const newer = createPowerHistoryItem(2, '2026-06-08T09:00:00Z', 2, 'off');
    await configureMockHistory(page.request, {
        pages: [createHistoryPage([newer, older])],
        queries: [
            {
                criteria: { deviceId: 'led-main', from: '2026-06-08T00:00:00Z' },
                pages: [createHistoryPage([newer])],
            },
        ],
    });
    const requests: URL[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());

        if (url.pathname === '/room/history/user-history') {
            requests.push(url);
        }
    });
    await page.goto('/device-details/led-main');
    const history = page.getByRole('region', { name: 'Przewijana historia zdarzeń urządzenia' });
    await expect(history.getByTestId(`history-item-${older.recordId}`)).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveCount(0);
    const initialRequests = requests.length;
    expect(initialRequests).toBeGreaterThan(0);
    await page.getByLabel('Od', { exact: true }).fill('2026-06-08');
    expect(requests).toHaveLength(initialRequests);
    await page.getByRole('button', { name: 'Szukaj', exact: true }).click();
    await expect(history.getByTestId(`history-item-${newer.recordId}`)).toBeVisible();
    await expect(history.getByTestId(`history-item-${older.recordId}`)).toHaveCount(0);
    expect(requests.at(-1)?.searchParams.get('from')).toBe('2026-06-08T00:00:00Z');
    await page.getByLabel('Od', { exact: true }).fill('2026-06-09');
    const refreshed = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/room/history/user-history',
    );
    await page.getByRole('button', { name: 'Odśwież wyniki' }).click();
    await refreshed;
    await expect(history.getByTestId(`history-item-${newer.recordId}`)).toBeVisible();
    expect(requests.at(-1)?.searchParams.get('from')).toBe('2026-06-08T00:00:00Z');
    await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    await expect(history.getByTestId(`history-item-${older.recordId}`)).toBeVisible();
    await expect(page.getByLabel('Od', { exact: true })).toHaveValue('');
    expect(requests.at(-1)?.searchParams.has('from')).toBe(false);
    expect(requests.every((url) => url.searchParams.get('deviceId') === 'led-main')).toBe(true);
});

test('opens LED details from the accessible icon and presents only paged events for that device', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.devices.push(createOnlineTemperatureDeviceProjection());
    await setMockRoomSnapshot(page.request, snapshot);

    const ledEvents = createHistoryItems(50);
    const temperatureEvent = createAvailabilityHistoryItem(80, 'offline');
    const olderLedEvent = createPowerHistoryItem(101, '2026-06-07T09:00:00Z', 101, 'on');
    const firstPage = [...ledEvents.slice(0, 49), temperatureEvent].sort(
        (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    );
    await configureMockHistory(page.request, {
        pages: [createHistoryPage(firstPage, 'older-cursor'), createHistoryPage([olderLedEvent])],
        queries: [
            {
                criteria: { deviceId: 'led-main' },
                pages: [
                    createHistoryPage(ledEvents, 'device-older'),
                    createHistoryPage([olderLedEvent]),
                ],
            },
        ],
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

    const scrollRegion = page.getByRole('region', {
        name: 'Przewijana historia zdarzeń urządzenia',
    });
    await expect(scrollRegion).toBeVisible();
    expect((await scrollRegion.boundingBox())?.height).toBeGreaterThan(500);
    await expect(page.getByRole('button', { name: 'Wczytaj starsze wpisy' })).toHaveCount(0);
    const olderPageRequest = page.waitForRequest((request) => {
        const url = new URL(request.url());

        return (
            url.pathname === '/room/history/user-history' &&
            url.searchParams.get('cursor') === 'device-older'
        );
    });
    await scrollRegion.press('End');
    await olderPageRequest;
    const olderEvent = page.getByTestId(`history-item-${olderLedEvent.recordId}`);
    await expect(olderEvent).toBeVisible();
    await expect(olderEvent).toHaveAttribute('aria-setsize', '51');
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
    const eventHistoryHeading = page.getByRole('heading', {
        name: 'Historia zdarzeń urządzenia',
    });
    await expect(eventHistoryHeading).toBeVisible();
    await page.reload();
    await expect(eventHistoryHeading).toBeVisible();
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

for (const width of [1440, 390]) {
    test(
        'reuses SSE across routes and loads exactly one device-history page per scroll at ' +
            width +
            'px',
        async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await resetMockRoom(page.request);
            const snapshot = createOnlineLedRoomSnapshot();
            snapshot.platform.storage = {
                ...snapshot.platform.storage,
                status: 'available',
                historyGenerationId: 'mock-history-generation',
                storedThroughSequence: 10000,
            };
            await setMockRoomSnapshot(page.request, snapshot);
            const records = createHistoryItems(100);
            await configureMockHistory(page.request, {
                pages: [
                    createHistoryPage(records.slice(0, 50), 'older'),
                    createHistoryPage(records.slice(50)),
                ],
            });
            const streams: string[] = [];
            const cursors: (string | null)[] = [];
            page.on('request', (request) => {
                const url = new URL(request.url());

                if (url.pathname === '/room/realtime') {
                    streams.push(request.url());
                }
            });
            page.on('requestfinished', (request) => {
                const url = new URL(request.url());

                if (
                    url.pathname === '/room/history/user-history' &&
                    url.searchParams.get('deviceId') === 'led-main'
                ) {
                    cursors.push(url.searchParams.get('cursor'));
                }
            });
            await page.goto('/');
            const link = page.getByRole('link', { name: /LED$/ });
            await expect(link).toBeVisible();
            const established = streams.length;
            await link.click();
            await expect(page).toHaveURL(/device-details/);
            await expect(page.getByRole('heading', { level: 1, name: /LED$/ })).toBeVisible();
            const region = page.getByRole('region', { name: /historia.*urz/ });
            await expect(region.getByTestId('history-item-' + records[0]?.recordId)).toBeVisible();
            await expect.poll(() => cursors).toEqual([null]);
            expect(streams).toHaveLength(established);
            // Programmatic layout/scroll changes do not express a paging action.
            await region.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
            await expect(region.getByTestId('history-item-' + records[49]?.recordId)).toBeVisible();
            expect(cursors).toEqual([null]);
            await region.press('End');
            await expect.poll(() => cursors.length).toBe(2);
            expect(cursors).toEqual([null, 'older']);
            const live = createPowerHistoryItem(10001, '2026-09-21T10:00:00Z', 10001, 'on');
            const changed = {
                ...createOnlineLedDeviceProjection(),
                availability: 'offline' as const,
                commandAvailability: { policy: 'block' as const, reason: 'device_offline' },
                reportedState: { power: 'on' },
                availabilityReason: 'transport_disconnected',
                availabilityChangedAt: live.occurredAt,
            };
            await publishMockRoomUpdate(
                page.request,
                createDeviceUpdatedMessage(0, changed, [live], live.occurredAt),
            );
            await expect(page.getByRole('heading', { level: 1, name: /LED$/ })).toBeVisible();
            await expect(page.getByText('Offline', { exact: true })).toBeVisible();
            await expect(region.getByTestId('history-item-' + live.recordId)).toHaveCount(0);
            expect(cursors).toHaveLength(2);
            await page.getByRole('link', { name: /Dashboard/ }).click();
            await expect(page.getByRole('link', { name: /LED$/ })).toBeVisible();
            expect(streams).toHaveLength(established);
        },
    );
}
