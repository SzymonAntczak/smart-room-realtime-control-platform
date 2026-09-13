import type {
    NormalizedTrendQuery,
    RawTelemetryPage,
    RawTelemetrySampleProjection,
    RecentEventProjection,
    SignificantFactPage,
    TrendResponse,
} from './history';

const fixtureTimestamp = '2026-09-10T10:00:00.000Z';
const fixtureGenerationId = 'fixture-history-generation';

/**
 * Cross-boundary test data for one logical significant fact and one raw
 * telemetry sample. Consumers must reuse these values instead of recreating
 * record identifiers in local schema-shaped fixtures.
 */
export function createHistoryIdentityFixtures(): {
    recentEvent: RecentEventProjection;
    recentEvents: RecentEventProjection[];
    significantFactPage: SignificantFactPage;
    telemetrySample: RawTelemetrySampleProjection;
    rawTelemetryPage: RawTelemetryPage;
    trendQuery: NormalizedTrendQuery;
    trendResponse: TrendResponse;
} {
    const recentEvent: RecentEventProjection = {
        recordId: `rec:v1:sha256:${'a'.repeat(64)}`,
        eventType: 'storage.gap.recorded',
        occurredAt: fixtureTimestamp,
        durability: 'durable',
        storageSequence: 7,
        source: 'backend',
        payload: {
            outageStartedAt: '2026-09-10T09:59:00.000Z',
            outageEndedAt: fixtureTimestamp,
            failureReason: 'storage_unavailable',
            boundaryBasis: 'same_process_first_degraded_at',
            observationsBackfilled: false,
        },
    };
    const telemetrySample: RawTelemetrySampleProjection = {
        recordId: `rec:v1:sha256:${'b'.repeat(64)}`,
        durability: 'durable',
        storageSequence: 8,
        deviceId: 'temp-desk',
        metric: 'temperature',
        value: 22.5,
        unit: 'celsius',
        occurredAt: fixtureTimestamp,
    };
    const trendQuery: NormalizedTrendQuery = {
        deviceId: telemetrySample.deviceId,
        metric: telemetrySample.metric,
        from: '2026-09-10T09:55:00.000Z',
        to: '2026-09-10T10:05:00.000Z',
        pointLimit: 2,
    };

    return {
        recentEvent,
        recentEvents: [recentEvent],
        significantFactPage: {
            historyGenerationId: fixtureGenerationId,
            throughSequence: telemetrySample.storageSequence,
            retentionAsOf: '2026-09-10T10:01:00.000Z',
            pageSize: 1,
            items: [recentEvent],
            nextCursor: null,
        },
        telemetrySample,
        rawTelemetryPage: {
            historyGenerationId: fixtureGenerationId,
            throughSequence: telemetrySample.storageSequence,
            retentionAsOf: '2026-09-10T10:01:00.000Z',
            pageSize: 1,
            items: [telemetrySample],
            nextCursor: null,
        },
        trendQuery,
        trendResponse: {
            historyGenerationId: fixtureGenerationId,
            throughSequence: telemetrySample.storageSequence,
            retentionAsOf: '2026-09-10T10:01:00.000Z',
            points: [telemetrySample],
        },
    };
}
