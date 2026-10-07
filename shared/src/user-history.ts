import { type Static, type TProperties, Type } from '@sinclair/typebox';

import { deviceAvailabilityStates, deviceOperationalHealthStates } from './devices';
import { platformEventSources } from './events';
import { historyPageSizeLimit, recentEventsLimit } from './history';
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

const powerSchema = Type.Union([Type.Literal('on'), Type.Literal('off')]);
const availabilitySchema = Type.Union(deviceAvailabilityStates.map((state) => Type.Literal(state)));
const healthSchema = Type.Union(deviceOperationalHealthStates.map((state) => Type.Literal(state)));
const deviceFields = {
    deviceId: nonEmptyStringSchema,
    deviceName: nonEmptyStringSchema,
    source: Type.Union(platformEventSources.map((source) => Type.Literal(source))),
};
const durableFields = {
    durability: Type.Literal('durable'),
    storageSequence: storageSequenceSchema,
};
const volatileFields = { durability: Type.Literal('volatile') };

function itemVariants<Fields extends TProperties>(fields: Fields) {
    const common = {
        recordId: recordIdSchema,
        occurredAt: canonicalUtcTimestampSchema,
        ...fields,
    };

    return Type.Union([
        Type.Object(
            {
                ...common,
                ...deviceFields,
                kind: Type.Literal('power_changed'),
                previous: Type.Union([powerSchema, Type.Null()]),
                current: powerSchema,
            },
            { additionalProperties: false },
        ),
        Type.Object(
            {
                ...common,
                ...deviceFields,
                kind: Type.Literal('availability_changed'),
                previous: Type.Union([availabilitySchema, Type.Null()]),
                current: availabilitySchema,
            },
            { additionalProperties: false },
        ),
        Type.Object(
            {
                ...common,
                ...deviceFields,
                kind: Type.Literal('health_changed'),
                previous: Type.Union([healthSchema, Type.Null()]),
                current: healthSchema,
            },
            { additionalProperties: false },
        ),
        Type.Object(
            {
                ...common,
                ...deviceFields,
                kind: Type.Literal('attempt_failed'),
                requestedPower: Type.Optional(powerSchema),
            },
            { additionalProperties: false },
        ),
        Type.Object(
            {
                ...common,
                ...deviceFields,
                kind: Type.Literal('confirmation_missing'),
                requestedPower: powerSchema,
            },
            { additionalProperties: false },
        ),
        Type.Object(
            {
                ...common,
                source: Type.Literal('backend'),
                kind: Type.Literal('history_gap'),
                outageStartedAt: canonicalUtcTimestampSchema,
                outageEndedAt: canonicalUtcTimestampSchema,
            },
            { additionalProperties: false },
        ),
    ]);
}

export const durableUserHistoryItemSchema = itemVariants(durableFields);
export const userHistoryItemSchema = Type.Union([
    durableUserHistoryItemSchema,
    itemVariants(volatileFields),
]);
export type UserHistoryItem = Static<typeof userHistoryItemSchema>;
export type DurableUserHistoryItem = Static<typeof durableUserHistoryItemSchema>;

export const userHistoryProjectionSchema = Type.Array(userHistoryItemSchema, {
    maxItems: recentEventsLimit,
});
export const userHistoryDeltaSchema = Type.Array(userHistoryItemSchema, {
    minItems: 1,
    maxItems: recentEventsLimit,
});

export const defaultUserHistoryPageSize = 50;
const pageSizeSchema = Type.Integer({ minimum: 1, maximum: historyPageSizeLimit });
const filterFields = {
    deviceId: Type.Optional(nonEmptyStringSchema),
    from: Type.Optional(isoTimestampSchema),
    to: Type.Optional(isoTimestampSchema),
};
export const userHistoryFirstPageQuerySchema = Type.Object(
    { pageSize: Type.Optional(pageSizeSchema), ...filterFields },
    { additionalProperties: false },
);
export const userHistoryPageQuerySchema = Type.Object(
    {
        pageSize: Type.Optional(pageSizeSchema),
        cursor: Type.Optional(nonEmptyStringSchema),
        ...filterFields,
    },
    { additionalProperties: false },
);
export type UserHistoryFirstPageQuery = Static<typeof userHistoryFirstPageQuerySchema>;
export type UserHistoryPageQuery = Static<typeof userHistoryPageQuerySchema>;
export type NormalizedUserHistoryPageQuery = Omit<UserHistoryPageQuery, 'pageSize'> & {
    pageSize: number;
};
type UserHistoryFilters = Pick<UserHistoryFirstPageQuery, 'deviceId' | 'from' | 'to'>;

/** Validates optional half-open bounds after structural validation by the caller. */
function normalizeUserHistoryFilters(value: UserHistoryFilters): UserHistoryFilters | undefined {
    const from = value.from === undefined ? undefined : normalizeIsoTimestamp(value.from);
    const to = value.to === undefined ? undefined : normalizeIsoTimestamp(value.to);

    if (
        (value.from !== undefined && from === undefined) ||
        (value.to !== undefined && to === undefined) ||
        (from !== undefined && to !== undefined && Date.parse(from) >= Date.parse(to))
    ) {
        return undefined;
    }

    return {
        ...(value.deviceId !== undefined ? { deviceId: value.deviceId } : {}),
        ...(from !== undefined ? { from } : {}),
        ...(to !== undefined ? { to } : {}),
    };
}

/** Applies the default after validation; never coerces invalid input to a default. */
export function normalizeUserHistoryPageQuery(
    value: unknown,
): NormalizedUserHistoryPageQuery | undefined {
    if (!isSchema(userHistoryPageQuerySchema, value)) {
        return undefined;
    }

    const filters = normalizeUserHistoryFilters(value);

    if (filters === undefined) {
        return undefined;
    }

    return {
        pageSize: value.pageSize ?? defaultUserHistoryPageSize,
        ...(value.cursor !== undefined ? { cursor: value.cursor } : {}),
        ...filters,
    };
}

/** Presentation scope only; never a storage-port/raw significant-facts scope. */
export const userHistoryCursorQueryScopeSchema = Type.Object(
    {
        dataset: Type.Literal('user_history'),
        order: Type.Literal('occurred_at_desc'),
        pageSize: pageSizeSchema,
        ...filterFields,
    },
    { additionalProperties: false },
);
export type UserHistoryCursorQueryScope = Static<typeof userHistoryCursorQueryScopeSchema>;

export function normalizeUserHistoryCursorQueryScope(
    value: unknown,
): UserHistoryCursorQueryScope | undefined {
    if (!isSchema(userHistoryCursorQueryScopeSchema, value)) {
        return undefined;
    }

    const filters = normalizeUserHistoryFilters(value);

    if (filters === undefined) {
        return undefined;
    }

    return { dataset: value.dataset, order: value.order, pageSize: value.pageSize, ...filters };
}

/** Rejects reinterpretation of a pinned user-history session under different filters. */
export function isMatchingUserHistoryCursorQueryScope(
    capturedScope: unknown,
    candidateScope: unknown,
): boolean {
    const captured = normalizeUserHistoryCursorQueryScope(capturedScope);
    const candidate = normalizeUserHistoryCursorQueryScope(candidateScope);

    return (
        captured !== undefined &&
        candidate !== undefined &&
        captured.dataset === candidate.dataset &&
        captured.order === candidate.order &&
        captured.pageSize === candidate.pageSize &&
        captured.deviceId === candidate.deviceId &&
        captured.from === candidate.from &&
        captured.to === candidate.to
    );
}

export const userHistoryPageSchema = Type.Object(
    {
        items: Type.Array(durableUserHistoryItemSchema, { maxItems: historyPageSizeLimit }),
        historyGenerationId: historyGenerationIdSchema,
        throughSequence: storedThroughSequenceSchema,
        retentionAsOf: canonicalUtcTimestampSchema,
        pageSize: pageSizeSchema,
        nextCursor: Type.Union([nonEmptyStringSchema, Type.Null()]),
        completeness: Type.Literal('retained_evidence_only'),
    },
    { additionalProperties: false },
);
export type UserHistoryPage = Static<typeof userHistoryPageSchema>;

export const durableHistoryUnavailableResponseSchema = Type.Object(
    { error: Type.Literal('durable_history_unavailable'), message: nonEmptyStringSchema },
    { additionalProperties: false },
);
export type DurableHistoryUnavailableResponse = Static<
    typeof durableHistoryUnavailableResponseSchema
>;

export function isDurableHistoryUnavailableResponse(
    value: unknown,
): value is DurableHistoryUnavailableResponse {
    return isSchema(durableHistoryUnavailableResponseSchema, value);
}

export function isUserHistoryItem(value: unknown): value is UserHistoryItem {
    return isSchema(userHistoryItemSchema, value) && hasValidItemMeaning(value);
}

function hasValidItemMeaning(item: UserHistoryItem): boolean {
    switch (item.kind) {
        case 'power_changed':
        case 'availability_changed':
        case 'health_changed':
            return item.previous === null || item.previous !== item.current;
        case 'history_gap':
            return (
                Date.parse(item.outageStartedAt) <= Date.parse(item.outageEndedAt) &&
                item.outageEndedAt === item.occurredAt
            );
        default:
            return true;
    }
}

export function compareUserHistoryDescending(
    left: Pick<UserHistoryItem, 'occurredAt' | 'recordId'>,
    right: Pick<UserHistoryItem, 'occurredAt' | 'recordId'>,
): number {
    const timeOrder = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);

    return timeOrder !== 0
        ? timeOrder
        : left.recordId === right.recordId
          ? 0
          : left.recordId > right.recordId
            ? -1
            : 1;
}

export function isUserHistoryProjection(value: unknown): value is UserHistoryItem[] {
    return (
        isSchema(userHistoryProjectionSchema, value) &&
        new Set(value.map((item) => item.recordId)).size === value.length &&
        value.every((item, index) => {
            const next = value[index + 1];

            return (
                hasValidItemMeaning(item) &&
                (next === undefined || compareUserHistoryDescending(item, next) <= 0)
            );
        })
    );
}

export function isUserHistoryPage(value: unknown): value is UserHistoryPage {
    if (!isSchema(userHistoryPageSchema, value)) {
        return false;
    }

    return (
        value.items.length <= value.pageSize &&
        new Set(value.items.map((item) => item.recordId)).size === value.items.length &&
        new Set(value.items.map((item) => item.storageSequence)).size === value.items.length &&
        value.items.every((item, index) => {
            const next = value.items[index + 1];
            const timeOrder =
                next === undefined ? -1 : Date.parse(next.occurredAt) - Date.parse(item.occurredAt);

            return (
                hasValidItemMeaning(item) &&
                item.storageSequence <= value.throughSequence &&
                (next === undefined ||
                    timeOrder < 0 ||
                    (timeOrder === 0 && item.storageSequence > next.storageSequence))
            );
        })
    );
}
