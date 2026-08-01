import {
    defaultDeduplicationEntryLimit,
    defaultDeduplicationRetentionMs,
} from '../platform/event-processing/event-deduplicator';

export interface DeduplicationRuntimeConfig {
    deduplicationRetentionMs: number;
    deduplicationEntryLimit: number;
}

export function readDeduplicationRuntimeConfig(
    environment: Record<string, string | undefined>,
): DeduplicationRuntimeConfig {
    return {
        deduplicationRetentionMs: readPositiveInteger(
            environment.DEDUPLICATION_RETENTION_MS,
            'DEDUPLICATION_RETENTION_MS',
            defaultDeduplicationRetentionMs,
        ),
        deduplicationEntryLimit: readPositiveInteger(
            environment.DEDUPLICATION_ENTRY_LIMIT,
            'DEDUPLICATION_ENTRY_LIMIT',
            defaultDeduplicationEntryLimit,
        ),
    };
}

function readPositiveInteger(
    value: string | undefined,
    name: string,
    defaultValue: number,
): number {
    if (value === undefined) {
        return defaultValue;
    }

    const parsedValue = Number(value);

    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }

    return parsedValue;
}
