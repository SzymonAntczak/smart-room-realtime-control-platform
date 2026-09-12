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
import { canonicalUtcTimestampSchema, isSchema, nonEmptyStringSchema } from './validation';

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

const historyPageFields = {
    historyGenerationId: historyGenerationIdSchema,
    throughSequence: storedThroughSequenceSchema,
    retentionAsOf: canonicalUtcTimestampSchema,
    pageSize: Type.Integer({ minimum: 1 }),
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
