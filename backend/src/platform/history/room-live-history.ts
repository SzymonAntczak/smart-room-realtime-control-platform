import type {
    LiveTelemetrySampleProjection,
    RecentEventProjection,
} from '@smart-room/contracts/history';
import { compareRecentEventsDescending } from '@smart-room/contracts/history';

import { derivedCommandRecordId, logicalRecordId } from '../event-processing/event-identity';
import type {
    PreparedEventProcessingResult,
    PreparedRecord,
} from '../event-processing/event-processor';

export function preserveOriginalProcessingEvidence(
    prepared: PreparedEventProcessingResult,
    recentEvents: readonly RecentEventProjection[],
): PreparedEventProcessingResult {
    if (prepared.identityDisposition !== 'volatile_reconciliation') {
        return prepared;
    }

    const replacements = new Map<PreparedRecord, PreparedRecord>();
    const existingById = new Map(recentEvents.map((event) => [event.recordId, event]));

    for (const record of prepared.records) {
        if (record.kind !== 'input_significant_fact') {
            continue;
        }

        const existing = existingById.get(logicalRecordId(record.event, 'input_fact'));

        if (
            existing?.durability === 'volatile' &&
            'processingEvidence' in existing &&
            existing.processingEvidence !== undefined
        ) {
            replacements.set(record, {
                ...record,
                processingEvidence: existing.processingEvidence,
            });
        }
    }

    return {
        ...prepared,
        records: prepared.records.map((record) => replacements.get(record) ?? record),
        feedRecords: prepared.feedRecords.map((record) => replacements.get(record) ?? record),
    };
}

export function recentEventsForRecords(
    records: readonly PreparedRecord[],
    durability: 'durable' | 'volatile',
): RecentEventProjection[] {
    return records
        .flatMap((record) => {
            const recentEvent = recentEventForRecord(record, durability);

            return recentEvent ? [recentEvent] : [];
        })
        .sort(compareRecentEventsDescending);
}

export function liveTelemetrySampleForRecord(
    record: PreparedRecord,
    durability: 'durable' | 'volatile',
    storageSequence?: number,
): LiveTelemetrySampleProjection | undefined {
    if (record.kind !== 'telemetry') {
        return undefined;
    }

    if (durability === 'durable' && storageSequence === undefined) {
        throw new Error('Durable telemetry samples require a storage sequence.');
    }

    return {
        recordId: logicalRecordId(record.event, 'telemetry'),
        durability,
        ...(durability === 'durable' ? { storageSequence } : {}),
        deviceId: record.event.deviceId,
        metric: record.event.payload.metric,
        value: record.event.payload.value,
        unit: record.event.payload.unit,
        occurredAt: record.event.occurredAt,
    } as LiveTelemetrySampleProjection;
}

export function recentEventForRecord(
    record: PreparedRecord,
    durability: 'durable' | 'volatile',
    storageSequence?: number,
): RecentEventProjection | undefined {
    if (record.kind === 'telemetry') {
        return undefined;
    }

    const storage = durability === 'durable' ? { storageSequence } : {};

    if (record.kind === 'derived_command_confirmed') {
        if (storageSequence === undefined && durability === 'durable') {
            throw new Error('Durable recent events require a storage sequence.');
        }

        return {
            recordId: derivedCommandRecordId(record.commandId, 'confirmed'),
            eventType: 'command.confirmed',
            occurredAt: record.occurredAt,
            durability,
            ...storage,
            deviceId: record.deviceId,
            commandId: record.commandId,
            source: 'backend',
            payload: record.payload,
        } as RecentEventProjection;
    }

    const event = record.event;

    if (storageSequence === undefined && durability === 'durable') {
        throw new Error('Durable recent events require a storage sequence.');
    }

    return {
        recordId: logicalRecordId(event, 'input_fact'),
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        durability,
        ...storage,
        deviceId: event.deviceId,
        ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
        source: event.source,
        payload: event.payload,
        ...(record.processingEvidence === undefined
            ? {}
            : { processingEvidence: record.processingEvidence }),
    } as RecentEventProjection;
}

export function mergeRecentEvents(
    current: readonly RecentEventProjection[],
    additions: readonly RecentEventProjection[],
): RecentEventProjection[] {
    const byRecordId = new Map(current.map((event) => [event.recordId, event]));

    for (const event of additions) {
        const existing = byRecordId.get(event.recordId);

        // A durable record is the historical fact.  A later volatile copy of
        // the same record must never demote it while recovery is merging the
        // two sides of the boundary.
        if (existing?.durability === 'durable' && event.durability === 'volatile') {
            continue;
        }

        if (existing?.durability === 'volatile' && event.durability === 'durable') {
            byRecordId.set(event.recordId, event);

            continue;
        }

        if (
            !existing ||
            Date.parse(event.occurredAt) > Date.parse(existing.occurredAt) ||
            (event.occurredAt === existing.occurredAt && event.recordId > existing.recordId)
        ) {
            byRecordId.set(event.recordId, event);
        }
    }

    return [...byRecordId.values()].sort(compareRecentEventsDescending).slice(0, 20);
}
