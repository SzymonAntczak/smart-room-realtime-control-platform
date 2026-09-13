import { type Static, type TProperties, Type } from '@sinclair/typebox';

import {
    commandDeliveryUncertainPayloadSchema,
    commandDispatchedPayloadSchema,
    commandFailedPayloadSchema,
    commandRequestedPayloadSchema,
    commandTimedOutPayloadSchema,
    deviceAvailabilityChangedPayloadSchema,
    deviceHealthChangedPayloadSchema,
    deviceStateReportedPayloadSchema,
    platformEventSources,
} from './events';
import {
    historyGenerationIdSchema,
    recordIdSchema,
    storageSequenceSchema,
    storedThroughSequenceSchema,
} from './storage';
import {
    canonicalUtcTimestampSchema,
    isoTimestampSchema,
    isSchema,
    nonEmptyStringSchema,
    normalizeIsoTimestamp,
} from './validation';

export const storageGapBoundaryBases = [
    'same_process_first_degraded_at',
    'degraded_startup_at',
    'unclosed_session_later_bound',
] as const;
export type StorageGapBoundaryBasis = (typeof storageGapBoundaryBases)[number];
export const recentEventsLimit = 20;

export interface StorageGapRecordedPayload {
    outageStartedAt: string;
    outageEndedAt: string;
    failureReason: string;
    boundaryBasis: StorageGapBoundaryBasis;
    observationsBackfilled: false;
}

const durableFields = {
    durability: Type.Literal('durable'),
    storageSequence: storageSequenceSchema,
};
const volatileFields = { durability: Type.Literal('volatile') };
const commonFields = {
    recordId: recordIdSchema,
    occurredAt: canonicalUtcTimestampSchema,
};
const deviceEventFields = {
    deviceId: nonEmptyStringSchema,
    source: Type.Union(platformEventSources.map((source) => Type.Literal(source))),
};
const commandEventFields = {
    ...deviceEventFields,
    commandId: nonEmptyStringSchema,
};
const confirmedPayloadSchema = Type.Object(
    {
        sourceEventId: nonEmptyStringSchema,
        confirmedAt: canonicalUtcTimestampSchema,
    },
    { additionalProperties: false },
);
export const storageGapRecordedPayloadSchema = Type.Object(
    {
        outageStartedAt: canonicalUtcTimestampSchema,
        outageEndedAt: canonicalUtcTimestampSchema,
        failureReason: nonEmptyStringSchema,
        boundaryBasis: Type.Union(storageGapBoundaryBases.map((basis) => Type.Literal(basis))),
        observationsBackfilled: Type.Literal(false),
    },
    { additionalProperties: false },
);

function withDurability<Shape extends TProperties>(shape: Shape) {
    return Type.Union([
        Type.Object({ ...shape, ...durableFields }, { additionalProperties: false }),
        Type.Object({ ...shape, ...volatileFields }, { additionalProperties: false }),
    ]);
}

export const recentEventProjectionSchema = Type.Union([
    withDurability({
        ...commonFields,
        ...deviceEventFields,
        eventType: Type.Literal('device.state.reported'),
        payload: deviceStateReportedPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        ...deviceEventFields,
        eventType: Type.Literal('device.availability.changed'),
        payload: deviceAvailabilityChangedPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        ...deviceEventFields,
        eventType: Type.Literal('device.health.changed'),
        payload: deviceHealthChangedPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        ...commandEventFields,
        eventType: Type.Literal('command.requested'),
        payload: commandRequestedPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        ...commandEventFields,
        eventType: Type.Literal('command.dispatched'),
        payload: commandDispatchedPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        ...commandEventFields,
        eventType: Type.Literal('command.delivery_uncertain'),
        payload: commandDeliveryUncertainPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        ...commandEventFields,
        eventType: Type.Literal('command.failed'),
        payload: commandFailedPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        ...commandEventFields,
        eventType: Type.Literal('command.timed_out'),
        payload: commandTimedOutPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        deviceId: nonEmptyStringSchema,
        commandId: nonEmptyStringSchema,
        source: Type.Literal('backend'),
        eventType: Type.Literal('command.confirmed'),
        payload: confirmedPayloadSchema,
    }),
    withDurability({
        ...commonFields,
        source: Type.Literal('backend'),
        eventType: Type.Literal('storage.gap.recorded'),
        payload: storageGapRecordedPayloadSchema,
    }),
]);

export const recentEventsProjectionSchema = Type.Array(recentEventProjectionSchema, {
    maxItems: recentEventsLimit,
});
/** A publication delta never carries an empty no-op feed update. */
export const recentEventsDeltaSchema = Type.Array(recentEventProjectionSchema, {
    minItems: 1,
    maxItems: recentEventsLimit,
});
/** Exact wire/cache union: durable records have a sequence; volatile never do. */
export type RecentEventProjection = Static<typeof recentEventProjectionSchema>;
export type RecentEventProjectionSchema = RecentEventProjection;

/** Durable history representation of the same significant-fact variants as the feed. */
export const durableSignificantFactProjectionSchema = Type.Intersect([
    recentEventProjectionSchema,
    Type.Object({
        durability: Type.Literal('durable'),
        storageSequence: storageSequenceSchema,
    }),
]);
export type DurableSignificantFactProjection = Extract<
    RecentEventProjection,
    { durability: 'durable' }
>;

/** Original durable telemetry sample; it is never replaced by an aggregate identity. */
export const rawTelemetrySampleProjectionSchema = Type.Object(
    {
        recordId: recordIdSchema,
        durability: Type.Literal('durable'),
        storageSequence: storageSequenceSchema,
        deviceId: nonEmptyStringSchema,
        metric: Type.Literal('temperature'),
        value: Type.Number(),
        unit: Type.Literal('celsius'),
        occurredAt: canonicalUtcTimestampSchema,
    },
    { additionalProperties: false },
);
export type RawTelemetrySampleProjection = Static<typeof rawTelemetrySampleProjectionSchema>;

/** Request for a bounded, downsampled view of one device metric. */
export const trendQuerySchema = Type.Object(
    {
        deviceId: nonEmptyStringSchema,
        metric: Type.Literal('temperature'),
        from: isoTimestampSchema,
        to: isoTimestampSchema,
        pointLimit: Type.Integer({ minimum: 2 }),
    },
    { additionalProperties: false },
);
export type TrendQuery = Static<typeof trendQuerySchema>;

/** Query after its accepted RFC 3339 bounds have been canonicalized to UTC. */
export interface NormalizedTrendQuery extends Omit<TrendQuery, 'from' | 'to'> {
    from: string;
    to: string;
}

/** A bounded trend keeps original telemetry identities rather than aggregate records. */
export const trendResponseSchema = Type.Object(
    {
        historyGenerationId: historyGenerationIdSchema,
        throughSequence: storedThroughSequenceSchema,
        retentionAsOf: canonicalUtcTimestampSchema,
        points: Type.Array(rawTelemetrySampleProjectionSchema),
    },
    { additionalProperties: false },
);
export type TrendResponse = Static<typeof trendResponseSchema>;

export function normalizeTrendQuery(value: unknown): NormalizedTrendQuery | undefined {
    if (!isSchema(trendQuerySchema, value)) {
        return undefined;
    }

    const from = normalizeIsoTimestamp(value.from);
    const to = normalizeIsoTimestamp(value.to);

    if (from === undefined || to === undefined || Date.parse(from) >= Date.parse(to)) {
        return undefined;
    }

    return { ...value, from, to };
}

/**
 * Verifies response invariants that JSON Schema cannot express without the
 * normalized request which set its range, device, metric and point limit.
 */
export function isTrendResponse(
    query: NormalizedTrendQuery,
    value: unknown,
): value is TrendResponse {
    if (!isSchema(trendResponseSchema, value)) {
        return false;
    }

    const points = value.points;
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);

    return (
        points.length <= query.pointLimit &&
        new Set(points.map((point) => point.recordId)).size === points.length &&
        new Set(points.map((point) => point.storageSequence)).size === points.length &&
        points.every(
            (point) =>
                point.deviceId === query.deviceId &&
                point.metric === query.metric &&
                point.storageSequence <= value.throughSequence &&
                Date.parse(point.occurredAt) >= from &&
                Date.parse(point.occurredAt) < to,
        ) &&
        isTrendPointsOrdered(points)
    );
}

/**
 * Selects the contract-defined extrema from already-read raw samples. It owns
 * no storage access and is intentionally reusable by a later storage adapter.
 */
export function selectTrendPoints(
    query: NormalizedTrendQuery,
    samples: readonly RawTelemetrySampleProjection[],
): RawTelemetrySampleProjection[] {
    const bucketCount = Math.floor(query.pointLimit / 2);
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    const bucketDuration = (to - from) / bucketCount;
    const buckets = Array.from({ length: bucketCount }, () => ({
        minimum: undefined as RawTelemetrySampleProjection | undefined,
        maximum: undefined as RawTelemetrySampleProjection | undefined,
    }));

    for (const sample of samples) {
        const occurredAt = Date.parse(sample.occurredAt);

        if (
            sample.deviceId !== query.deviceId ||
            sample.metric !== query.metric ||
            occurredAt < from ||
            occurredAt >= to
        ) {
            continue;
        }

        const bucketIndex = Math.min(
            bucketCount - 1,
            Math.floor((occurredAt - from) / bucketDuration),
        );
        const bucket = buckets[bucketIndex];

        if (bucket === undefined) {
            continue;
        }

        if (bucket.minimum === undefined || compareTrendMinimum(sample, bucket.minimum) < 0) {
            bucket.minimum = sample;
        }

        if (bucket.maximum === undefined || compareTrendMaximum(sample, bucket.maximum) > 0) {
            bucket.maximum = sample;
        }
    }

    const selected = new Map<string, RawTelemetrySampleProjection>();

    for (const bucket of buckets) {
        if (bucket.minimum !== undefined) {
            selected.set(bucket.minimum.recordId, bucket.minimum);
        }

        if (bucket.maximum !== undefined) {
            selected.set(bucket.maximum.recordId, bucket.maximum);
        }
    }

    return [...selected.values()].sort(compareTrendPointsAscending);
}

function compareTrendMinimum(
    left: RawTelemetrySampleProjection,
    right: RawTelemetrySampleProjection,
): number {
    if (left.value !== right.value) {
        return left.value - right.value;
    }

    return compareTrendPointsAscending(left, right);
}

function compareTrendMaximum(
    left: RawTelemetrySampleProjection,
    right: RawTelemetrySampleProjection,
): number {
    if (left.value !== right.value) {
        return left.value - right.value;
    }

    return compareTrendPointsAscending(left, right);
}

function isTrendPointsOrdered(points: readonly RawTelemetrySampleProjection[]): boolean {
    return points.every((point, index) => {
        const next = points[index + 1];

        return next === undefined || compareTrendPointsAscending(point, next) <= 0;
    });
}

function compareTrendPointsAscending(
    left: Pick<RawTelemetrySampleProjection, 'occurredAt' | 'storageSequence'>,
    right: Pick<RawTelemetrySampleProjection, 'occurredAt' | 'storageSequence'>,
): number {
    const timestampOrder = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);

    return timestampOrder !== 0 ? timestampOrder : left.storageSequence - right.storageSequence;
}

export const historyPageOrders = ['occurred_at_desc'] as const;
const historyPageOrderSchema = Type.Union(historyPageOrders.map((order) => Type.Literal(order)));
const historyPageSizeSchema = Type.Integer({ minimum: 1 });

export const significantFactCursorQueryScopeSchema = Type.Object(
    {
        dataset: Type.Literal('significant_facts'),
        order: historyPageOrderSchema,
        pageSize: historyPageSizeSchema,
    },
    { additionalProperties: false },
);
export const rawTelemetryCursorQueryScopeSchema = Type.Object(
    {
        dataset: Type.Literal('raw_telemetry'),
        deviceId: nonEmptyStringSchema,
        metric: Type.Literal('temperature'),
        from: isoTimestampSchema,
        to: isoTimestampSchema,
        order: historyPageOrderSchema,
        pageSize: historyPageSizeSchema,
    },
    { additionalProperties: false },
);

/** Canonical result-shaping inputs that a server-issued cursor must bind. */
export const historyCursorQueryScopeSchema = Type.Union([
    significantFactCursorQueryScopeSchema,
    rawTelemetryCursorQueryScopeSchema,
]);
export type HistoryCursorQueryScope = Static<typeof historyCursorQueryScopeSchema>;

export function normalizeHistoryCursorQueryScope(
    value: unknown,
): HistoryCursorQueryScope | undefined {
    if (!isSchema(historyCursorQueryScopeSchema, value)) {
        return undefined;
    }

    if (value.dataset === 'significant_facts') {
        return {
            dataset: value.dataset,
            order: value.order,
            pageSize: value.pageSize,
        };
    }

    const from = normalizeIsoTimestamp(value.from);
    const to = normalizeIsoTimestamp(value.to);

    if (from === undefined || to === undefined || Date.parse(from) >= Date.parse(to)) {
        return undefined;
    }

    return {
        dataset: value.dataset,
        deviceId: value.deviceId,
        metric: value.metric,
        from,
        to,
        order: value.order,
        pageSize: value.pageSize,
    };
}

/** Rejects any reinterpretation of a cursor under another canonical query scope. */
export function isMatchingHistoryCursorQueryScope(
    capturedScope: unknown,
    candidateScope: unknown,
): boolean {
    const captured = normalizeHistoryCursorQueryScope(capturedScope);
    const candidate = normalizeHistoryCursorQueryScope(candidateScope);

    if (
        captured === undefined ||
        candidate === undefined ||
        captured.dataset !== candidate.dataset
    ) {
        return false;
    }

    if (captured.dataset === 'significant_facts') {
        return captured.order === candidate.order && captured.pageSize === candidate.pageSize;
    }

    return (
        candidate.dataset === 'raw_telemetry' &&
        captured.deviceId === candidate.deviceId &&
        captured.metric === candidate.metric &&
        captured.from === candidate.from &&
        captured.to === candidate.to &&
        captured.order === candidate.order &&
        captured.pageSize === candidate.pageSize
    );
}

const historyPageFields = {
    historyGenerationId: historyGenerationIdSchema,
    throughSequence: storedThroughSequenceSchema,
    retentionAsOf: canonicalUtcTimestampSchema,
    pageSize: historyPageSizeSchema,
    nextCursor: Type.Union([nonEmptyStringSchema, Type.Null()]),
};

/** A pinned page of durable significant facts, newest first. */
export const significantFactPageSchema = Type.Object(
    {
        ...historyPageFields,
        items: Type.Array(durableSignificantFactProjectionSchema),
    },
    { additionalProperties: false },
);
export type SignificantFactPage = Static<typeof significantFactPageSchema>;

/** A pinned page of original raw telemetry samples, newest first. */
export const rawTelemetryPageSchema = Type.Object(
    {
        ...historyPageFields,
        items: Type.Array(rawTelemetrySampleProjectionSchema),
    },
    { additionalProperties: false },
);
export type RawTelemetryPage = Static<typeof rawTelemetryPageSchema>;

/** Typed failures for a server-issued history pagination cursor. */
export const historyCursorErrorResponseSchema = Type.Union([
    Type.Object(
        {
            error: Type.Literal('cursor_expired'),
            message: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            error: Type.Literal('history_generation_changed'),
            message: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            error: Type.Literal('cursor_query_mismatch'),
            message: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            error: Type.Literal('invalid_cursor'),
            message: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
]);
export type HistoryCursorErrorResponse = Static<typeof historyCursorErrorResponseSchema>;

export function isHistoryCursorErrorResponse(value: unknown): value is HistoryCursorErrorResponse {
    return isSchema(historyCursorErrorResponseSchema, value);
}

/** Deterministic cache/feed order: newest timestamp, then lexical record ID. */
export function compareRecentEventsDescending(
    left: Pick<RecentEventProjection, 'occurredAt' | 'recordId'>,
    right: Pick<RecentEventProjection, 'occurredAt' | 'recordId'>,
): number {
    const timestampOrder = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);

    if (timestampOrder !== 0) {
        return timestampOrder;
    }

    if (left.recordId === right.recordId) {
        return 0;
    }

    return left.recordId > right.recordId ? -1 : 1;
}

export function isRecentEventsOrdered(events: readonly RecentEventProjection[]): boolean {
    return events.every((event, index) => {
        const next = events[index + 1];

        if (!next) {
            return true;
        }

        return compareRecentEventsDescending(event, next) <= 0;
    });
}

/** Validates the bounded feed beyond its structural JSON Schema shape. */
export function isRecentEventsProjection(value: unknown): value is RecentEventProjection[] {
    return (
        isSchema(recentEventsProjectionSchema, value) &&
        new Set(value.map((event) => event.recordId)).size === value.length &&
        isRecentEventsOrdered(value) &&
        value.every(hasConsistentRecentEventTiming)
    );
}

export function isSignificantFactPage(value: unknown): value is SignificantFactPage {
    return (
        isHistoryPage(value, significantFactPageSchema) &&
        (value as SignificantFactPage).items.every((item) =>
            hasConsistentRecentEventTiming(item as RecentEventProjection),
        )
    );
}

export function isRawTelemetryPage(value: unknown): value is RawTelemetryPage {
    return isHistoryPage(value, rawTelemetryPageSchema);
}

function isHistoryPage(
    value: unknown,
    schema: typeof significantFactPageSchema | typeof rawTelemetryPageSchema,
): boolean {
    if (!isSchema(schema, value)) {
        return false;
    }

    const items = value.items as Array<{
        recordId: string;
        occurredAt: string;
        storageSequence: number;
    }>;

    return (
        items.length <= value.pageSize &&
        new Set(items.map((item) => item.recordId)).size === items.length &&
        new Set(items.map((item) => item.storageSequence)).size === items.length &&
        items.every((item) => item.storageSequence <= value.throughSequence) &&
        isDurableHistoryOrdered(items) &&
        (value.nextCursor === null || items.length === value.pageSize)
    );
}

function isDurableHistoryOrdered(
    items: readonly { occurredAt: string; storageSequence: number }[],
): boolean {
    return items.every((item, index) => {
        const next = items[index + 1];

        if (!next) {
            return true;
        }

        const timestampOrder = Date.parse(next.occurredAt) - Date.parse(item.occurredAt);

        return (
            timestampOrder < 0 ||
            (timestampOrder === 0 && item.storageSequence > next.storageSequence)
        );
    });
}

function hasConsistentRecentEventTiming(event: RecentEventProjection): boolean {
    switch (event.eventType) {
        case 'command.confirmed':
            return event.payload.confirmedAt === event.occurredAt;
        case 'storage.gap.recorded':
            return (
                Date.parse(event.payload.outageStartedAt) <=
                    Date.parse(event.payload.outageEndedAt) &&
                event.payload.outageEndedAt === event.occurredAt
            );
        case 'command.failed':
            return (
                event.payload.requestedAt === undefined ||
                (isSchema(canonicalUtcTimestampSchema, event.payload.requestedAt) &&
                    Date.parse(event.payload.requestedAt) <= Date.parse(event.occurredAt))
            );
        default:
            return true;
    }
}
