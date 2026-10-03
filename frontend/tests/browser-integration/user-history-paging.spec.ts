import { expect, type Locator, type Page, test } from '@playwright/test';

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

const heading = 'Ostatnie istotne zdarzenia';
const item = (page: Page, id: string) => page.getByTestId(`history-item-${id}`);
const panel = (page: Page) => page.getByRole('complementary', { name: heading });
const entries = (page: Page) => page.getByRole('region', { name: heading }).getByRole('listitem');

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
        await expect(entries(page)).toHaveCount(50);
        const anchor = item(page, records[15]?.recordId ?? 'missing');
        await expect(anchor).toHaveRole('listitem');
        await anchor.scrollIntoViewIfNeeded();
        const before = await offset(anchor, panel(page));
        const live = createHistoryItems(1, 10001);
        await publishMockRoomUpdate(
            page.request,
            createCommandsUpdatedMessage(0, { userHistory: live }),
        );
        await expect(entries(page)).toHaveCount(51);
        await expect
            .poll(async () => Math.abs((await offset(anchor, panel(page))) - before))
            .toBeLessThanOrEqual(2);
        await expect(
            page.getByRole('button', { name: 'Nowe zdarzenia', exact: true }),
        ).toBeVisible();
        await item(page, records[49]?.recordId ?? 'missing').scrollIntoViewIfNeeded();
        await expect(entries(page)).toHaveCount(71);
        await page.getByRole('button', { name: 'Nowe zdarzenia', exact: true }).click();
        await expect.poll(() => panel(page).evaluate((element) => element.scrollTop)).toBe(0);
    });
}

test('retains the read page when live overlay overflows and refetches when returning to newest', async ({
    page,
}) => {
    const records = createHistoryItems(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await expect(entries(page)).toHaveCount(50);
    const anchor = item(page, records[15]?.recordId ?? 'missing');
    await anchor.scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Nowe zdarzenia', exact: true })).toBeVisible();
    const before = await offset(anchor, panel(page));
    const live = createHistoryItems(201, 10001);

    for (let index = 0, revision = 0; index < live.length; index += 20, revision += 1) {
        await publishMockRoomUpdate(
            page.request,
            createCommandsUpdatedMessage(revision, { userHistory: live.slice(index, index + 20) }),
        );
    }

    await expect(entries(page)).toHaveCount(250);
    await expect
        .poll(async () => Math.abs((await offset(anchor, panel(page))) - before))
        .toBeLessThanOrEqual(2);
    await configureMockHistory(page.request, {
        pages: [createHistoryPage(live.slice(0, 50), null, 10201)],
    });
    const refetch = page.waitForResponse((response) =>
        response.url().includes('/room/history/user-history'),
    );
    await page.getByRole('button', { name: 'Nowe zdarzenia', exact: true }).click();
    await refetch;
    await expect(item(page, records[15]?.recordId ?? 'missing')).toHaveCount(0);
    await expect.poll(() => panel(page).evaluate((element) => element.scrollTop)).toBe(0);
});

test('rebuilds through the previous anchor on reconnect and on cursor expiry', async ({ page }) => {
    const records = createHistoryItems(70);
    const pages = [
        createHistoryPage(records.slice(0, 50), 'older'),
        createHistoryPage(records.slice(50)),
    ];
    await configureMockHistory(page.request, { pages });
    await openHistory(page);
    await expect(entries(page)).toHaveCount(50);
    const anchor = item(page, records[15]?.recordId ?? 'missing');
    await anchor.scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Nowe zdarzenia', exact: true })).toBeVisible();
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
    });
    const expiry = page.waitForResponse(
        (response) => response.url().includes('cursor=older') && response.status() === 400,
    );
    await item(page, records[49]?.recordId ?? 'missing').scrollIntoViewIfNeeded();
    await expiry;
    await expect(entries(page)).toHaveCount(70);
    await expect(page.getByRole('alert')).toHaveCount(0);
});

test('explains an unavailable anchor and does not merge a replacement generation', async ({
    page,
}) => {
    const records = createHistoryItems(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await expect(entries(page)).toHaveCount(50);
    await item(page, records[15]?.recordId ?? 'missing').scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Nowe zdarzenia', exact: true })).toBeVisible();
    await configureMockHistory(page.request, { pages: [createHistoryPage(records.slice(25))] });
    await disconnectMockRealtime(page.request);
    await expect(
        page.getByRole('status').filter({ hasText: 'Poprzedni wpis nie jest dostępny' }),
    ).toBeVisible();
    const replacement = createHistoryItems(1, 20000);
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
    await expect(item(page, records[25]?.recordId ?? 'missing')).toHaveCount(0);
});

test('preserves last-known history on 503 and refetches after availability recovery', async ({
    page,
}) => {
    const records = createHistoryItems(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await expect(entries(page)).toHaveCount(50);
    await configureMockHistory(page.request, {
        status: 503,
        error: { error: 'durable_history_unavailable', message: 'Unavailable' },
    });
    await disconnectMockRealtime(page.request);
    await expect(
        page.getByRole('alert').filter({ hasText: 'Trwała historia jest chwilowo niedostępna.' }),
    ).toBeVisible();
    await expect(entries(page)).toHaveCount(50);
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
    await expect(entries(page)).toHaveCount(51);
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
    await expect(entries(page)).toHaveCount(3);
});

async function openHistory(page: Page) {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
    await expect(toggle).toBeVisible();

    if ((await toggle.getAttribute('aria-expanded')) === 'false') {
        await toggle.click();
    }

    await expect(page.getByRole('region', { name: heading })).toBeVisible();
}

async function offset(entry: Locator, root: Locator) {
    const entryBox = await entry.boundingBox();
    const rootBox = await root.boundingBox();

    if (!entryBox || !rootBox) {
        throw new Error('History geometry unavailable');
    }

    return entryBox.y - rootBox.y;
}
