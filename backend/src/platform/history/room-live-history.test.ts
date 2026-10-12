import type { RecentEventProjection } from '@smart-room/contracts/history';
import { describe, expect, it } from 'vitest';

import { mergeRecentEvents } from './room-live-history';

describe('live room history', () => {
    it('promotes an existing volatile record without changing its identity', () => {
        const volatile = gap('rec-1', 'volatile', undefined, '2026-09-10T10:00:00.000Z');
        const durable = gap('rec-1', 'durable', 7, '2026-09-10T10:00:00.000Z');

        expect(mergeRecentEvents([volatile], [durable])).toEqual([durable]);
        expect(mergeRecentEvents([durable], [volatile])).toEqual([durable]);
    });

    it('orders history by event time and record id and keeps the newest twenty entries', () => {
        const entries = Array.from({ length: 21 }, (_, index) =>
            gap(
                `rec-${index}`,
                'volatile',
                undefined,
                new Date(Date.parse('2026-09-10T10:00:00.000Z') + index * 1_000).toISOString(),
            ),
        );

        const merged = mergeRecentEvents([], entries);

        expect(merged).toHaveLength(20);
        expect(merged[0]?.recordId).toBe('rec-20');
        expect(merged.at(-1)?.recordId).toBe('rec-1');
    });
});

function gap(
    recordId: string,
    durability: 'durable' | 'volatile',
    storageSequence: number | undefined,
    occurredAt: string,
): RecentEventProjection {
    const event = {
        recordId,
        eventType: 'storage.gap.recorded' as const,
        occurredAt,
        source: 'backend' as const,
        payload: {
            outageStartedAt: occurredAt,
            outageEndedAt: occurredAt,
            failureReason: 'storage_write_failed',
            boundaryBasis: 'same_process_first_degraded_at' as const,
            observationsBackfilled: false as const,
        },
    };

    if (durability === 'durable') {
        if (storageSequence === undefined) {
            throw new Error('Durable history fixture requires a storage sequence.');
        }

        return { ...event, durability, storageSequence };
    }

    return { ...event, durability };
}
