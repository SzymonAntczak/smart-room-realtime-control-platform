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
    recordIdSchema,
    storageSequenceSchema,
} from './storage';
import { canonicalUtcTimestampSchema, nonEmptyStringSchema } from './validation';

export const storageGapBoundaryBases = [
    'same_process_first_degraded_at',
    'degraded_startup_at',
    'unclosed_session_later_bound',
] as const;
export type StorageGapBoundaryBasis = (typeof storageGapBoundaryBases)[number];

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
    maxItems: 20,
});
/** A publication delta never carries an empty no-op feed update. */
export const recentEventsDeltaSchema = Type.Array(recentEventProjectionSchema, {
    minItems: 1,
    maxItems: 20,
});
/** Exact wire/cache union: durable records have a sequence; volatile never do. */
export type RecentEventProjection = Static<typeof recentEventProjectionSchema>;
export type RecentEventProjectionSchema = RecentEventProjection;

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
