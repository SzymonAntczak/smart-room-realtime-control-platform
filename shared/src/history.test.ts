import { describe, expect, it } from 'vitest';

import {
    isHistoryCursorErrorResponse,
    isRawTelemetryPage,
    isRecentEventsProjection,
    isSignificantFactPage,
    isTrendResponse,
    type NormalizedTrendQuery,
    normalizeTrendQuery,
    type RawTelemetrySampleProjection,
    type RecentEventProjection,
    selectTrendPoints,
} from './history';
import { createHistoryIdentityFixtures } from './history-fixtures';

describe('durable history contracts', () => {
    it('keeps shared fact and telemetry identities valid across feed, pages and trend views', () => {
        const fixtures = createHistoryIdentityFixtures();

        expect(isRecentEventsProjection(fixtures.recentEvents)).toBe(true);
        expect(isSignificantFactPage(fixtures.significantFactPage)).toBe(true);
        expect(isRawTelemetryPage(fixtures.rawTelemetryPage)).toBe(true);
        expect(isTrendResponse(fixtures.trendQuery, fixtures.trendResponse)).toBe(true);
        expect(fixtures.significantFactPage.items[0]?.recordId).toBe(fixtures.recentEvent.recordId);
        expect(fixtures.trendResponse.points[0]?.recordId).toBe(fixtures.telemetrySample.recordId);
        expect(fixtures.trendResponse.points[0]?.storageSequence).toBe(
            fixtures.telemetrySample.storageSequence,
        );
        expect(fixtures.recentEvent.recordId).not.toBe(fixtures.telemetrySample.recordId);
    });

    it('accepts each typed cursor failure response', () => {
        expect(
            isHistoryCursorErrorResponse({
                error: 'cursor_expired',
                message: 'The pagination cursor has expired.',
            }),
        ).toBe(true);
        expect(
            isHistoryCursorErrorResponse({
                error: 'history_generation_changed',
                message: 'The history generation changed.',
            }),
        ).toBe(true);
        expect(
            isHistoryCursorErrorResponse({
                error: 'cursor_query_mismatch',
                message: 'The cursor does not match this query.',
            }),
        ).toBe(true);
        expect(
            isHistoryCursorErrorResponse({
                error: 'invalid_cursor',
                message: 'The cursor cannot be verified.',
            }),
        ).toBe(true);
    });

    it('rejects malformed, unknown and non-strict cursor failure responses', () => {
        expect(
            isHistoryCursorErrorResponse({ error: 'unknown_cursor_error', message: 'No.' }),
        ).toBe(false);
        expect(isHistoryCursorErrorResponse({ error: 'cursor_expired', message: '' })).toBe(false);
        expect(isHistoryCursorErrorResponse({ error: 'cursor_expired' })).toBe(false);
        expect(
            isHistoryCursorErrorResponse({
                error: 'cursor_query_mismatch',
                message: 'The cursor does not match this query.',
                pageSize: 20,
            }),
        ).toBe(false);
    });

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

    it('normalizes a non-empty trend range and enforces the minimum point limit', () => {
        expect(
            normalizeTrendQuery({
                deviceId: 'temp-desk',
                metric: 'temperature',
                from: '2026-09-10T12:00:00+02:00',
                to: '2026-09-10T13:00:00+02:00',
                pointLimit: 2,
            }),
        ).toMatchObject({
            from: '2026-09-10T10:00:00Z',
            to: '2026-09-10T11:00:00Z',
        });
        expect(
            normalizeTrendQuery({
                deviceId: 'temp-desk',
                metric: 'temperature',
                from: '2026-09-10T10:00:00Z',
                to: '2026-09-10T10:00:00Z',
                pointLimit: 2,
            }),
        ).toBeUndefined();
        expect(
            normalizeTrendQuery({
                deviceId: 'temp-desk',
                metric: 'temperature',
                from: '2026-09-10T10:00:00Z',
                to: '2026-09-10T11:00:00Z',
                pointLimit: 1,
            }),
        ).toBeUndefined();
    });

    it('selects half-open bucket extrema with deterministic boundary and tie handling', () => {
        const query = normalizedTrendQuery({ pointLimit: 4, to: '2026-09-10T10:08:00Z' });
        const samples = [
            telemetry('a', 1, '2026-09-10T10:00:00Z', 10),
            telemetry('b', 2, '2026-09-10T10:01:00Z', 10),
            telemetry('c', 3, '2026-09-10T10:03:00Z', 20),
            telemetry('d', 4, '2026-09-10T10:04:00Z', 15),
            telemetry('e', 5, '2026-09-10T10:05:00Z', 15),
            telemetry('f', 6, '2026-09-10T10:08:00Z', 0),
        ];

        expect(selectTrendPoints(query, samples).map((sample) => sample.storageSequence)).toEqual([
            1, 3, 4, 5,
        ]);
    });

    it('keeps the first and last raw sample for a flat bucket unless it has one sample', () => {
        const query = normalizedTrendQuery({ pointLimit: 2 });
        const first = telemetry('a', 1, '2026-09-10T10:00:00Z', 22.5);
        const last = telemetry('b', 2, '2026-09-10T10:05:00Z', 22.5);
        const only = telemetry('c', 3, '2026-09-10T10:06:00Z', 23);

        expect(
            selectTrendPoints(query, [first, last]).map((sample) => sample.storageSequence),
        ).toEqual([1, 2]);
        expect(selectTrendPoints(query, [only])).toEqual([only]);
    });

    it('validates a bounded ordered trend response against its normalized query', () => {
        const query = normalizedTrendQuery({ pointLimit: 2 });
        const first = telemetry('a', 1, '2026-09-10T10:00:00Z');
        const last = telemetry('b', 2, '2026-09-10T10:05:00Z');
        const response = {
            historyGenerationId: 'generation-1',
            throughSequence: 2,
            retentionAsOf: '2026-09-10T10:10:00Z',
            points: [first, last],
        };

        expect(isTrendResponse(query, response)).toBe(true);
        expect(isTrendResponse(query, { ...response, points: [last, first] })).toBe(false);
        expect(
            isTrendResponse(query, {
                ...response,
                points: [{ ...last, occurredAt: '2026-09-10T10:10:00Z' }],
            }),
        ).toBe(false);
        expect(
            isTrendResponse(query, {
                ...response,
                points: [first, last, telemetry('c', 3, '2026-09-10T10:06:00Z')],
            }),
        ).toBe(false);
        expect(
            isTrendResponse(query, {
                ...response,
                points: [first, { ...last, recordId: first.recordId }],
            }),
        ).toBe(false);
        expect(
            isTrendResponse(query, {
                ...response,
                points: [{ ...first, storageSequence: 3 }],
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
    lastHexDigit: 'a' | 'b' | 'c' | 'd' | 'e' | 'f',
    storageSequence: number,
    occurredAt: string,
    value = 22.5,
): RawTelemetrySampleProjection {
    return {
        recordId: `rec:v1:sha256:${'1'.repeat(63)}${lastHexDigit}`,
        durability: 'durable',
        storageSequence,
        deviceId: 'temp-desk',
        metric: 'temperature',
        value,
        unit: 'celsius',
        occurredAt,
    };
}

function normalizedTrendQuery(overrides: Partial<NormalizedTrendQuery> = {}): NormalizedTrendQuery {
    const query = normalizeTrendQuery({
        deviceId: 'temp-desk',
        metric: 'temperature',
        from: '2026-09-10T10:00:00Z',
        to: '2026-09-10T10:10:00Z',
        pointLimit: 2,
        ...overrides,
    });

    if (query === undefined) {
        throw new Error('Expected test trend query to normalize.');
    }

    return query;
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
