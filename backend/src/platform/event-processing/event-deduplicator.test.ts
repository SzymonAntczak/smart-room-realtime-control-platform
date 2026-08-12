import { describe, expect, it } from 'vitest';

import { createEventDeduplicator } from './event-deduplicator';

describe('createEventDeduplicator', () => {
    it.each([
        ['negative retention', { retentionMs: -1 }],
        ['non-finite retention', { retentionMs: Number.POSITIVE_INFINITY }],
        ['zero entry limit', { entryLimit: 0 }],
        ['fractional entry limit', { entryLimit: 1.5 }],
    ])('rejects %s', (_label, config) => {
        expect(() =>
            createEventDeduplicator({
                clock: { now: () => '2026-06-08T09:30:00Z' },
                ...config,
            }),
        ).toThrow();
    });

    it('rejects an invalid clock timestamp before processing an event', () => {
        const deduplicator = createEventDeduplicator({
            clock: { now: () => 'not-a-timestamp' },
        });

        expect(() => deduplicator.check('evt-1')).toThrow(
            'Event deduplication clock returned an invalid ISO timestamp.',
        );
    });

    it('forgets an event ID when its retention window expires', () => {
        let currentTime = '2026-06-08T09:30:00Z';
        const deduplicator = createEventDeduplicator({
            clock: { now: () => currentTime },
            retentionMs: 1_000,
        });

        deduplicator.remember('evt-1');
        currentTime = '2026-06-08T09:30:00.999Z';
        expect(deduplicator.check('evt-1').isDuplicate).toBe(true);

        currentTime = '2026-06-08T09:30:01Z';
        expect(deduplicator.check('evt-1').isDuplicate).toBe(false);
    });

    it('evicts the oldest remembered IDs when the entry limit is exceeded', () => {
        let currentTime = '2026-06-08T09:30:00Z';
        const deduplicator = createEventDeduplicator({
            clock: { now: () => currentTime },
            entryLimit: 2,
        });

        deduplicator.remember('evt-1');
        currentTime = '2026-06-08T09:30:01Z';
        deduplicator.remember('evt-2');
        currentTime = '2026-06-08T09:30:02Z';

        expect(deduplicator.remember('evt-3')).toEqual(['evt-1']);
        expect(deduplicator.check('evt-1').isDuplicate).toBe(false);
        expect(deduplicator.check('evt-2').isDuplicate).toBe(true);
        expect(deduplicator.check('evt-3').isDuplicate).toBe(true);
    });
});
