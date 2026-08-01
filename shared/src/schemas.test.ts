import { describe, expect, it } from 'vitest';

import {
    commandConfirmedEventSchema,
    commandDispatchedEventSchema,
    commandFailedEventSchema,
    commandRequestedEventSchema,
    commandTimedOutEventSchema,
    deviceHealthChangedEventSchema,
    deviceStateReportedEventSchema,
    platformEventCandidateSchema,
    platformEventEnvelopeSchema,
    roomRealtimeServerMessageSchema,
    telemetryReadingRecordedEventSchema,
} from './contracts';

describe('platform event schemas', () => {
    it.each([
        deviceStateReportedEventSchema,
        deviceHealthChangedEventSchema,
        telemetryReadingRecordedEventSchema,
        commandRequestedEventSchema,
        commandDispatchedEventSchema,
        commandConfirmedEventSchema,
        commandFailedEventSchema,
        commandTimedOutEventSchema,
    ])('accepts its documented lifecycle event', (schema) => {
        expect(schema.safeParse(createEvent(schema.shape.eventType.value)).success).toBe(true);
    });

    it('requires a non-empty commandId on lifecycle events', () => {
        expect(
            commandRequestedEventSchema.safeParse({
                ...createEvent('command.requested'),
                commandId: '',
            }).success,
        ).toBe(false);
    });

    it('normalizes accepted ISO timestamps with an offset to UTC', () => {
        const result = telemetryReadingRecordedEventSchema.parse({
            ...createEvent('telemetry.reading.recorded'),
            occurredAt: '2026-06-08T11:30:00+02:00',
        });

        expect(result.occurredAt).toBe('2026-06-08T09:30:00Z');
    });

    it('rejects unsupported event types from the full event contract', () => {
        expect(
            platformEventEnvelopeSchema.safeParse({
                ...createEvent('telemetry.reading.recorded'),
                eventType: 'device.unknown',
            }).success,
        ).toBe(false);
    });

    it('preserves unknown event types for classification while normalizing their timestamp', () => {
        const candidate = platformEventCandidateSchema.parse({
            ...createEvent('telemetry.reading.recorded'),
            eventType: 'device.unknown',
            version: 2,
            occurredAt: '2026-06-08T11:30:00+02:00',
        });

        expect(candidate.occurredAt).toBe('2026-06-08T09:30:00Z');
        expect(platformEventEnvelopeSchema.safeParse(candidate).success).toBe(false);
    });

    it('rejects semantically invalid set.power lifecycle facts', () => {
        expect(
            commandRequestedEventSchema.safeParse({
                ...createEvent('command.requested'),
                payload: {
                    commandType: 'set.power',
                    requestedState: {},
                    requestedBy: 'user',
                },
            }).success,
        ).toBe(false);
        expect(
            commandConfirmedEventSchema.safeParse({
                ...createEvent('command.confirmed'),
                payload: {
                    confirmationSource: 'command.failed',
                    matchedState: { power: 'on' },
                },
            }).success,
        ).toBe(false);
    });
});

describe('realtime schemas', () => {
    it('requires dispatchedAt for a pending command', () => {
        expect(
            roomRealtimeServerMessageSchema.safeParse({
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
            }).success,
        ).toBe(false);
    });

    it('accepts only documented active command states and metadata', () => {
        expect(
            roomRealtimeServerMessageSchema.safeParse(
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
            ).success,
        ).toBe(true);
        expect(
            roomRealtimeServerMessageSchema.safeParse(
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
            ).success,
        ).toBe(false);
        expect(
            roomRealtimeServerMessageSchema.safeParse(
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
            ).success,
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
            roomRealtimeServerMessageSchema.safeParse(
                createSnapshotWithActiveCommands([
                    activeCommand,
                    { ...activeCommand, commandId: 'cmd-2' },
                ]),
            ).success,
        ).toBe(false);
        expect(
            roomRealtimeServerMessageSchema.safeParse({
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
            }).success,
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
