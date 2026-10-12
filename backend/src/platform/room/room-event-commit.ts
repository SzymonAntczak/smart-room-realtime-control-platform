import type { PlatformEvent } from '@smart-room/contracts/events';
import {
    compareRecentEventsDescending,
    type LiveTelemetrySampleProjection,
    type RecentEventProjection,
} from '@smart-room/contracts/history';

import type { CommandOutboxMutation } from '../command-processing/set-power-command-controller';
import {
    derivedCommandRecordId,
    inputFingerprint,
    logicalRecordId,
} from '../event-processing/event-identity';
import type {
    EventIngress,
    PreparedEventProcessingResult,
    PreparedRecord,
} from '../event-processing/event-processor';
import {
    liveTelemetrySampleForRecord,
    mergeRecentEvents,
    recentEventForRecord,
} from '../history/room-live-history';
import type { RoomProjection, RoomProjectionEvidence } from '../read-model/room-projection';
import { terminalOutboxClosure } from '../read-model/room-recovery-policy';
import type {
    AcceptedInputIdentity,
    RoomStorage,
    RoomStorageTransaction,
} from '../storage/room-storage';

import type { RoomStorageSession } from './room-storage-session';

export function commitPreparedEvent({
    storage,
    event,
    ingress,
    prepared,
    durablePreparedState,
    projectionEvidence,
    recentEvents,
    volatileGuards,
    outboxMutation,
    storageSession,
}: {
    storage: RoomStorage;
    event: PlatformEvent;
    ingress: EventIngress;
    prepared: PreparedEventProcessingResult;
    durablePreparedState: RoomProjection;
    projectionEvidence: RoomProjectionEvidence;
    recentEvents: readonly RecentEventProjection[];
    volatileGuards: readonly AcceptedInputIdentity[];
    outboxMutation?: CommandOutboxMutation;
    storageSession: Pick<RoomStorageSession, 'activateRuntimeSession'>;
}) {
    return storage.transact(
        (transaction) => {
            let storedThroughSequence: number | undefined;
            const storedRecentEvents: RecentEventProjection[] = [];
            let storedTelemetrySample: LiveTelemetrySampleProjection | undefined;
            const feedRecords = new Set(prepared.feedRecords);

            if (prepared.kind === 'quarantined') {
                transaction.appendQuarantineEntry({
                    eventId: event.eventId,
                    reason:
                        prepared.result.status === 'ignored' ? prepared.result.reason : 'rejected',
                    recordedAt: ingress.receivedAt,
                    rawEvent: event,
                });
            } else if (prepared.eventId) {
                for (const record of prepared.records) {
                    storedThroughSequence = appendPreparedRecord(transaction, record);
                    const recentEvent = recentEventForRecord(
                        record,
                        'durable',
                        storedThroughSequence,
                    );
                    const isDurabilityPromotion =
                        prepared.identityDisposition === 'volatile_reconciliation' &&
                        recentEvent !== undefined &&
                        recentEvents.some(
                            (existing) =>
                                existing.recordId === recentEvent.recordId &&
                                existing.durability === 'volatile',
                        );

                    if (recentEvent && (feedRecords.has(record) || isDurabilityPromotion)) {
                        storedRecentEvents.push(recentEvent);
                    }

                    if (record.kind === 'telemetry') {
                        storedTelemetrySample = liveTelemetrySampleForRecord(
                            record,
                            'durable',
                            storedThroughSequence,
                        );
                    }
                }

                transaction.upsertAcceptedInputIdentity({
                    eventId: prepared.eventId,
                    fingerprint: prepared.fingerprint ?? inputFingerprint(event),
                    durability: 'durable',
                    acceptedAt: ingress.receivedAt,
                });
            }

            if (prepared.kind !== 'quarantined') {
                if (outboxMutation?.kind === 'upsert') {
                    transaction.upsertCommandDispatchOutboxIntent(outboxMutation.intent);
                } else if (outboxMutation?.kind === 'close') {
                    transaction.closeCommandDispatchOutboxIntent(outboxMutation);
                } else {
                    const terminalClosure = terminalOutboxClosure(event, prepared.records);

                    if (terminalClosure) {
                        transaction.closeCommandDispatchOutboxIntent(terminalClosure);
                    }
                }

                transaction.saveLatestRoomProjection({
                    updatedAt: durablePreparedState.updatedAt,
                    projection: durablePreparedState,
                    projectionEvidence,
                    volatileGuards: [...volatileGuards],
                    recentEvents: mergeRecentEvents(recentEvents, storedRecentEvents),
                });
                storageSession.activateRuntimeSession(transaction, ingress.receivedAt);
            }

            return {
                storedThroughSequence,
                storedRecentEvents: storedRecentEvents.sort(compareRecentEventsDescending),
                storedTelemetrySample,
            };
        },
        { retentionAsOf: ingress.receivedAt },
    );
}

/** Persist one already-prepared record and return its durable sequence. */
export function appendPreparedRecord(
    transaction: RoomStorageTransaction,
    record: PreparedRecord,
): number {
    switch (record.kind) {
        case 'telemetry': {
            const event = record.event;

            return transaction.appendTelemetrySample({
                recordId: logicalRecordId(event, 'telemetry'),
                eventId: event.eventId,
                deviceId: event.deviceId,
                metric: event.payload.metric,
                value: event.payload.value,
                unit: event.payload.unit,
                occurredAt: event.occurredAt,
                payload: event.payload,
            }).storageSequence;
        }

        case 'input_significant_fact': {
            const event = record.event;

            return transaction.appendSignificantFact({
                recordId: logicalRecordId(event, 'input_fact'),
                eventId: event.eventId,
                eventType: event.eventType,
                deviceId: event.deviceId,
                commandId: event.commandId,
                source: event.source,
                occurredAt: event.occurredAt,
                payload: event.payload,
                ...(record.processingEvidence === undefined
                    ? {}
                    : { processingEvidence: record.processingEvidence }),
            }).storageSequence;
        }

        case 'derived_command_confirmed':
            return transaction.appendSignificantFact({
                recordId: derivedCommandRecordId(record.commandId, 'confirmed'),
                eventId: record.eventId,
                eventType: 'command.confirmed',
                deviceId: record.deviceId,
                commandId: record.commandId,
                source: 'backend',
                occurredAt: record.occurredAt,
                payload: record.payload,
            }).storageSequence;
    }
}
