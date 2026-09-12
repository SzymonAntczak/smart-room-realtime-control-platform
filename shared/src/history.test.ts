import { describe, expect, it } from 'vitest';

import {
    isRawTelemetryPage,
    isRecentEventsProjection,
    isSignificantFactPage,
    type RawTelemetrySampleProjection,
    type RecentEventProjection,
} from './history';

describe('durable history contracts', () => {
    it('accepts an ordered, unique bounded recent-event feed', () => {
        const later = storageGap('b', 2, '2026-09-10T10:00:00.000Z');
        const earlier = storageGap('a', 1, '2026-09-10T09:00:00.000Z');

        expect(isRecentEventsProjection([later, earlier])).toBe(true);
        expect(isRecentEventsProjection([later, later])).toBe(false);
        expect(isRecentEventsProjection([earlier, later])).toBe(false);
        expect(isRecentEventsProjection(Array.from({ length: 21 }, () => later))).toBe(false);
        expect(
            isRecentEventsProjection([{ ...later, occurredAt: '2026-09-10T12:00:00+02:00' }]),
        ).toBe(false);
    });

    it('rejects timestamp-inconsistent derived recent events', () => {
        const gap = storageGap('a', 1, '2026-09-10T10:00:00.000Z');
        const failed = commandFailure('c', 2, '2026-09-10T11:59:59+02:00');

        expect(
            isRecentEventsProjection([
                {
                    ...gap,
                    payload: { ...gap.payload, outageEndedAt: '2026-09-10T09:59:59.000Z' },
                },
            ]),
        ).toBe(false);
        expect(isRecentEventsProjection([failed])).toBe(false);
        expect(
            isSignificantFactPage({
                historyGenerationId: 'generation-1',
                throughSequence: 2,
                retentionAsOf: '2026-09-10T10:01:00.000Z',
                pageSize: 1,
                items: [failed],
                nextCursor: null,
            }),
        ).toBe(false);
    });

    it('accepts pinned significant-fact pages and rejects dangling or out-of-bound rows', () => {
        const later = storageGap('b', 2, '2026-09-10T10:00:00.000Z');
        const earlier = storageGap('a', 1, '2026-09-10T09:00:00.000Z');
        const page = {
            historyGenerationId: 'generation-1',
            throughSequence: 2,
            retentionAsOf: '2026-09-10T10:01:00.000Z',
            pageSize: 2,
            items: [later, earlier],
            nextCursor: null,
        };

        expect(isSignificantFactPage(page)).toBe(true);
        expect(isSignificantFactPage({ ...page, items: [earlier, later] })).toBe(false);
        expect(isSignificantFactPage({ ...page, items: [later], nextCursor: 'next' })).toBe(false);
        expect(
            isSignificantFactPage({
                ...page,
                items: [{ ...later, storageSequence: 3 }],
                throughSequence: 2,
            }),
        ).toBe(false);
        expect(
            isSignificantFactPage({
                ...page,
                items: [
                    {
                        ...later,
                        payload: {
                            ...later.payload,
                            outageEndedAt: '2026-09-10T09:59:59.000Z',
                        },
                    },
                ],
            }),
        ).toBe(false);
    });

    it('keeps raw telemetry pages bounded, ordered and physically unique', () => {
        const later = telemetry('b', 2, '2026-09-10T10:00:00.000Z');
        const earlier = telemetry('a', 1, '2026-09-10T09:00:00.000Z');
        const page = {
            historyGenerationId: 'generation-1',
            throughSequence: 2,
            retentionAsOf: '2026-09-10T10:01:00.000Z',
            pageSize: 2,
            items: [later, earlier],
            nextCursor: 'next',
        };

        expect(isRawTelemetryPage(page)).toBe(true);
        expect(isRawTelemetryPage({ ...page, pageSize: 1 })).toBe(false);
        expect(isRawTelemetryPage({ ...page, items: [later, later] })).toBe(false);
        expect(
            isRawTelemetryPage({
                ...page,
                items: [{ ...later, occurredAt: '2026-09-10T12:00:00+02:00' }],
                nextCursor: null,
            }),
        ).toBe(false);
        expect(
            isRawTelemetryPage({
                ...page,
                items: [later, { ...earlier, storageSequence: 2 }],
            }),
        ).toBe(false);
    });
});

function storageGap(
    lastHexDigit: 'a' | 'b',
    storageSequence: number,
    occurredAt: string,
): RecentEventProjection {
    return {
        recordId: `rec:v1:sha256:${'0'.repeat(63)}${lastHexDigit}`,
        eventType: 'storage.gap.recorded',
        occurredAt,
        durability: 'durable',
        storageSequence,
        source: 'backend',
        payload: {
            outageStartedAt: '2026-09-10T08:00:00.000Z',
            outageEndedAt: occurredAt,
            failureReason: 'storage_unavailable',
            boundaryBasis: 'same_process_first_degraded_at',
            observationsBackfilled: false,
        },
    };
}

function telemetry(
    lastHexDigit: 'a' | 'b',
    storageSequence: number,
    occurredAt: string,
): RawTelemetrySampleProjection {
    return {
        recordId: `rec:v1:sha256:${'1'.repeat(63)}${lastHexDigit}`,
        durability: 'durable',
        storageSequence,
        deviceId: 'temp-desk',
        metric: 'temperature',
        value: 22.5,
        unit: 'celsius',
        occurredAt,
    };
}

function commandFailure(
    lastHexDigit: 'c',
    storageSequence: number,
    requestedAt: string,
): RecentEventProjection {
    return {
        recordId: `rec:v1:sha256:${'2'.repeat(63)}${lastHexDigit}`,
        eventType: 'command.failed',
        occurredAt: '2026-09-10T10:00:00.000Z',
        durability: 'durable',
        storageSequence,
        deviceId: 'led-main',
        commandId: 'cmd-1',
        source: 'backend',
        payload: {
            reason: 'command_rejected',
            message: 'The command was rejected.',
            requestedAt,
        },
    };
}
