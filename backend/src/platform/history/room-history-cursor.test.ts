import { describe, expect, it } from 'vitest';

import { createHistoryCursorCodec } from './room-history-cursor';

describe('createHistoryCursorCodec', () => {
    const secret = Buffer.alloc(32, 7);
    const payload = {
        version: 1 as const,
        scope: {
            dataset: 'raw_telemetry' as const,
            deviceId: 'temp-desk',
            metric: 'temperature' as const,
            from: '2026-09-10T10:00:00Z',
            to: '2026-09-10T10:05:00Z',
            order: 'occurred_at_desc' as const,
            pageSize: 1,
        },
        bounds: {
            historyGenerationId: 'generation-1',
            throughSequence: 4,
            retentionAsOf: '2026-09-10T10:10:00.000Z',
            retentionRevision: 3,
            expiresAt: '2026-09-10T10:15:00.000Z',
        },
        position: {
            occurredAt: '2026-09-10T10:03:00.000Z',
            storageSequence: 4,
        },
    };

    it('round-trips a signed cursor and rejects tampering or a restart secret', () => {
        const codec = createHistoryCursorCodec({ secret });
        const cursor = codec.encode(payload);

        expect(codec.decode(cursor)).toEqual(payload);
        expect(codec.decode(`${cursor}x`)).toBeUndefined();
        expect(codec.decode(`${cursor}!`)).toBeUndefined();
        expect(
            createHistoryCursorCodec({ secret: Buffer.alloc(32, 8) }).decode(cursor),
        ).toBeUndefined();
    });
});
