import { expect, test } from '@playwright/test';

import {
    configureMockHistory,
    resetMockRoom,
    setMockRoomSnapshot,
} from './mock-bff/mock-bff-control';
import { createOnlineLedRoomSnapshot } from './mock-bff/mock-bff-fixtures';
import { createHistoryItems, createHistoryPage } from './mock-bff/recent-feed-fixtures';
import { historyEntry, openHistory } from './page-objects/history';

test('compiles the history feed and position controller with React Compiler', async ({ page }) => {
    await resetMockRoom(page.request);
    const snapshot = createOnlineLedRoomSnapshot();
    snapshot.platform.storage = {
        ...snapshot.platform.storage,
        status: 'available',
        historyGenerationId: 'mock-history-generation',
        storedThroughSequence: 10000,
    };
    await setMockRoomSnapshot(page.request, snapshot);

    const records = createHistoryItems(10);
    await configureMockHistory(page.request, { pages: [createHistoryPage(records)] });
    await openHistory(page);
    await expect(historyEntry(page, records[0]?.recordId ?? 'missing')).toBeVisible();

    const response = await page.request.get('/__test/react-compiler-evidence');
    expect(response.ok()).toBe(true);
    const events = (await response.json()) as Record<string, string[]>;
    const historyEvents = events['HistoryFeed.tsx']?.map(
        (event) => JSON.parse(event) as { kind: string; fnName?: string },
    );
    const controllerEvents = events['useHistoryVirtualizer.ts']?.map(
        (event) => JSON.parse(event) as { kind: string; fnName?: string },
    );
    expect(historyEvents).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ kind: 'CompileSuccess', fnName: 'HistoryFeed' }),
        ]),
    );
    expect(controllerEvents).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ kind: 'CompileSuccess', fnName: 'useHistoryVirtualizer' }),
        ]),
    );
});
