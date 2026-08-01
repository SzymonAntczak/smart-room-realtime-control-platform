import { describe, expect, it } from 'vitest';

import {
    commandConfirmedEventSchema,
    commandDispatchedEventSchema,
    commandFailedEventSchema,
    commandRequestedEventSchema,
    commandTimedOutEventSchema,
    deviceHealthChangedEventSchema,
    deviceStateReportedEventSchema,
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    isSchema,
    normalizeIsoTimestamp,
    platformEventCandidateSchema,
    platformEventEnvelopeSchema,
    telemetryReadingRecordedEventSchema,
} from './contracts';

describe('platform event schemas', () => {
    it.each([
        [deviceStateReportedEventSchema, 'device.state.reported'],
        [deviceHealthChangedEventSchema, 'device.health.changed'],
        [telemetryReadingRecordedEventSchema, 'telemetry.reading.recorded'],
        [commandRequestedEventSchema, 'command.requested'],
        [commandDispatchedEventSchema, 'command.dispatched'],
        [commandConfirmedEventSchema, 'command.confirmed'],
        [commandFailedEventSchema, 'command.failed'],
        [commandTimedOutEventSchema, 'command.timed_out'],
    ] as const)('accepts its documented lifecycle event', (schema, eventType) => {
        expect(isSchema(schema, createEvent(eventType))).toBe(true);
    });

    it('requires a non-empty commandId on lifecycle events', () => {
        expect(
            isSchema(commandRequestedEventSchema, {
                ...createEvent('command.requested'),
                commandId: '',
            }),
        ).toBe(false);
    });

    it('normalizes accepted ISO timestamps with an offset to UTC', () => {
        const result = {
            ...createEvent('telemetry.reading.recorded'),
            occurredAt: '2026-06-08T11:30:00+02:00',
        };

        expect(isSchema(telemetryReadingRecordedEventSchema, result)).toBe(true);
        expect(normalizeIsoTimestamp(result.occurredAt)).toBe('2026-06-08T09:30:00Z');
    });

    it.each(['2026-02-30T09:30:00Z', '2025-02-29T09:30:00Z', '2026-13-01T09:30:00Z'])(
        'rejects an impossible ISO timestamp: %s',
        (occurredAt) => {
            expect(
                isSchema(telemetryReadingRecordedEventSchema, {
                    ...createEvent('telemetry.reading.recorded'),
                    occurredAt,
                }),
            ).toBe(false);
            expect(normalizeIsoTimestamp(occurredAt)).toBeUndefined();
        },
    );

    it('accepts a valid leap-day timestamp', () => {
        expect(normalizeIsoTimestamp('2028-02-29T09:30:00+02:00')).toBe('2028-02-29T07:30:00Z');
    });

    it('rejects unsupported event types from the full event contract', () => {
        expect(
            isSchema(platformEventEnvelopeSchema, {
                ...createEvent('telemetry.reading.recorded'),
                eventType: 'device.unknown',
            }),
        ).toBe(false);
    });

    it('preserves unknown event types for classification while normalizing their timestamp', () => {
        const candidate = {
            ...createEvent('telemetry.reading.recorded'),
            eventType: 'device.unknown',
            version: 2,
            occurredAt: '2026-06-08T11:30:00+02:00',
        };

        expect(isSchema(platformEventCandidateSchema, candidate)).toBe(true);
        expect(isSchema(platformEventEnvelopeSchema, candidate)).toBe(false);
    });

    it('rejects semantically invalid set.power lifecycle facts', () => {
        expect(
            isSchema(commandRequestedEventSchema, {
                ...createEvent('command.requested'),
                payload: {
                    commandType: 'set.power',
                    requestedState: {},
                    requestedBy: 'user',
                },
            }),
        ).toBe(false);
        expect(
            isSchema(commandConfirmedEventSchema, {
                ...createEvent('command.confirmed'),
                payload: {
                    confirmationSource: 'command.failed',
                    matchedState: { power: 'on' },
                },
            }),
        ).toBe(false);
    });
});

describe('realtime schemas', () => {
    it('requires dispatchedAt for a pending command', () => {
        expect(
            isRoomRealtimeServerMessage({
                messageType: 'room.snapshot',
                version: 1,
                sentAt: '2026-06-08T09:30:01Z',
                payload: {
                    roomName: 'Smart Room',
                    updatedAt: '2026-06-08T09:30:00Z',
                    devices: [],
                    activeCommands: [
                        {
                            commandId: 'cmd-1',
                            deviceId: 'led-main',
                            commandType: 'set.power',
                            status: 'pending',
                            requestedState: { power: 'on' },
                            requestedAt: '2026-06-08T09:30:00Z',
                        },
                    ],
                    recentEvents: [],
                },
            }),
        ).toBe(false);
    });

    it('accepts only documented active command states and metadata', () => {
        expect(
            isRoomRealtimeServerMessage(
                createSnapshotWithActiveCommands([
                    {
                        commandId: 'cmd-accepted',
                        deviceId: 'led-main',
                        commandType: 'set.power',
                        status: 'accepted',
                        requestedState: { power: 'on' },
                        requestedAt: '2026-06-08T09:30:00Z',
                    },
                ]),
            ),
        ).toBe(true);
        expect(
            isRoomRealtimeServerMessage(
                createSnapshotWithActiveCommands([
                    {
                        commandId: 'cmd-confirmed',
                        deviceId: 'led-main',
                        commandType: 'set.power',
                        status: 'confirmed',
                        requestedState: { power: 'on' },
                        requestedAt: '2026-06-08T09:30:00Z',
                        confirmedAt: '2026-06-08T09:30:01Z',
                    },
                ]),
            ),
        ).toBe(false);
        expect(
            isRoomRealtimeServerMessage(
                createSnapshotWithActiveCommands([
                    {
                        commandId: 'cmd-accepted',
                        deviceId: 'led-main',
                        commandType: 'set.power',
                        status: 'accepted',
                        requestedState: { power: 'on' },
                        requestedAt: '2026-06-08T09:30:00Z',
                        dispatchedAt: '2026-06-08T09:30:01Z',
                    },
                ]),
            ),
        ).toBe(false);
    });

    it('rejects overlapping active commands and dangling active command references', () => {
        const activeCommand = {
            commandId: 'cmd-1',
            deviceId: 'led-main',
            commandType: 'set.power',
            status: 'accepted',
            requestedState: { power: 'on' },
            requestedAt: '2026-06-08T09:30:00Z',
        } as const;

        expect(
            isRoomRealtimeServerMessage(
                createSnapshotWithActiveCommands([
                    activeCommand,
                    { ...activeCommand, commandId: 'cmd-2' },
                ]),
            ),
        ).toBe(false);
        expect(
            isRoomSnapshotProjection(
                createSnapshotWithActiveCommands([
                    activeCommand,
                    { ...activeCommand, commandId: 'cmd-2' },
                ]).payload,
            ),
        ).toBe(false);
        expect(
            isRoomRealtimeServerMessage({
                ...createSnapshotWithActiveCommands([activeCommand]),
                payload: {
                    ...createSnapshotWithActiveCommands([activeCommand]).payload,
                    devices: [
                        {
                            deviceId: 'led-main',
                            name: 'Main LED',
                            role: 'led-output',
                            health: 'online',
                            reportedState: { power: 'off' },
                            commandAvailability: { policy: 'allow' },
                            activeCommandId: 'cmd-other',
                        },
                    ],
                },
            }),
        ).toBe(false);
    });
});

function createSnapshotWithActiveCommands(activeCommands: unknown[]) {
    return {
        messageType: 'room.snapshot',
        version: 1,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices: [],
            activeCommands,
            recentEvents: [],
        },
    };
}

function createEvent(eventType: string) {
    const base = {
        eventId: 'evt-1',
        version: 1,
        occurredAt: '2026-06-08T09:30:00Z',
        source: 'backend',
        deviceId: 'led-main',
    };

    switch (eventType) {
        case 'device.state.reported':
            return {
                ...base,
                eventType,
                payload: { reportedState: { power: 'on' }, reportedAt: base.occurredAt },
            };
        case 'device.health.changed':
            return {
                ...base,
                eventType,
                payload: { previousHealth: 'stale', health: 'online', reason: 'report_received' },
            };
        case 'telemetry.reading.recorded':
            return {
                ...base,
                eventType,
                payload: { metric: 'temperature', value: 22.5, unit: 'celsius' },
            };
        case 'command.requested':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: {
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                    requestedBy: 'user',
                },
            };
        case 'command.dispatched':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: { commandType: 'set.power', target: 'simulator-adapter' },
            };
        case 'command.confirmed':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: {
                    confirmationSource: 'device.state.reported',
                    matchedState: { power: 'on' },
                },
            };
        case 'command.failed':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: {
                    reason: 'command_already_active',
                    message: 'Device has an active command.',
                },
            };
        case 'command.timed_out':
            return {
                ...base,
                eventType,
                commandId: 'cmd-1',
                payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
            };
        default:
            throw new Error(`Unsupported event type: ${eventType}`);
    }
}
