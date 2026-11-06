import {
    compareUserHistoryDescending,
    isUserHistoryItem,
    isUserHistoryPage,
    isUserHistoryProjection,
} from '@smart-room/contracts/user-history';
import { describe, expect, it } from 'vitest';

import {
    createAvailabilityHistoryItem,
    createHealthHistoryItem,
    createHistoryItems,
    createHistoryPage,
    createPowerHistoryItem,
} from './recent-feed-fixtures';

describe('browser user-history fixtures', () => {
    it.each([
        ['availability recovery', () => createAvailabilityHistoryItem(1, 'online')],
        ['availability loss', () => createAvailabilityHistoryItem(1, 'offline')],
        [
            'health degradation',
            () => createHealthHistoryItem(1, 'healthy', 'degraded', '2026-09-20T10:00:00Z', 1),
        ],
        [
            'health recovery',
            () => createHealthHistoryItem(1, 'degraded', 'healthy', '2026-09-20T10:00:00Z', 1),
        ],
        ['power on', () => createPowerHistoryItem(1, '2026-09-20T10:00:00Z', 1, 'on')],
        ['power off', () => createPowerHistoryItem(1, '2026-09-20T10:00:00Z', 1, 'off')],
    ] as const)('provides a contract-valid %s fact with canonical time', (_, createItem) => {
        const item = createItem();

        expect(isUserHistoryItem(item)).toBe(true);
        expect(item.occurredAt).toBe(new Date(item.occurredAt).toISOString());
        expect(isUserHistoryProjection([item])).toBe(true);
        expect(isUserHistoryPage(createHistoryPage([item]))).toBe(true);
    });

    it.each([0, 1, 20, 50, 1000])(
        'creates %i deterministic, unique facts in descending feed and page order',
        (count) => {
            const items = createHistoryItems(count);

            expect(items).toEqual(createHistoryItems(count));
            expect(items).toHaveLength(count);
            expect(new Set(items.map((item) => item.recordId)).size).toBe(count);
            expect(new Set(items.map((item) => item.storageSequence)).size).toBe(count);
            expect(items.every(isUserHistoryItem)).toBe(true);
            expect(items).toEqual([...items].sort(compareUserHistoryDescending));
            expect(isUserHistoryProjection(items.slice(0, 20))).toBe(true);

            const pages = Array.from({ length: Math.max(1, Math.ceil(count / 50)) }, (_, index) =>
                createHistoryPage(
                    items.slice(index * 50, (index + 1) * 50),
                    (index + 1) * 50 < count ? `older-${index + 1}` : null,
                ),
            );

            expect(pages.every(isUserHistoryPage)).toBe(true);
            expect(pages.flatMap((page) => page.items)).toEqual(items);
        },
    );

    it('keeps a partial last page and replacement generation within their pinned bounds', () => {
        const items = createHistoryItems(51, 20000);
        const first = createHistoryPage(items.slice(0, 50), 'older', 20050, 'replacement');
        const last = createHistoryPage(items.slice(50), null, 20050, 'replacement');

        expect(isUserHistoryPage(first)).toBe(true);
        expect(isUserHistoryPage(last)).toBe(true);
        expect(first.historyGenerationId).toBe(last.historyGenerationId);
        expect(first.throughSequence).toBe(last.throughSequence);
        expect(first.retentionAsOf).toBe(last.retentionAsOf);
        expect(last.items).toHaveLength(1);
        expect(first.items.at(-1)?.storageSequence).toBeGreaterThan(
            last.items[0]?.storageSequence ?? 0,
        );
    });
});
