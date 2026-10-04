import { expect, type Page, test } from '@playwright/test';
import { type DurableUserHistoryItem } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';

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
    historyEntries,
    historyEntry,
    historyOffset,
    historyPanel,
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
    test(`keeps a thousand loaded entries reachable with bounded DOM at ${viewport.width}px`, async ({
        page,
    }) => {
        test.setTimeout(90000);
        await page.setViewportSize(viewport);
        const records = mixedHistory(1000);
        await configureMockHistory(page.request, {
            pages: Array.from({ length: 20 }, (_, index) =>
                createHistoryPage(
                    records.slice(index * 50, (index + 1) * 50),
                    index < 19 ? `range-${index + 1}` : null,
                ),
            ),
        });
        await openHistory(page);
        await expect(historyEntry(page, records[0]?.recordId ?? 'missing')).toBeVisible();
        const root = historyPanel(page);
        await root.focus();

        for (let index = 1; index < 20; index += 1) {
            const response = page.waitForResponse((result) =>
                result.url().includes(`cursor=range-${index}`),
            );
            await root.press('End');
            await response;
            await expect(
                page.getByRole('status').filter({ hasText: 'Ładowanie historii' }),
            ).toHaveCount(0);
            await assertBoundedRows(page);
        }

        await root.press('End');
        const oldest = historyEntry(page, records[999]?.recordId ?? 'missing');
        await expect(oldest).toBeVisible();
        await expect(oldest).toHaveAttribute('aria-posinset', '1000');
        await expect(oldest).toHaveAttribute('aria-setsize', '1000');
        await assertBoundedRows(page);
        await root.press('Home');
        await expect(historyEntry(page, records[0]?.recordId ?? 'missing')).toBeVisible();
        await expect(root).toBeFocused();
        await assertBoundedRows(page);
    });

    test(`preserves mixed-height reading anchors through resize and recovery at ${viewport.width}px`, async ({
        page,
    }) => {
        await page.setViewportSize(viewport);
        const records = mixedHistory(100);
        await configureMockHistory(page.request, {
            pages: [
                createHistoryPage(records.slice(0, 50), 'older'),
                createHistoryPage(records.slice(50)),
            ],
        });
        await openHistory(page);
        const anchor = await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');
        const root = historyPanel(page);
        await root.focus();
        const before = await historyOffset(anchor, root);
        await publishMockRoomUpdate(
            page.request,
            createCommandsUpdatedMessage(0, { userHistory: createHistoryItems(3, 10001) }),
        );
        await expect(anchor).toHaveAttribute('aria-posinset', '19');
        await expect
            .poll(async () => Math.abs((await historyOffset(anchor, root)) - before))
            .toBeLessThanOrEqual(2);
        await expect(root).toBeFocused();
        await page.setViewportSize({ ...viewport, width: viewport.width === 1440 ? 1000 : 540 });
        await expect
            .poll(async () => Math.abs((await historyOffset(anchor, root)) - before))
            .toBeLessThanOrEqual(2);
        await expect(root).toBeFocused();
        const response = page.waitForResponse(
            (result) =>
                result.url().includes('/room/history/user-history') && result.status() === 200,
        );
        await disconnectMockRealtime(page.request);
        await response;
        await expect
            .poll(async () => Math.abs((await historyOffset(anchor, root)) - before))
            .toBeLessThanOrEqual(2);
        await expect(root).toBeFocused();
        await assertBoundedRows(page);
        await page.setViewportSize(viewport);
        await expect
            .poll(async () => Math.abs((await historyOffset(anchor, root)) - before))
            .toBeLessThanOrEqual(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            viewport.width,
        );
    });
}

test('keeps keyboard focus and one older request while loading, then returns focus from disappearing controls', async ({
    page,
}) => {
    const records = mixedHistory(100);
    await configureMockHistory(page.request, {
        pages: [
            createHistoryPage(records.slice(0, 50), 'older'),
            createHistoryPage(records.slice(50)),
        ],
    });
    let olderRequests = 0;
    page.on('request', (request) => {
        if (request.url().includes('cursor=older')) {
            olderRequests += 1;
        }
    });
    await openHistory(page);
    await expect(historyEntry(page, records[0]?.recordId ?? 'missing')).toBeVisible();
    const root = historyPanel(page);
    await root.focus();
    await root.press('PageDown');
    await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(root).toBeFocused();
    await root.press('PageUp');
    await expect(root).toBeFocused();
    await configureMockHistory(page.request, { hold: true });
    const load = page.getByRole('button', { name: 'Wczytaj starsze', exact: true });
    await load.focus();
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
    await expect(load).toBeDisabled();
    await load.press('Enter');
    expect(olderRequests).toBe(1);
    await expect(root).toBeFocused();
    await configureMockHistory(page.request, { release: true });
    await expect(load).toHaveCount(0);
    await expect(root).toBeFocused();
    const newest = page.getByRole('button', { name: 'Nowe zdarzenia', exact: true });
    await newest.focus();
    await newest.press('Enter');
    await expect(newest).toHaveCount(0);
    await expect(root).toBeFocused();
    await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBe(0);
    const toggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toBeFocused();
    await expect(root).toBeHidden();
    await toggle.press('Enter');
    await expect(root).toBeVisible();
    await expect(toggle).toBeFocused();
});

test('does not reclaim focus after the user clicks nonfocusable content outside history', async ({
    page,
}) => {
    const records = mixedHistory(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');
    await page.getByRole('button', { name: 'Nowe zdarzenia', exact: true }).focus();
    await page.getByRole('heading', { name: 'Główne LED', exact: true }).click();
    const root = historyPanel(page);
    await expect(root).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
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
    await expect(historyEntry(page, replacement[0]?.recordId ?? 'missing')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nowe zdarzenia', exact: true })).toHaveCount(0);
    await expect(root).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});

function mixedHistory(count: number): DurableUserHistoryItem[] {
    const fixtures = createUserHistoryFixtures();

    return createHistoryItems(count).map((record, index) => {
        const template = fixtures.items[index % fixtures.items.length] ?? fixtures.failure;
        const item = {
            ...template,
            recordId: record.recordId,
            occurredAt: record.occurredAt,
            storageSequence: record.storageSequence,
        };

        return item.kind === 'history_gap'
            ? {
                  ...item,
                  outageEndedAt: record.occurredAt,
                  outageStartedAt: new Date(Date.parse(record.occurredAt) - 60000).toISOString(),
              }
            : item;
    });
}

async function assertBoundedRows(page: Page) {
    const rootBox = await historyPanel(page).boundingBox();

    if (!rootBox) {
        throw new Error('History viewport unavailable');
    }

    await expect
        .poll(async () => {
            const boxes = await historyEntries(page).evaluateAll((elements) =>
                elements.map((element) => {
                    const bounds = element.getBoundingClientRect();

                    return { top: bounds.top, bottom: bounds.bottom };
                }),
            );
            const visible = boxes.filter(
                (box) => box.bottom > rootBox.y && box.top < rootBox.y + rootBox.height,
            ).length;

            return boxes.length - visible;
        })
        .toBeLessThanOrEqual(11);
    expect(await historyEntries(page).count()).toBeLessThan(40);
}
