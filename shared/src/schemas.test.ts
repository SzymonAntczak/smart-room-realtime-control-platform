import { describe, expect, it } from 'vitest';

import {
    acceptedCommandResponseSchema,
    rejectedCommandResponseSchema,
    setPowerCommandRequestSchema,
} from './commands';
import {
    commandDispatchedEventSchema,
    commandFailedEventSchema,
    commandRequestedEventSchema,
    commandTimedOutEventSchema,
    deviceHealthChangedEventSchema,
    deviceStateReportedEventSchema,
    platformEventCandidateSchema,
    platformEventEnvelopeSchema,
    telemetryReadingRecordedEventSchema,
} from './events';
import { isRoomRealtimeServerMessage, isRoomSnapshotProjection } from './realtime';
import { isSchema, normalizeIsoTimestamp } from './validation';
/*
    platformEventCandidateSchema,
    platformEventEnvelopeSchema,
    rejectedCommandResponseSchema,
    setPowerCommandRequestSchema,
    telemetryReadingRecordedEventSchema,
*/

describe('set.power HTTP contracts', () => {
    const request = {
        deviceId: 'led-main',
        commandType: 'set.power',
        requestedState: { power: 'on' },
    } as const;

    it('accepts a valid request and rejects malformed or undocumented input', () => {
        expect(isSchema(setPowerCommandRequestSchema, request)).toBe(true);
        expect(
            isSchema(setPowerCommandRequestSchema, {
                ...request,
                requestedState: { power: 'dim' },
            }),
        ).toBe(false);
        expect(
            isSchema(setPowerCommandRequestSchema, {
                ...request,
                requestedState: { power: 'on', brightness: 50 },
            }),
        ).toBe(false);
        expect(isSchema(setPowerCommandRequestSchema, { ...request, deviceId: '' })).toBe(false);
        expect(
            isSchema(setPowerCommandRequestSchema, { ...request, commandType: 'set.level' }),
        ).toBe(false);
        expect(isSchema(setPowerCommandRequestSchema, { ...request, confirmed: true })).toBe(false);
    });

    it('distinguishes backend acceptance from rejection without a confirmation field', () => {
        expect(
            isSchema(acceptedCommandResponseSchema, { commandId: 'cmd-1', status: 'accepted' }),
        ).toBe(true);
        expect(
            isSchema(acceptedCommandResponseSchema, {
                commandId: 'cmd-1',
                status: 'confirmed',
            }),
        ).toBe(false);
        expect(
            isSchema(rejectedCommandResponseSchema, {
                commandId: 'cmd-2',
                status: 'rejected',
                reason: 'command_already_active',
                message: 'The device already has an active command.',
            }),
        ).toBe(true);
        expect(
            isSchema(rejectedCommandResponseSchema, {
                status: 'rejected',
                reason: 'command_already_active',
                message: 'The device already has an active command.',
            }),
        ).toBe(false);
    });
});

describe('platform event schemas', () => {
    it.each([
        [deviceStateReportedEventSchema, 'device.state.reported'],
        [deviceHealthChangedEventSchema, 'device.health.changed'],
        [telemetryReadingRecordedEventSchema, 'telemetry.reading.recorded'],
        [commandRequestedEventSchema, 'command.requested'],
        [commandDispatchedEventSchema, 'command.dispatched'],
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
            isSchema(platformEventEnvelopeSchema, {
                ...createEvent('command.dispatched'),
                eventType: 'command.confirmed',
            }),
        ).toBe(false);
    });
});

describe('realtime schemas', () => {
    it('accepts an atomic command update and rejects an inconsistent projection', () => {
        const update = createCommandsUpdatedMessage();
        const terminalCommand = {
            commandId: 'cmd-terminal',
            deviceId: 'led-main',
            commandType: 'set.power',
            status: 'confirmed',
            requestedState: { power: 'on' },
            requestedAt: '2026-06-08T09:30:00Z',
            dispatchedAt: '2026-06-08T09:30:01Z',
            confirmedAt: '2026-06-08T09:30:02Z',
        } as const;

        expect(isRoomRealtimeServerMessage(update)).toBe(true);
        expect(
            isRoomRealtimeServerMessage({
                ...update,
                revision: 2,
            }),
        ).toBe(false);

        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    devices: [createLedDevice()],
                    activeCommands: [],
                    recentCommands: [
                        {
                            ...terminalCommand,
                            commandId: 'cmd-older',
                            confirmedAt: '2026-06-08T09:30:01Z',
                        },
                        {
                            ...terminalCommand,
                            commandId: 'cmd-newer',
                            confirmedAt: '2026-06-08T09:30:02Z',
                        },
                    ],
                },
            }),
        ).toBe(false);
        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    ...update.payload,
                    devices: [{ ...update.payload.devices[0], activeCommandId: 'cmd-other' }],
                },
            }),
        ).toBe(false);
        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    ...update.payload,
                    recentCommands: [
                        {
                            commandId: 'cmd-1',
                            deviceId: 'led-main',
                            commandType: 'set.power',
                            status: 'failed',
                            requestedState: { power: 'on' },
                            requestedAt: '2026-06-08T09:30:00Z',
                            failedAt: '2026-06-08T09:30:02Z',
                            reason: 'adapter_rejected',
                            message: 'The adapter rejected the command.',
                        },
                    ],
                },
            }),
        ).toBe(false);
    });

    it('rejects commands for read-only devices and terminal histories outside their bounds', () => {
        const update = createCommandsUpdatedMessage();

        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    ...update.payload,
                    devices: [
                        {
                            ...update.payload.devices[0],
                            role: 'temperature-sensor',
                            commandAvailability: { policy: 'block', reason: 'read_only_device' },
                        },
                    ],
                },
            }),
        ).toBe(false);

        const terminalCommand = {
            commandId: 'cmd-terminal',
            deviceId: 'led-main',
            commandType: 'set.power',
            status: 'confirmed',
            requestedState: { power: 'on' },
            requestedAt: '2026-06-08T09:30:00Z',
            dispatchedAt: '2026-06-08T09:30:01Z',
            confirmedAt: '2026-06-08T09:30:02Z',
        } as const;
        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    devices: [createLedDevice()],
                    activeCommands: [],
                    recentCommands: Array.from({ length: 21 }, (_, index) => ({
                        ...terminalCommand,
                        commandId: `cmd-${index}`,
                    })),
                },
            }),
        ).toBe(false);
    });

    it('rejects non-canonical or impossible command lifecycle timing', () => {
        const update = createCommandsUpdatedMessage();

        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    ...update.payload,
                    activeCommands: [
                        {
                            ...update.payload.activeCommands[0],
                            dispatchedAt: '2026-06-08T09:30:01+02:00',
                        },
                    ],
                },
            }),
        ).toBe(false);
        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    devices: [createLedDevice()],
                    activeCommands: [],
                    recentCommands: [
                        {
                            commandId: 'cmd-failed',
                            deviceId: 'led-main',
                            commandType: 'set.power',
                            status: 'failed',
                            requestedState: { power: 'on' },
                            requestedAt: '2026-06-08T09:30:02Z',
                            dispatchedAt: '2026-06-08T09:30:01Z',
                            failedAt: '2026-06-08T09:30:03Z',
                            reason: 'adapter_rejected',
                            message: 'The adapter rejected the command.',
                        },
                    ],
                },
            }),
        ).toBe(false);
    });

    it('accepts only a contiguous device update without event history', () => {
        const update = createDeviceUpdatedMessage();

        expect(isRoomRealtimeServerMessage(update)).toBe(true);
        expect(
            isRoomRealtimeServerMessage({
                ...update,
                revision: 2,
            }),
        ).toBe(false);
        expect(
            isRoomRealtimeServerMessage({
                ...update,
                payload: {
                    ...update.payload,
                    recentEvents: [],
                },
            }),
        ).toBe(false);
    });

    it('rejects a snapshot containing removed root event history', () => {
        const snapshot = createSnapshotWithActiveCommands([]);
        snapshot.revision = 0;

        expect(
            isRoomRealtimeServerMessage({
                ...snapshot,
                payload: { ...snapshot.payload, recentEvents: [] },
            }),
        ).toBe(false);
    });

    it('rejects duplicate device identifiers in a room snapshot', () => {
        const snapshot = createSnapshotWithActiveCommands([]);
        snapshot.payload.devices = [createLedDevice(), createLedDevice()];

        expect(isRoomRealtimeServerMessage(snapshot)).toBe(false);
    });

    it('requires dispatchedAt for a pending command', () => {
        expect(
            isRoomRealtimeServerMessage({
                messageType: 'room.snapshot',
                revision: 0,
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
                    recentCommands: [],
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
                ...createSnapshotWithActiveCommands([]),
                payload: {
                    ...createSnapshotWithActiveCommands([]).payload,
                    devices: [
                        createLedDevice('cmd-duplicate'),
                        {
                            ...createLedDevice('cmd-duplicate'),
                            deviceId: 'led-secondary',
                            name: 'Secondary LED',
                        },
                    ],
                    activeCommands: [
                        activeCommand,
                        {
                            ...activeCommand,
                            deviceId: 'led-secondary',
                        },
                    ],
                },
            }),
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

    it('accepts terminal command history and rejects active or dangling entries', () => {
        const snapshot = createSnapshotWithActiveCommands([]);
        snapshot.payload.devices = [createLedDevice()];
        snapshot.payload.recentCommands = [
            {
                commandId: 'cmd-confirmed',
                deviceId: 'led-main',
                commandType: 'set.power',
                status: 'confirmed',
                requestedState: { power: 'on' },
                requestedAt: '2026-06-08T09:30:00Z',
                dispatchedAt: '2026-06-08T09:30:01Z',
                confirmedAt: '2026-06-08T09:30:02Z',
            },
        ];

        expect(isRoomRealtimeServerMessage(snapshot)).toBe(true);

        snapshot.payload.recentCommands[0] = {
            ...snapshot.payload.recentCommands[0],
            dispatchedAt: '2026-06-08T09:30:00.500Z',
        };
        expect(isRoomRealtimeServerMessage(snapshot)).toBe(true);

        expect(
            isRoomRealtimeServerMessage({
                ...snapshot,
                payload: {
                    ...snapshot.payload,
                    recentCommands: [
                        {
                            ...snapshot.payload.recentCommands[0],
                            status: 'pending',
                        },
                    ],
                },
            }),
        ).toBe(false);
        expect(
            isRoomRealtimeServerMessage({
                ...snapshot,
                payload: {
                    ...snapshot.payload,
                    recentCommands: [
                        {
                            ...snapshot.payload.recentCommands[0],
                            deviceId: 'unknown-led',
                        },
                    ],
                },
            }),
        ).toBe(false);
    });

    it('requires command history in every snapshot', () => {
        const snapshot = createSnapshotWithActiveCommands([]);
        const payloadWithoutHistory = Object.fromEntries(
            Object.entries(snapshot.payload).filter(([key]) => key !== 'recentCommands'),
        );

        expect(isRoomRealtimeServerMessage({ ...snapshot, payload: payloadWithoutHistory })).toBe(
            false,
        );
    });

    it('requires failure detail for failed and timed-out command history', () => {
        const snapshot = createSnapshotWithActiveCommands([]);
        snapshot.payload.devices = [createLedDevice()];
        snapshot.payload.recentCommands = [
            {
                commandId: 'cmd-failed',
                deviceId: 'led-main',
                commandType: 'set.power',
                status: 'failed',
                requestedState: { power: 'on' },
                requestedAt: '2026-06-08T09:30:00Z',
                failedAt: '2026-06-08T09:30:01Z',
            },
        ];

        expect(isRoomRealtimeServerMessage(snapshot)).toBe(false);
        snapshot.payload.recentCommands[0] = {
            ...snapshot.payload.recentCommands[0],
            reason: 'command_rejected',
            message: 'The device rejected this command.',
        };
        expect(isRoomRealtimeServerMessage(snapshot)).toBe(true);

        snapshot.payload.recentCommands[0] = {
            commandId: 'cmd-timeout',
            deviceId: 'led-main',
            commandType: 'set.power',
            status: 'timed_out',
            requestedState: { power: 'on' },
            requestedAt: '2026-06-08T09:30:00Z',
            dispatchedAt: '2026-06-08T09:30:01Z',
            timedOutAt: '2026-06-08T09:30:02Z',
        };
        expect(isRoomRealtimeServerMessage(snapshot)).toBe(false);
    });
});

function createSnapshotWithActiveCommands(activeCommands: unknown[]): {
    messageType: string;
    revision: number;
    sentAt: string;
    payload: {
        roomName: string;
        updatedAt: string;
        devices: Record<string, unknown>[];
        activeCommands: unknown[];
        recentCommands: Record<string, unknown>[];
    };
} {
    const firstCommand = activeCommands[0] as { commandId?: string } | undefined;

    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices: activeCommands.length > 0 ? [createLedDevice(firstCommand?.commandId)] : [],
            activeCommands,
            recentCommands: [],
        },
    };
}

function createLedDevice(activeCommandId?: string) {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        reportedState: { power: 'off' },
        observationStatus: {
            power: { freshness: 'unknown', lastObservedAt: '2026-06-08T09:30:00Z' },
        },
        commandAvailability: { policy: 'allow' },
        ...(activeCommandId ? { activeCommandId } : {}),
    };
}

function createDeviceUpdatedMessage() {
    return {
        messageType: 'device.updated' as const,
        previousRevision: 0,
        revision: 1,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            deviceId: 'temp-desk',
            name: 'Desk Temperature',
            role: 'temperature-sensor' as const,
            availability: 'online' as const,
            availabilityChangedAt: '2026-06-08T09:30:00Z',
            health: 'healthy' as const,
            healthChangedAt: '2026-06-08T09:30:00Z',
            reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
            observationStatus: {
                temperature: {
                    freshness: 'fresh' as const,
                    lastObservedAt: '2026-06-08T09:30:00Z',
                },
            },
            commandAvailability: { policy: 'block' as const, reason: 'read_only_device' },
        },
    };
}

function createCommandsUpdatedMessage() {
    return {
        messageType: 'commands.updated' as const,
        previousRevision: 4,
        revision: 5,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            devices: [createLedDevice('cmd-1')],
            activeCommands: [
                {
                    commandId: 'cmd-1',
                    deviceId: 'led-main',
                    commandType: 'set.power' as const,
                    status: 'pending' as const,
                    requestedState: { power: 'on' as const },
                    requestedAt: '2026-06-08T09:30:00Z',
                    dispatchedAt: '2026-06-08T09:30:01Z',
                },
            ],
            recentCommands: [],
        },
    };
}

function createEvent(eventType: string) {
    const base = {
        eventId: 'evt-1',
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
                payload: { previousHealth: 'degraded', health: 'healthy', reason: 'recovered' },
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
