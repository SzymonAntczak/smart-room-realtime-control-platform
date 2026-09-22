import {
    durableSignificantFactProjectionSchema,
    isRawTelemetryPage,
    isSignificantFactPage,
    isTrendResponse,
    type NormalizedRawTelemetryFirstPageQuery,
    type NormalizedTrendQuery,
    type RawTelemetryPage,
    rawTelemetrySampleProjectionSchema,
    selectTrendPoints,
    type SignificantFactFirstPageQuery,
    type SignificantFactPage,
    type TrendResponse,
} from '@smart-room/contracts/history';
import { isSchema } from '@smart-room/contracts/validation';

import type {
    PinnedHistoryBounds,
    RoomStorage,
    StorageTransactionOutcome,
    StoredSignificantFact,
    StoredTelemetrySample,
} from '../storage/room-storage';

export type RoomHistoryReadResult<Value> =
    | { status: 'available'; value: Value }
    | {
          status: 'unavailable';
          failure?: 'confirmed_rolled_back' | 'indeterminate';
          error?: unknown;
      }
    | { status: 'invalid_internal_data' };

export interface RoomHistoryReader {
    readSignificantFactFirstPage(
        query: SignificantFactFirstPageQuery,
    ): RoomHistoryReadResult<SignificantFactPage>;
    readRawTelemetryFirstPage(
        query: NormalizedRawTelemetryFirstPageQuery,
    ): RoomHistoryReadResult<RawTelemetryPage>;
    readTrend(query: NormalizedTrendQuery): RoomHistoryReadResult<TrendResponse>;
}

export interface RoomHistoryReaderConfig {
    storage: RoomStorage;
    now(): string;
}

export function createRoomHistoryReader({
    storage,
    now,
}: RoomHistoryReaderConfig): RoomHistoryReader {
    return {
        readSignificantFactFirstPage(query) {
            const outcome = storage.transact(
                (transaction) => {
                    const bounds = transaction.capturePinnedHistoryBounds();

                    return {
                        bounds,
                        records: transaction.listPinnedSignificantFacts(bounds, {
                            limit: query.pageSize,
                        }),
                    };
                },
                { retentionAsOf: now() },
            );

            if (outcome.status !== 'committed') {
                return unavailable(outcome);
            }

            const items = outcome.value.records.map(toDurableSignificantFact);

            if (!allPresent(items)) {
                return { status: 'invalid_internal_data' };
            }

            const page = {
                ...publicBounds(outcome.value.bounds),
                pageSize: query.pageSize,
                items,
                nextCursor: null,
            } satisfies SignificantFactPage;

            return isSignificantFactPage(page)
                ? { status: 'available', value: page }
                : { status: 'invalid_internal_data' };
        },
        readRawTelemetryFirstPage(query) {
            const outcome = storage.transact(
                (transaction) => {
                    const bounds = transaction.capturePinnedHistoryBounds();

                    return {
                        bounds,
                        records: transaction.listPinnedTelemetrySamples(query, bounds, {
                            limit: query.pageSize,
                        }),
                    };
                },
                { retentionAsOf: now() },
            );

            if (outcome.status !== 'committed') {
                return unavailable(outcome);
            }

            const items = outcome.value.records.map(toRawTelemetrySample);

            if (!allPresent(items)) {
                return { status: 'invalid_internal_data' };
            }

            const page = {
                ...publicBounds(outcome.value.bounds),
                pageSize: query.pageSize,
                items,
                nextCursor: null,
            } satisfies RawTelemetryPage;

            return isRawTelemetryPage(page)
                ? { status: 'available', value: page }
                : { status: 'invalid_internal_data' };
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

function unavailable<Value>(
    outcome: Exclude<StorageTransactionOutcome<Value>, { status: 'committed' }>,
): RoomHistoryReadResult<never> {
    return { status: 'unavailable', failure: outcome.status, error: outcome.error };
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
