import { describe, expect, it } from 'vitest';

import { createEventDeduplicator } from './event-deduplicator';

describe('createEventDeduplicator', () => {
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
