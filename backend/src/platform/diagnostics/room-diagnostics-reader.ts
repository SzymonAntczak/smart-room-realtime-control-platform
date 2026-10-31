import {
    type DurableDiagnosticsSnapshot,
    isDurableDiagnosticsSnapshot,
} from '@smart-room/contracts/diagnostics';
import { normalizeIsoTimestamp } from '@smart-room/contracts/validation';

import type { RoomHistoryReadResult } from '../history/room-history-reader';
import type { RoomStorage, StoredQuarantineEntry } from '../storage/room-storage';

export function createRoomDiagnosticsReader({
    storage,
    now,
}: {
    storage: RoomStorage;
    now(): string;
}) {
    return {
        readDiagnosticsSnapshot(): RoomHistoryReadResult<DurableDiagnosticsSnapshot> {
            const outcome = storage.transact(
                (transaction) => ({
                    historyGenerationId: transaction.getMetadata().historyGenerationId,
                    entries: transaction.listQuarantineEntries().map(toMetadata),
                }),
                { retentionAsOf: now() },
            );

            if (outcome.status !== 'committed') {
                return { status: 'unavailable', failure: outcome.status, error: outcome.error };
            }

            return isDurableDiagnosticsSnapshot(outcome.value)
                ? { status: 'available', value: outcome.value }
                : { status: 'invalid_internal_data' };
        },
    };
}

function toMetadata(entry: StoredQuarantineEntry) {
    const raw =
        typeof entry.rawEvent === 'object' && entry.rawEvent !== null
            ? (entry.rawEvent as Record<string, unknown>)
            : {};
    const occurredAt =
        typeof raw.occurredAt === 'string' ? normalizeIsoTimestamp(raw.occurredAt) : undefined;

    return {
        internalSequence: entry.internalSequence,
        reason: entry.reason,
        recordedAt: entry.recordedAt,
        ...(typeof entry.eventId === 'string' ? { eventId: entry.eventId } : {}),
        ...optionalString(raw, 'eventType'),
        ...optionalString(raw, 'source'),
        ...optionalString(raw, 'deviceId'),
        ...optionalString(raw, 'commandId'),
        ...(occurredAt ? { occurredAt } : {}),
    };
}

function optionalString<Key extends string>(raw: Record<string, unknown>, key: Key) {
    return typeof raw[key] === 'string' ? { [key]: raw[key] } : {};
}
