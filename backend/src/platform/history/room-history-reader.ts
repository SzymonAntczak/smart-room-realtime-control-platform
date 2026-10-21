import {
    type DurableSignificantFactProjection,
    durableSignificantFactProjectionSchema,
    type HistoryCursorErrorResponse,
    type HistoryCursorQueryScope,
    isMatchingHistoryCursorQueryScope,
    isRawTelemetryPage,
    isRecentEventsProjection,
    isSignificantFactPage,
    isTrendResponse,
    type NormalizedRawTelemetryPageQuery,
    type NormalizedTrendQuery,
    type RawTelemetryPage,
    rawTelemetrySampleProjectionSchema,
    selectTrendPoints,
    type SignificantFactPage,
    type SignificantFactPageQuery,
    type TrendResponse,
} from '@smart-room/contracts/history';
import { isSchema } from '@smart-room/contracts/validation';

import type {
    PinnedHistoryBounds,
    PinnedHistoryReadOutcome,
    RoomStorage,
    StorageTransactionOutcome,
    StoredSignificantFact,
    StoredTelemetrySample,
} from '../storage/room-storage';

import {
    type HistoryCursorCodec,
    type HistoryCursorPayload,
    isPinnedHistoryBounds,
} from './room-history-cursor';

export type RoomHistoryReadResult<Value> =
    | { status: 'available'; value: Value }
    | { status: 'cursor_error'; error: HistoryCursorErrorResponse }
    | {
          status: 'unavailable';
          failure?: 'confirmed_rolled_back' | 'indeterminate';
          error?: unknown;
      }
    | { status: 'invalid_internal_data' };

export interface PinnedSignificantFactSnapshot {
    bounds: PinnedHistoryBounds;
    items: readonly DurableSignificantFactProjection[];
}

export function isPinnedSignificantFactSnapshot(value: PinnedSignificantFactSnapshot): boolean {
    return (
        isPinnedHistoryBounds(value.bounds) &&
        value.items.length <= 5000 &&
        new Set(value.items.map((item) => item.recordId)).size === value.items.length &&
        new Set(value.items.map((item) => item.storageSequence)).size === value.items.length &&
        value.items.every((item, index) => {
            const next = value.items[index + 1];

            return (
                isSchema(durableSignificantFactProjectionSchema, item) &&
                isRecentEventsProjection([item]) &&
                item.storageSequence <= value.bounds.throughSequence &&
                (next === undefined ||
                    Date.parse(item.occurredAt) > Date.parse(next.occurredAt) ||
                    (item.occurredAt === next.occurredAt &&
                        item.storageSequence > next.storageSequence))
            );
        })
    );
}

export interface RoomHistoryReader {
    readPinnedSignificantFactSnapshot(
        bounds?: PinnedHistoryBounds,
    ): RoomHistoryReadResult<PinnedSignificantFactSnapshot>;
    readSignificantFactPage(
        query: SignificantFactPageQuery,
    ): RoomHistoryReadResult<SignificantFactPage>;
    readRawTelemetryPage(
        query: NormalizedRawTelemetryPageQuery,
    ): RoomHistoryReadResult<RawTelemetryPage>;
    readTrend(query: NormalizedTrendQuery): RoomHistoryReadResult<TrendResponse>;
}

export interface RoomHistoryReaderConfig {
    storage: RoomStorage;
    cursorCodec: HistoryCursorCodec;
    now(): string;
}

export function createRoomHistoryReader({
    storage,
    cursorCodec,
    now,
}: RoomHistoryReaderConfig): RoomHistoryReader {
    return {
        readPinnedSignificantFactSnapshot(bounds) {
            let records: StoredSignificantFact[];
            let pinned: PinnedHistoryBounds;

            if (bounds === undefined) {
                const outcome = storage.transact(
                    (transaction) => {
                        const captured = transaction.capturePinnedHistoryBounds();

                        return {
                            bounds: captured,
                            records: transaction.listPinnedSignificantFacts(captured, {
                                limit: 5001,
                            }),
                        };
                    },
                    { retentionAsOf: now() },
                );

                if (outcome.status !== 'committed') {
                    return unavailable(outcome);
                }

                pinned = outcome.value.bounds;
                records = outcome.value.records;
            } else {
                try {
                    const outcome = storage.readPinnedSignificantFacts({
                        bounds,
                        readAt: now(),
                        options: { limit: 5001 },
                    });

                    if (outcome.status !== 'available') {
                        return pinnedReadError(outcome);
                    }

                    pinned = bounds;
                    records = outcome.value;
                } catch (error) {
                    return unavailableRead(error);
                }
            }

            const items = records.map(toDurableSignificantFact);

            if (!allPresent(items)) {
                return { status: 'invalid_internal_data' };
            }

            const value = { bounds: pinned, items };

            return isPinnedSignificantFactSnapshot(value)
                ? { status: 'available', value }
                : { status: 'invalid_internal_data' };
        },
        readSignificantFactPage(query) {
            const scope: HistoryCursorQueryScope = {
                dataset: 'significant_facts',
                order: 'occurred_at_desc',
                pageSize: query.pageSize,
            };

            if (query.cursor === undefined) {
                const outcome = storage.transact(
                    (transaction) => {
                        const bounds = transaction.capturePinnedHistoryBounds();

                        return {
                            bounds,
                            records: transaction.listPinnedSignificantFacts(bounds, {
                                limit: query.pageSize + 1,
                            }),
                        };
                    },
                    { retentionAsOf: now() },
                );

                return significantFactFirstPage(outcome, query.pageSize, scope, cursorCodec);
            }

            const payload = cursorCodec.decode(query.cursor);

            if (payload === undefined) {
                return invalidCursor();
            }

            if (!isMatchingHistoryCursorQueryScope(payload.scope, scope)) {
                return queryMismatch();
            }

            let outcome: PinnedHistoryReadOutcome<StoredSignificantFact[]>;

            try {
                outcome = storage.readPinnedSignificantFacts({
                    bounds: payload.bounds,
                    readAt: now(),
                    options: { limit: query.pageSize + 1, after: payload.position },
                });
            } catch (error) {
                return unavailableRead(error);
            }

            return significantFactContinuation(
                outcome,
                query.pageSize,
                scope,
                payload,
                cursorCodec,
            );
        },
        readRawTelemetryPage(query) {
            const scope: HistoryCursorQueryScope = {
                dataset: 'raw_telemetry',
                deviceId: query.deviceId,
                metric: query.metric,
                from: query.from,
                to: query.to,
                order: 'occurred_at_desc',
                pageSize: query.pageSize,
            };

            if (query.cursor === undefined) {
                const outcome = storage.transact(
                    (transaction) => {
                        const bounds = transaction.capturePinnedHistoryBounds();

                        return {
                            bounds,
                            records: transaction.listPinnedTelemetrySamples(query, bounds, {
                                limit: query.pageSize + 1,
                            }),
                        };
                    },
                    { retentionAsOf: now() },
                );

                return rawTelemetryFirstPage(outcome, query.pageSize, scope, cursorCodec);
            }

            const payload = cursorCodec.decode(query.cursor);

            if (payload === undefined) {
                return invalidCursor();
            }

            if (!isMatchingHistoryCursorQueryScope(payload.scope, scope)) {
                return queryMismatch();
            }

            let outcome: PinnedHistoryReadOutcome<StoredTelemetrySample[]>;

            try {
                outcome = storage.readPinnedTelemetrySamples({
                    query,
                    bounds: payload.bounds,
                    readAt: now(),
                    options: { limit: query.pageSize + 1, after: payload.position },
                });
            } catch (error) {
                return unavailableRead(error);
            }

            return rawTelemetryContinuation(outcome, query.pageSize, scope, payload, cursorCodec);
        },
        readTrend(query) {
            const outcome = storage.transact(
                (transaction) => {
                    const bounds = transaction.capturePinnedHistoryBounds();

                    return {
                        bounds,
                        records: transaction.listPinnedTelemetrySamples(query, bounds),
                    };
                },
                { retentionAsOf: now() },
            );

            if (outcome.status !== 'committed') {
                return unavailable(outcome);
            }

            const samples = outcome.value.records.map(toRawTelemetrySample);

            if (!allPresent(samples)) {
                return { status: 'invalid_internal_data' };
            }

            const response = {
                ...publicBounds(outcome.value.bounds),
                points: selectTrendPoints(query, samples),
            } satisfies TrendResponse;

            return isTrendResponse(query, response)
                ? { status: 'available', value: response }
                : { status: 'invalid_internal_data' };
        },
    };
}

function significantFactFirstPage(
    outcome: StorageTransactionOutcome<{
        bounds: PinnedHistoryBounds;
        records: StoredSignificantFact[];
    }>,
    pageSize: number,
    scope: HistoryCursorQueryScope,
    cursorCodec: HistoryCursorCodec,
): RoomHistoryReadResult<SignificantFactPage> {
    if (outcome.status !== 'committed') {
        return unavailable(outcome);
    }

    return significantFactPage(
        outcome.value.records,
        outcome.value.bounds,
        pageSize,
        scope,
        cursorCodec,
    );
}

function significantFactContinuation(
    outcome: PinnedHistoryReadOutcome<StoredSignificantFact[]>,
    pageSize: number,
    scope: HistoryCursorQueryScope,
    payload: HistoryCursorPayload,
    cursorCodec: HistoryCursorCodec,
): RoomHistoryReadResult<SignificantFactPage> {
    if (outcome.status !== 'available') {
        return pinnedReadError(outcome);
    }

    return significantFactPage(outcome.value, payload.bounds, pageSize, scope, cursorCodec);
}

function significantFactPage(
    records: readonly StoredSignificantFact[],
    bounds: PinnedHistoryBounds,
    pageSize: number,
    scope: HistoryCursorQueryScope,
    cursorCodec: HistoryCursorCodec,
): RoomHistoryReadResult<SignificantFactPage> {
    const items = records.slice(0, pageSize).map(toDurableSignificantFact);

    if (!allPresent(items)) {
        return { status: 'invalid_internal_data' };
    }

    const page = {
        ...publicBounds(bounds),
        pageSize,
        items,
        nextCursor: nextCursor(records, items, pageSize, scope, bounds, cursorCodec),
    } satisfies SignificantFactPage;

    return isSignificantFactPage(page)
        ? { status: 'available', value: page }
        : { status: 'invalid_internal_data' };
}

function rawTelemetryFirstPage(
    outcome: StorageTransactionOutcome<{
        bounds: PinnedHistoryBounds;
        records: StoredTelemetrySample[];
    }>,
    pageSize: number,
    scope: HistoryCursorQueryScope,
    cursorCodec: HistoryCursorCodec,
): RoomHistoryReadResult<RawTelemetryPage> {
    if (outcome.status !== 'committed') {
        return unavailable(outcome);
    }

    return rawTelemetryPage(
        outcome.value.records,
        outcome.value.bounds,
        pageSize,
        scope,
        cursorCodec,
    );
}

function rawTelemetryContinuation(
    outcome: PinnedHistoryReadOutcome<StoredTelemetrySample[]>,
    pageSize: number,
    scope: HistoryCursorQueryScope,
    payload: HistoryCursorPayload,
    cursorCodec: HistoryCursorCodec,
): RoomHistoryReadResult<RawTelemetryPage> {
    if (outcome.status !== 'available') {
        return pinnedReadError(outcome);
    }

    return rawTelemetryPage(outcome.value, payload.bounds, pageSize, scope, cursorCodec);
}

function rawTelemetryPage(
    records: readonly StoredTelemetrySample[],
    bounds: PinnedHistoryBounds,
    pageSize: number,
    scope: HistoryCursorQueryScope,
    cursorCodec: HistoryCursorCodec,
): RoomHistoryReadResult<RawTelemetryPage> {
    const items = records.slice(0, pageSize).map(toRawTelemetrySample);

    if (!allPresent(items)) {
        return { status: 'invalid_internal_data' };
    }

    const page = {
        ...publicBounds(bounds),
        pageSize,
        items,
        nextCursor: nextCursor(records, items, pageSize, scope, bounds, cursorCodec),
    } satisfies RawTelemetryPage;

    return isRawTelemetryPage(page)
        ? { status: 'available', value: page }
        : { status: 'invalid_internal_data' };
}

function nextCursor(
    records: readonly unknown[],
    items: readonly { occurredAt: string; storageSequence: number }[],
    pageSize: number,
    scope: HistoryCursorQueryScope,
    bounds: PinnedHistoryBounds,
    cursorCodec: HistoryCursorCodec,
): string | null {
    const lastItem = items[items.length - 1];

    if (records.length <= pageSize || lastItem === undefined) {
        return null;
    }

    return cursorCodec.encode({
        version: 1,
        scope,
        bounds,
        position: {
            occurredAt: lastItem.occurredAt,
            storageSequence: lastItem.storageSequence,
        },
    });
}

function pinnedReadError(
    outcome: Exclude<PinnedHistoryReadOutcome<unknown>, { status: 'available'; value: unknown }>,
): RoomHistoryReadResult<never> {
    return outcome.status === 'history_generation_changed'
        ? {
              status: 'cursor_error',
              error: {
                  error: 'history_generation_changed',
                  message: 'The history generation changed.',
              },
          }
        : {
              status: 'cursor_error',
              error: {
                  error: 'cursor_expired',
                  message: 'The pagination cursor has expired.',
              },
          };
}

function invalidCursor(): RoomHistoryReadResult<never> {
    return {
        status: 'cursor_error',
        error: { error: 'invalid_cursor', message: 'The cursor cannot be verified.' },
    };
}

function queryMismatch(): RoomHistoryReadResult<never> {
    return {
        status: 'cursor_error',
        error: { error: 'cursor_query_mismatch', message: 'The cursor does not match this query.' },
    };
}

function unavailable<Value>(
    outcome: Exclude<StorageTransactionOutcome<Value>, { status: 'committed' }>,
): RoomHistoryReadResult<never> {
    return { status: 'unavailable', failure: outcome.status, error: outcome.error };
}

function unavailableRead(error: unknown): RoomHistoryReadResult<never> {
    return { status: 'unavailable', error };
}

function publicBounds(bounds: PinnedHistoryBounds) {
    return {
        historyGenerationId: bounds.historyGenerationId,
        throughSequence: bounds.throughSequence,
        retentionAsOf: bounds.retentionAsOf,
    };
}

function toDurableSignificantFact(record: StoredSignificantFact) {
    const candidate = {
        recordId: record.recordId,
        eventType: record.eventType,
        occurredAt: record.occurredAt,
        durability: 'durable' as const,
        storageSequence: record.storageSequence,
        ...(record.deviceId === undefined ? {} : { deviceId: record.deviceId }),
        ...(record.commandId === undefined ? {} : { commandId: record.commandId }),
        ...(record.source === undefined ? {} : { source: record.source }),
        payload: record.payload,
        ...(record.processingEvidence === undefined
            ? {}
            : { processingEvidence: record.processingEvidence }),
    };

    return isSchema(durableSignificantFactProjectionSchema, candidate) ? candidate : undefined;
}

function toRawTelemetrySample(record: StoredTelemetrySample) {
    const candidate = {
        recordId: record.recordId,
        durability: 'durable' as const,
        storageSequence: record.storageSequence,
        deviceId: record.deviceId,
        metric: record.metric,
        value: record.value,
        unit: record.unit,
        occurredAt: record.occurredAt,
    };

    return isSchema(rawTelemetrySampleProjectionSchema, candidate) ? candidate : undefined;
}

function allPresent<Value>(values: readonly (Value | undefined)[]): values is Value[] {
    return values.every((value) => value !== undefined);
}
