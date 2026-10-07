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
} from './page-objects/history';

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
        const olderCursors = new Set<string>();
        page.on('request', (request) => {
            const cursor = new URL(request.url()).searchParams.get('cursor');

            if (cursor?.startsWith('range-')) {
                olderCursors.add(cursor);
            }
        });
        await openHistory(page);
        await expect(historyEntry(page, records[0]?.recordId ?? 'missing')).toBeVisible();
        const root = historyPanel(page);
        await root.focus();

        for (let index = 1; index < 20; index += 1) {
            await scrollToHistoryEntry(page, records[index * 50 - 1]?.recordId ?? 'missing');
            await root.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
            await expect.poll(() => olderCursors.has(`range-${index}`)).toBe(true);
            await expect(
                page.getByRole('status').filter({ hasText: 'Ładowanie historii' }),
            ).toHaveCount(0);
            await assertBoundedRows(page);
        }

        await root.evaluate((element) => {
            element.scrollTop = element.scrollHeight;
        });
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
        const anchorBounds = await anchor.boundingBox();
        const rootBounds = await root.boundingBox();
        expect(anchorBounds).not.toBeNull();
        expect(rootBounds).not.toBeNull();
        await root.evaluate(
            (element, bounds) => {
                if (!bounds) {
                    return;
                }

                const targetBottom = bounds.rootY + 20;
                element.scrollTop += bounds.anchorBottom - targetBottom;
            },
            {
                anchorBottom: (anchorBounds?.y ?? 0) + (anchorBounds?.height ?? 0),
                rootY: rootBounds?.y ?? 0,
            },
        );

        await expect
            .poll(async () => {
                const entryBounds = await anchor.boundingBox();
                const containerBounds = await root.boundingBox();

                return entryBounds && containerBounds
                    ? Math.abs(entryBounds.y + entryBounds.height - (containerBounds.y + 20))
                    : Number.POSITIVE_INFINITY;
            })
            .toBeLessThanOrEqual(2);
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

for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
]) {
    test(`keeps keyboard focus through automatic paging and retains the footer controls at ${viewport.width}px`, async ({
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
        await root.evaluate((element) => {
            element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight * 3);
        });
        await expect
            .poll(async () => {
                const control = (await (
                    await page.request.get(mockBffUrls.historyControl)
                ).json()) as { held: boolean };

                if (!control.held) {
                    await root.evaluate((element) => {
                        element.scrollTop += element.clientHeight / 8;
                    });
                }

                return control.held;
            })
            .toBe(true);
        expect(await root.evaluate((element) => element.scrollTop)).toBeLessThan(
            await root.evaluate((element) => element.scrollHeight - element.clientHeight),
        );
        expect(olderRequests).toBe(1);
        await expect(root).toBeFocused();
        await configureMockHistory(page.request, { release: true });
        await expect(
            page.getByRole('status').filter({ hasText: 'Koniec dostępnego zakresu historii.' }),
        ).toBeVisible();
        await expect(root).toBeFocused();
        const newest = page.getByRole('button', { name: 'Na górę', exact: true });
        await newest.focus();
        await newest.press('Enter');
        await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBe(0);
        await newest.press('Enter');
        await expect(page.getByRole('tooltip')).toHaveText('Jesteś już na samej górze');
        await expect(newest).toBeVisible();
        await expect(newest).toBeFocused();
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
}

test('keeps the sidebar frame fixed and shows a temporary top hint while filter remains inactive', async ({
    page,
}) => {
    const records = mixedHistory(100);
    await configureMockHistory(page.request, {
        pages: [
            createHistoryPage(records.slice(0, 50), 'older'),
            createHistoryPage(records.slice(50)),
        ],
    });
    await openHistory(page);
    await page.clock.install();
    const root = historyPanel(page);
    const heading = page.getByRole('heading', { name: 'Historia zdarzeń' });
    const filter = page.getByRole('button', { name: 'Filtruj', exact: true });
    const top = page.getByRole('button', { name: 'Na górę', exact: true });
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    const headingBefore = await heading.boundingBox();
    const filterBefore = await filter.boundingBox();
    const topBefore = await top.boundingBox();
    await root.evaluate((element) => {
        element.scrollTop = element.scrollHeight / 2;
    });
    await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await heading.boundingBox()).toEqual(headingBefore);
    expect(await filter.boundingBox()).toEqual(filterBefore);
    expect(await top.boundingBox()).toEqual(topBefore);

    const requestCount = requests.length;
    await filter.click();
    expect(requests).toHaveLength(requestCount);
    await top.click();
    await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBe(0);
    await top.click();
    await expect(page.getByRole('tooltip')).toHaveText('Jesteś już na samej górze');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await top.click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.clock.fastForward(3000);
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });

    const toggle = page.getByRole('button', { name: /ostatnie zdarzenia/i });
    const sidebarSlot = toggle.locator('xpath=..');
    await toggle.click();

    await expect(root).toBeVisible();
    await expect
        .poll(() => sidebarSlot.evaluate((element) => getComputedStyle(element).transform))
        .toBe('matrix(1, 0, 0, 1, 0, 0)');
    const mobileHeading = await heading.boundingBox();
    const mobileFilter = await filter.boundingBox();
    const mobileTop = await top.boundingBox();
    await root.evaluate((element) => {
        element.scrollTop = element.scrollHeight / 2;
    });
    await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const mobileHeadingAfter = await heading.boundingBox();
    const mobileFilterAfter = await filter.boundingBox();
    const mobileTopAfter = await top.boundingBox();

    expect(Math.abs((mobileHeadingAfter?.y ?? 0) - (mobileHeading?.y ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((mobileFilterAfter?.y ?? 0) - (mobileFilter?.y ?? 0))).toBeLessThanOrEqual(2);
    expect(Math.abs((mobileTopAfter?.y ?? 0) - (mobileTop?.y ?? 0))).toBeLessThanOrEqual(2);
});

test('returns to the newest entries with a smooth animation under normal motion', async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const records = mixedHistory(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');
    const root = historyPanel(page);
    const start = await root.evaluate((element) => {
        const samples: number[] = [];
        element.dataset.scrollSamples = '[]';
        element.addEventListener('scroll', () => {
            samples.push(element.scrollTop);
            element.dataset.scrollSamples = JSON.stringify(samples);
        });

        return element.scrollTop;
    });
    expect(start).toBeGreaterThan(1000);

    await page.getByRole('button', { name: 'Na górę', exact: true }).click();
    await expect.poll(() => root.evaluate((element) => element.scrollTop)).toBe(0);
    const samples = await root.evaluate(
        (element) => JSON.parse(element.dataset.scrollSamples ?? '[]') as number[],
    );
    const intermediatePositions = samples.filter(
        (position) => position > 1 && position < start - 1,
    );
    expect(new Set(intermediatePositions).size).toBeGreaterThanOrEqual(3);
});

test('returns to the newest entries immediately when reduced motion is enabled', async ({
    page,
}) => {
    const records = mixedHistory(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');

    const root = historyPanel(page);
    expect(await root.evaluate((element) => element.scrollTop)).toBeGreaterThan(1);
    await page.getByRole('button', { name: 'Na górę', exact: true }).click();

    expect(await root.evaluate((element) => element.scrollTop)).toBe(0);
});

test('does not reclaim focus after the user clicks nonfocusable content outside history', async ({
    page,
}) => {
    const records = mixedHistory(50);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await scrollToHistoryEntry(page, records[15]?.recordId ?? 'missing');
    await page.getByRole('button', { name: 'Na górę', exact: true }).focus();
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
    await expect(page.getByRole('button', { name: 'Na górę', exact: true })).toBeVisible();
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
            const renderedAreaBottom = rootBox.y + rootBox.height * 2;
            const withinExtendedViewport = boxes.filter(
                (box) => box.bottom > rootBox.y && box.top < renderedAreaBottom,
            ).length;

            return boxes.length - withinExtendedViewport;
        })
        // A short mobile viewport can keep the reading anchor beyond both overscan edges.
        .toBeLessThanOrEqual(12);
    expect(await historyEntries(page).count()).toBeLessThan(40);
}
