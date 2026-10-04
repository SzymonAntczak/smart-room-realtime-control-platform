import { expect, test } from '@playwright/test';

import { mockBffUrls } from './browser-test-runtime';
import {
    configureMockHistory,
    disconnectMockRealtime,
    publishMockRoomUpdate,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import {
    createCommandsUpdatedMessage,
    createOnlineLedRoomSnapshot,
    createPlatformUpdatedMessage,
} from './mock-bff/mock-bff-fixtures';
import { createHistoryItems, createHistoryPage } from './mock-bff/recent-feed-fixtures';
import {
    historyEntries as entries,
    historyEntry as item,
    historyOffset as offset,
    historyPanel as panel,
    openHistory,
    scrollToHistoryEntry,
} from './page-objects/user-history';

test.beforeEach(async ({ page }) => {
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.platform.storage = {
        ...snapshot.platform.storage,
        status: 'available',
        historyGenerationId: 'mock-history-generation',
        storedThroughSequence: 10000,
    };
    await setMockRoomSnapshot(page.request, snapshot);
});

for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
]) {
    test(`preserves an older reading position across live additions and another page at ${viewport.width}px`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        const records = createHistoryItems(70);
        await configureMockHistory(page.request, {
            pages: [
                createHistoryPage(records.slice(0, 50), 'older'),
                createHistoryPage(records.slice(50)),
            ],
        });
        await openHistory(page);
        await expect(item(page, records[0]?.recordId ?? 'missing')).toBeVisible();
        const anchor = await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');
        await expect(anchor).toHaveRole('listitem');

        const before = await offset(anchor, panel(page));
        const live = createHistoryItems(1, 10001);
        await publishMockRoomUpdate(
            page.request,
            createCommandsUpdatedMessage(0, { userHistory: live }),
        );
        await expect(anchor).toHaveAttribute('aria-posinset', '17');
        await expect
            .poll(async () => Math.abs((await offset(anchor, panel(page))) - before))
            .toBeLessThanOrEqual(2);
        const newestButton = page.getByRole('button', {
            name: 'Na górę',
            exact: true,
        });
        await expect(newestButton).toBeVisible();
        const buttonBounds = await newestButton.evaluate((element) =>
            element.getBoundingClientRect().toJSON(),
        );
        const panelBounds = await panel(page).evaluate((element) =>
            element.getBoundingClientRect().toJSON(),
        );

        expect(buttonBounds.x + buttonBounds.width).toBeGreaterThan(
            panelBounds.x + panelBounds.width - 64,
        );
        expect(buttonBounds.y + buttonBounds.height).toBeGreaterThan(
            panelBounds.y + panelBounds.height - 64,
        );
        await configureMockHistory(page.request, { hold: true });
        const pageAnchor = await scrollToHistoryEntry(page, records[49]?.recordId ?? 'missing');
        await expect
            .poll(
                async () =>
                    (
                        (await (await page.request.get(mockBffUrls.historyControl)).json()) as {
                            held: boolean;
                        }
                    ).held,
            )
            .toBe(true);
        const beforePage = await offset(pageAnchor, panel(page));
        await configureMockHistory(page.request, { release: true });
        await expect(item(page, records[49]?.recordId ?? 'missing')).toHaveAttribute(
            'aria-setsize',
            '71',
        );
        await expect
            .poll(async () => Math.abs((await offset(pageAnchor, panel(page))) - beforePage))
            .toBeLessThanOrEqual(2);
        await page.getByRole('button', { name: 'Na górę', exact: true }).click();
        await expect.poll(() => panel(page).evaluate((element) => element.scrollTop)).toBe(0);
    });
}

test('retains the read page when live overlay overflows and refetches when returning to newest', async ({
    page,
}) => {
    const records = createHistoryItems(150);
    await configureMockHistory(page.request, {
        pages: [
            createHistoryPage(records.slice(0, 50), 'range-1'),
            createHistoryPage(records.slice(50, 100), 'range-2'),
            createHistoryPage(records.slice(100)),
        ],
    });
    await openHistory(page);
    await expect(item(page, records[0]?.recordId ?? 'missing')).toBeVisible();
    const root = panel(page);

    for (const cursor of ['range-1', 'range-2']) {
        const nextPage = page.waitForResponse((response) =>
            response.url().includes(`cursor=${cursor}`),
        );
        await root.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
        await nextPage;
    }

    const anchor = await scrollToHistoryEntry(page, records[120]?.recordId ?? 'missing');

    await expect(page.getByRole('button', { name: 'Na górę', exact: true })).toBeVisible();
    const before = await offset(anchor, panel(page));
    const live = createHistoryItems(201, 10001);

    for (let index = 0, revision = 0; index < live.length; index += 20, revision += 1) {
        await publishMockRoomUpdate(
            page.request,
            createCommandsUpdatedMessage(revision, { userHistory: live.slice(index, index + 20) }),
        );
    }

    await expect(anchor).toHaveAttribute('aria-setsize', '350');
    await expect
        .poll(async () => Math.abs((await offset(anchor, panel(page))) - before))
        .toBeLessThanOrEqual(2);
    await configureMockHistory(page.request, {
        pages: [
            createHistoryPage(live.slice(0, 50), 'newer-1', 10201),
            createHistoryPage(live.slice(50, 100), 'newer-2', 10201),
            createHistoryPage(records.slice(100), null, 10201),
        ],
        hold: true,
    });
    const refetchRequests: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/room/history/user-history')) {
            refetchRequests.push(request.url());
        }
    });
    const refetch = page.waitForResponse((response) =>
        response.url().includes('/room/history/user-history'),
    );
    await page.getByRole('button', { name: 'Na górę', exact: true }).click();
    await expect
        .poll(
            async () =>
                (
                    (await (await page.request.get(mockBffUrls.historyControl)).json()) as {
                        held: boolean;
                    }
                ).held,
        )
        .toBe(true);
    await configureMockHistory(page.request, { release: true });
    await refetch;
    await expect(item(page, records[120]?.recordId ?? 'missing')).toHaveCount(0);
    await expect.poll(() => panel(page).evaluate((element) => element.scrollTop)).toBe(0);
    expect(refetchRequests).toHaveLength(1);
    await expect(
        page.getByRole('status').filter({ hasText: 'Poprzedni wpis nie jest dostępny' }),
    ).toHaveCount(0);
});

test('rebuilds through the previous anchor on reconnect and on cursor expiry', async ({ page }) => {
    const records = createHistoryItems(70);
    const pages = [
        createHistoryPage(records.slice(0, 50), 'older'),
        createHistoryPage(records.slice(50)),
    ];
    await configureMockHistory(page.request, { pages });
    await openHistory(page);
    await expect(item(page, records[0]?.recordId ?? 'missing')).toBeVisible();
    const anchor = await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');

    await expect(page.getByRole('button', { name: 'Na górę', exact: true })).toBeVisible();
    const before = await offset(anchor, panel(page));
    const rebuilt = page.waitForResponse(
        (response) =>
            response.url().includes('/room/history/user-history') && response.status() === 200,
    );
    await disconnectMockRealtime(page.request);
    await rebuilt;
    await expect
        .poll(async () => Math.abs((await offset(anchor, panel(page))) - before))
        .toBeLessThanOrEqual(2);
    await expect(
        page.getByText(
            'Wyświetlana jest ostatnio znana historia. Trwałe dane wymagają odświeżenia.',
        ),
    ).toHaveCount(0);
    await configureMockHistory(page.request, {
        status: 400,
        error: { error: 'cursor_expired', message: 'Expired' },
        hold: true,
    });
    const expiry = page.waitForResponse(
        (response) => response.url().includes('cursor=older') && response.status() === 400,
    );
    const expiryAnchor = await scrollToHistoryEntry(page, records[49]?.recordId ?? 'missing');
    await expect
        .poll(
            async () =>
                (
                    (await (await page.request.get(mockBffUrls.historyControl)).json()) as {
                        held: boolean;
                    }
                ).held,
        )
        .toBe(true);
    const beforeExpiry = await offset(expiryAnchor, panel(page));
    await configureMockHistory(page.request, { release: true });
    await expiry;
    await expect(entries(page).first()).toHaveAttribute('aria-setsize', '70');
    await expect
        .poll(async () => Math.abs((await offset(expiryAnchor, panel(page))) - beforeExpiry))
        .toBeLessThanOrEqual(2);
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('explains an unavailable anchor and does not merge a replacement generation', async ({
    page,
}) => {
    const records = createHistoryItems(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await expect(item(page, records[0]?.recordId ?? 'missing')).toBeVisible();
    await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');
    await expect(page.getByRole('button', { name: 'Na górę', exact: true })).toBeVisible();
    await configureMockHistory(page.request, { pages: [createHistoryPage(records.slice(25))] });
    await disconnectMockRealtime(page.request);
    await expect(
        page.getByRole('status').filter({ hasText: 'Poprzedni wpis nie jest dostępny' }),
    ).toBeVisible();
    const replacement = createHistoryItems(1, 20000);
    await page.getByRole('button', { name: 'Na górę', exact: true }).focus();
    const toggle = page.getByRole('button', { name: 'Ukryj ostatnie zdarzenia', exact: true });
    await toggle.focus();
    await configureMockHistory(page.request, {
        pages: [createHistoryPage(replacement, null, 20000, 'replacement')],
    });
    const update = createPlatformUpdatedMessage(0, 20000, '2026-09-29T10:00:00.000Z');
    update.payload.storage = {
        ...update.payload.storage,
        status: 'available',
        historyGenerationId: 'replacement',
        storedThroughSequence: 20000,
    };
    await publishMockRoomUpdate(page.request, update);
    await expect(entries(page)).toHaveCount(1);
    await expect(item(page, replacement[0]?.recordId ?? 'missing')).toBeVisible();
    await expect(toggle).toBeFocused();
    await expect(item(page, records[25]?.recordId ?? 'missing')).toHaveCount(0);
});

test('preserves last-known history on 503 and refetches after availability recovery', async ({
    page,
}) => {
    const records = createHistoryItems(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await expect(item(page, records[0]?.recordId ?? 'missing')).toBeVisible();
    await configureMockHistory(page.request, {
        status: 503,
        error: { error: 'durable_history_unavailable', message: 'Unavailable' },
    });
    await disconnectMockRealtime(page.request);
    await expect(
        page.getByRole('alert').filter({ hasText: 'Trwała historia jest chwilowo niedostępna.' }),
    ).toBeVisible();
    await expect(item(page, records[0]?.recordId ?? 'missing')).toBeVisible();
    const live = createHistoryItems(1, 10001);
    const unavailable = createPlatformUpdatedMessage(0, 10000, '2026-09-29T10:00:00.000Z');
    unavailable.payload.storage = {
        ...unavailable.payload.storage,
        status: 'degraded',
        reason: 'Storage unavailable',
    };
    await publishMockRoomUpdate(page.request, unavailable);
    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(1, { userHistory: live }),
    );
    await expect(item(page, records[0]?.recordId ?? 'missing')).toHaveAttribute(
        'aria-posinset',
        '2',
    );
    const recovery = page.waitForResponse(
        (response) =>
            response.url().includes('/room/history/user-history') && response.status() === 200,
    );
    await publishMockRoomUpdate(
        page.request,
        createPlatformUpdatedMessage(2, 10001, '2026-09-29T10:00:01.000Z'),
    );
    await recovery;
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
        page.getByText(
            'Wyświetlana jest ostatnio znana historia. Trwałe dane wymagają odświeżenia.',
        ),
    ).toHaveCount(0);
});

test('releases a closed panel and ignores its held response when reopened', async ({ page }) => {
    const old = createHistoryItems(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(old)], hold: true });
    await openHistory(page);
    await expect
        .poll(
            async () =>
                (
                    (await (await page.request.get(mockBffUrls.historyControl)).json()) as {
                        held: boolean;
                    }
                ).held,
        )
        .toBe(true);
    await page.getByRole('button', { name: 'Ukryj ostatnie zdarzenia' }).click();
    const replacement = createHistoryItems(1, 20000);
    await configureMockHistory(page.request, {
        pages: [createHistoryPage(replacement, null, 20000)],
        release: true,
    });
    await page.getByRole('button', { name: 'Pokaż ostatnie zdarzenia' }).click();
    await expect(entries(page)).toHaveCount(1);
    await expect(item(page, replacement[0]?.recordId ?? 'missing')).toBeVisible();
    await expect(item(page, old[0]?.recordId ?? 'missing')).toHaveCount(0);
});

test('advances an empty page and keeps invalid data labeled until explicit retry', async ({
    page,
}) => {
    const records = createHistoryItems(2);
    await configureMockHistory(page.request, {
        pages: [createHistoryPage([], 'sparse'), createHistoryPage(records)],
    });
    await openHistory(page);
    await expect(entries(page)).toHaveCount(2);
    await expect(
        page.getByRole('status').filter({ hasText: 'Koniec dostępnego zakresu historii.' }),
    ).toBeVisible();
    let invalidRequests = 0;
    await page.route('**/room/history/user-history?*', async (route) => {
        invalidRequests += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ items: [] }),
        });
    });
    await disconnectMockRealtime(page.request);
    await expect(
        page.getByRole('alert').filter({ hasText: 'Nie udało się odczytać poprawnej historii.' }),
    ).toBeVisible();
    await publishMockRoomUpdate(
        page.request,
        createCommandsUpdatedMessage(0, { userHistory: createHistoryItems(1, 10001) }),
    );
    await expect(entries(page)).toHaveCount(3);
    expect(invalidRequests).toBe(1);
    await page.unroute('**/room/history/user-history?*');
    await page.getByRole('button', { name: 'Spróbuj ponownie', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(panel(page)).toBeFocused();
    await expect(entries(page)).toHaveCount(3);
});
