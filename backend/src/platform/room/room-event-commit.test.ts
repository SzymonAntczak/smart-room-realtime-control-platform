import type { TelemetryReadingRecordedEvent } from '@smart-room/contracts/events';
import { describe, expect, it, vi } from 'vitest';

import {
    derivedCommandRecordId,
    inputFingerprint,
    logicalRecordId,
} from '../event-processing/event-identity';
import type { PreparedEventProcessingResult } from '../event-processing/event-processor';
import { createRoomProjector } from '../read-model/room-projection';
import type { RoomStorageTransaction } from '../storage/room-storage';

import { appendPreparedRecord, commitPreparedEvent } from './room-event-commit';

describe('appendPreparedRecord', () => {
    it('persists telemetry with its stable logical identity and returns its sequence', () => {
        const event = {
            eventId: 'source-event-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-10-12T10:00:00.000Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 21.5, unit: 'celsius' },
        } as TelemetryReadingRecordedEvent;
        let appended: unknown;
        const transaction = {
            appendTelemetrySample(input: unknown) {
                appended = input;

                return { storageSequence: 27 };
            },
        } as unknown as RoomStorageTransaction;

        const sequence = appendPreparedRecord(transaction, { kind: 'telemetry', event });

        expect(sequence).toBe(27);
        expect(appended).toMatchObject({
            recordId: logicalRecordId(event, 'telemetry'),
            eventId: event.eventId,
            deviceId: event.deviceId,
            metric: 'temperature',
            value: 21.5,
            unit: 'celsius',
        });
    });

    it('persists derived command confirmations with the stable command lifecycle identity', () => {
        let appended: unknown;
        const transaction = {
            appendSignificantFact(input: unknown) {
                appended = input;

                return { storageSequence: 28 };
            },
        } as unknown as RoomStorageTransaction;
        const record = {
            kind: 'derived_command_confirmed' as const,
            eventId: 'confirmation-event',
            commandId: 'command-1',
            deviceId: 'led-main',
            occurredAt: '2026-10-12T10:00:01.000Z',
            payload: { sourceEventId: 'source-event-1', confirmedAt: '2026-10-12T10:00:01.000Z' },
        };

        const sequence = appendPreparedRecord(transaction, record);

        expect(sequence).toBe(28);
        expect(appended).toMatchObject({
            recordId: derivedCommandRecordId('command-1', 'confirmed'),
            eventId: 'confirmation-event',
            eventType: 'command.confirmed',
            deviceId: 'led-main',
            commandId: 'command-1',
        });
    });
});

describe('commitPreparedEvent', () => {
    it('commits prepared records, identities, projection and runtime session atomically', () => {
        const event = {
            eventId: 'event-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-10-12T10:00:00.000Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 21.5, unit: 'celsius' },
        } as const;
        const roomProjector = createRoomProjector({
            devices: [],
            initialUpdatedAt: '2026-10-12T10:00:00.000Z',
        });
        const appendTelemetrySample = vi.fn(() => ({ storageSequence: 31 }));
        const upsertAcceptedInputIdentity = vi.fn();
        const saveLatestRoomProjection = vi.fn();
        const activateRuntimeSession = vi.fn();
        const transaction = {
            appendTelemetrySample,
            upsertAcceptedInputIdentity,
            saveLatestRoomProjection,
            activateRuntimeSession,
        };
        const storage = {
            transact(operation: (transaction: never) => unknown) {
                return {
                    status: 'committed',
                    value: operation(transaction as never),
                    retention: {} as never,
                } as never;
            },
        };

        const outcome = commitPreparedEvent({
            storage: storage as never,
            event: event as never,
            ingress: { receivedAt: '2026-10-12T10:00:01.000Z', ingestSequence: 1 },
            prepared: {
                kind: 'accepted_applied',
                result: {
                    status: 'accepted',
                    state: roomProjector.getProjection(),
                    evaluatedAt: '2026-10-12T10:00:01.000Z',
                },
                eventId: event.eventId,
                identityDisposition: 'new',
                records: [{ kind: 'telemetry', event }],
                feedRecords: [],
                ingress: { receivedAt: '2026-10-12T10:00:01.000Z', ingestSequence: 1 },
            } satisfies PreparedEventProcessingResult,
            durablePreparedState: { updatedAt: '2026-10-12T10:00:01.000Z' } as never,
            projectionEvidence: {} as never,
            recentEvents: [],
            volatileGuards: [],
            storageSession: { activateRuntimeSession } as never,
        });

        expect(appendTelemetrySample).toHaveBeenCalledOnce();
        expect(upsertAcceptedInputIdentity).toHaveBeenCalledWith({
            eventId: 'event-1',
            fingerprint: inputFingerprint(event),
            durability: 'durable',
            acceptedAt: '2026-10-12T10:00:01.000Z',
        });
        expect(saveLatestRoomProjection).toHaveBeenCalledOnce();
        expect(activateRuntimeSession).toHaveBeenCalledOnce();
        expect(outcome).toMatchObject({ status: 'committed' });
    });
});
