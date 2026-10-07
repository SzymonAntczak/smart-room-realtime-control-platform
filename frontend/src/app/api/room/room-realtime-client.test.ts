import type { RoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MockEventSource } from '../../../test/room/mock-event-source';
import {
    createCommandsUpdatedMessage,
    createConfirmedCommand,
    createDeviceUpdatedMessage,
    createLedDevice,
    createPendingCommand,
    createRoomSnapshotMessage,
    createTemperatureDevice,
} from '../../../test/room/room-realtime-fixtures';

import { connectRoomRealtime } from './room-realtime-client';

describe('connectRoomRealtime', () => {
    beforeEach(() => {
        MockEventSource.instances.length = 0;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('connects to the default realtime room endpoint', () => {
        connectRoomRealtime(createHandlers(), MockEventSource);

        expect(MockEventSource.instances[0]?.url).toBe('http://localhost:4310/room/realtime');
    });

    it('connects to the configured realtime room endpoint', () => {
        vi.stubEnv('VITE_ROOM_REALTIME_URL', 'http://127.0.0.1:4999/room/realtime');

        connectRoomRealtime(createHandlers(), MockEventSource);

        expect(MockEventSource.instances[0]?.url).toBe('http://127.0.0.1:4999/room/realtime');
    });

    it('emits the full room snapshot from a room snapshot message', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledWith(createRoomSnapshotMessage().payload);
    });

    it('rejects an SSE event whose name does not match its message contract', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });

        MockEventSource.latest().emitMessage(createRoomSnapshotMessage(), 'device.updated');

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('ignores undocumented unnamed SSE message events', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage(createRoomSnapshotMessage(), 'message');

        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
    });

    it('rejects a realtime snapshot whose timestamp is not canonical UTC', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            sentAt: '2026-06-08T11:30:01+02:00',
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('keeps an empty device collection in the room snapshot', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledWith(expect.objectContaining({ devices: [] }));
    });

    it('reports invalid messages without rendering them', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage({
            messageType: 'room.snapshot',
            sentAt: '2026-06-08T09:30:00Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a snapshot that omits the required recent-event cache', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            payload: (() => {
                const snapshotWithoutRecentEvents: Record<string, unknown> = {
                    ...createRoomSnapshotMessage().payload,
                };
                delete snapshotWithoutRecentEvents['userHistory'];

                return snapshotWithoutRecentEvents;
            })(),
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reconnects after an invalid snapshot and accepts a later valid snapshot', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, {
            reconnectDelayMs: 1000,
        });

        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage({
            messageType: 'room.snapshot',
            sentAt: '2026-06-08T09:30:01Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');

        vi.advanceTimersByTime(1000);

        expect(MockEventSource.instances).toHaveLength(2);

        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledTimes(2);
    });

    it('reports unsupported realtime message types as invalid messages', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage(
            {
                messageType: 'room.error',
                sentAt: '2026-06-08T09:30:00Z',
                payload: {
                    reason: 'internal_error',
                    message: 'Stream failed.',
                },
            },
            'room.snapshot',
        );

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a snapshot carrying a removed contract field', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            version: 1,
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a delta carrying a removed contract field without replacing the valid view', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            version: 1,
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reports snapshots with invalid timestamps as invalid messages', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);

        MockEventSource.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            sentAt: 'not-a-timestamp',
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('applies a contiguous device delta with current state and health', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage(
            createDeviceUpdatedMessage({
                reportedState: { temperature: 23.1, temperatureUnit: 'celsius' },
                health: 'degraded',
                healthReason: 'partial_data',
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [
                    expect.objectContaining({
                        reportedState: { temperature: 23.1, temperatureUnit: 'celsius' },
                        health: 'degraded',
                    }),
                ],
            }),
        );
    });

    it('applies a contiguous platform storage delta without changing the room devices', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                storage: {
                    status: 'degraded',
                    changedAt: '2026-06-08T09:30:02Z',
                    reason: 'storage_write_failed',
                    historyGenerationId: null,
                    storedThroughSequence: null,
                },
            },
        } satisfies RoomBffRealtimeServerMessage);

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                platform: expect.objectContaining({
                    storage: expect.objectContaining({ status: 'degraded' }),
                }),
                devices: [expect.objectContaining({ deviceId: 'temp-desk' })],
            }),
        );
    });

    it('retains the event cache across repeated null-generation platform updates', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({ userHistory: [createUserHistoryFixtures().gap] }),
        );
        MockEventSource.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                storage: {
                    status: 'degraded',
                    changedAt: '2026-06-08T09:30:02Z',
                    reason: 'storage_write_failed',
                    historyGenerationId: null,
                    storedThroughSequence: null,
                },
            },
        } satisfies RoomBffRealtimeServerMessage);
        MockEventSource.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 1,
            revision: 2,
            sentAt: '2026-06-08T09:30:03Z',
            payload: {
                storage: {
                    status: 'recovering',
                    changedAt: '2026-06-08T09:30:03Z',
                    reason: 'storage_recovery_in_progress',
                    historyGenerationId: null,
                    storedThroughSequence: null,
                },
            },
        } satisfies RoomBffRealtimeServerMessage);

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ userHistory: [createUserHistoryFixtures().gap] }),
        );
    });

    it('merges a durable recovery gap from a platform delta without reconnecting', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage({
            messageType: 'platform.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-09-03T08:00:01Z',
            payload: {
                storage: {
                    status: 'available',
                    changedAt: '2026-09-03T08:00:01Z',
                    historyGenerationId: 'generation-test',
                    storedThroughSequence: 1,
                },
                userHistory: [
                    {
                        recordId: `rec:v1:sha256:${'1'.repeat(64)}`,
                        occurredAt: '2026-09-03T08:00:01.000Z',
                        durability: 'durable',
                        storageSequence: 1,
                        source: 'backend',
                        outageStartedAt: '2026-09-03T08:00:00.000Z',
                        outageEndedAt: '2026-09-03T08:00:01.000Z',
                        kind: 'history_gap',
                    },
                ],
            },
        } satisfies RoomBffRealtimeServerMessage);

        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                userHistory: [expect.objectContaining({ kind: 'history_gap' })],
            }),
        );
    });

    it('rejects a schema-valid device delta that breaks active command references', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [createLedDevice('cmd-1')],
                activeCommands: [createPendingCommand()],
            }),
        );
        MockEventSource.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            payload: createLedDevice('cmd-missing'),
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('replaces only the matching device in a multi-device room snapshot', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [
                    createTemperatureDevice(),
                    {
                        ...createTemperatureDevice(),
                        deviceId: 'temp-window',
                        name: 'Window Temperature',
                    },
                ],
            }),
        );
        MockEventSource.latest().emitMessage(
            createDeviceUpdatedMessage({
                deviceId: 'temp-window',
                reportedState: { temperature: 19.4, temperatureUnit: 'celsius' },
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [
                    expect.objectContaining({
                        deviceId: 'temp-desk',
                        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
                    }),
                    expect.objectContaining({
                        deviceId: 'temp-window',
                        reportedState: { temperature: 19.4, temperatureUnit: 'celsius' },
                    }),
                ],
            }),
        );
    });

    it('merges feed facts carried by a device update', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        const recentEvent = {
            ...createUserHistoryFixtures().availabilityChange,
            deviceId: 'temp-desk',
            deviceName: 'Desk Temperature',
        };

        MockEventSource.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            userHistory: [recentEvent],
        });

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({ userHistory: [recentEvent] }),
        );
    });

    it('applies a contiguous command delta without replacing the reported LED state', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [createLedDevice()],
            }),
        );
        MockEventSource.latest().emitMessage(createCommandsUpdatedMessage());

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [expect.objectContaining({ reportedState: { power: 'off' } })],
                activeCommands: [
                    expect.objectContaining({
                        commandId: 'cmd-1',
                        requestedState: { power: 'on' },
                        status: 'pending',
                    }),
                ],
            }),
        );
    });

    it('applies one atomic command update without losing another device command history', () => {
        const handlers = createHandlers();
        const sideDevice = { ...createLedDevice(), deviceId: 'led-side', name: 'Side LED' };
        const sideCommand = {
            ...createConfirmedCommand(),
            commandId: 'cmd-side',
            deviceId: 'led-side',
        };
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice(), sideDevice] }),
        );
        MockEventSource.latest().emitMessage(
            createCommandsUpdatedMessage({
                devices: [createLedDevice('cmd-1'), sideDevice],
                activeCommands: [createPendingCommand()],
                recentCommands: [sideCommand],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [
                    expect.objectContaining({ deviceId: 'led-main', activeCommandId: 'cmd-1' }),
                    expect.objectContaining({ deviceId: 'led-side' }),
                ],
                activeCommands: [expect.objectContaining({ commandId: 'cmd-1' })],
                recentCommands: [expect.objectContaining({ commandId: 'cmd-side' })],
            }),
        );
    });

    it.each([
        {
            label: 'removes a configured device',
            devices: [createLedDevice('cmd-1')],
        },
        {
            label: 'adds an unknown device',
            devices: [
                createLedDevice('cmd-1'),
                { ...createLedDevice(), deviceId: 'led-side', name: 'Side LED' },
                { ...createLedDevice(), deviceId: 'led-extra', name: 'Extra LED' },
            ],
        },
        {
            label: 'duplicates a device ID',
            devices: [
                createLedDevice('cmd-1'),
                { ...createLedDevice(), deviceId: 'led-main', name: 'Duplicate LED' },
            ],
        },
    ])('rejects a command update that $label without replacing the valid view', ({ devices }) => {
        const handlers = createHandlers();
        const sideDevice = { ...createLedDevice(), deviceId: 'led-side', name: 'Side LED' };
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice(), sideDevice] }),
        );
        MockEventSource.latest().emitMessage(
            createCommandsUpdatedMessage({
                devices,
                activeCommands: [createPendingCommand()],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects a non-contiguous command delta without replacing the valid view', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice()] }),
        );
        MockEventSource.latest().emitMessage(
            createCommandsUpdatedMessage({ previousRevision: 1, revision: 2 }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects a malformed command delta without replacing the valid view', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({ devices: [createLedDevice()] }),
        );
        MockEventSource.latest().emitMessage({
            ...createCommandsUpdatedMessage(),
            version: 1,
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('keeps the confirmed LED state separate when a command becomes terminal', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource);
        MockEventSource.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [createLedDevice('cmd-1')],
                activeCommands: [createPendingCommand()],
            }),
        );
        MockEventSource.latest().emitMessage(
            createCommandsUpdatedMessage({
                activeCommands: [],
                recentCommands: [createConfirmedCommand()],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                devices: [expect.objectContaining({ reportedState: { power: 'off' } })],
                activeCommands: [],
                recentCommands: [expect.objectContaining({ status: 'confirmed' })],
            }),
        );
    });

    it('preserves the valid view and reconnects after a revision gap', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage(
            createDeviceUpdatedMessage({ previousRevision: 1, revision: 2 }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects a delta for an unknown device without replacing the valid view', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage(
            createDeviceUpdatedMessage({ deviceId: 'temp-window' }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects an unexpected snapshot after the baseline instead of resetting the revision', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, { reconnectDelayMs: 1000 });
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());
        MockEventSource.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reports connection status and reconnects after the stream closes', () => {
        const handlers = createHandlers();
        connectRoomRealtime(handlers, MockEventSource, {
            reconnectDelayMs: 1000,
        });

        expect(handlers.onConnectionStatus).toHaveBeenCalledWith('connecting');

        MockEventSource.latest().emitOpen();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('connecting');

        MockEventSource.latest().emitError();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
        expect(MockEventSource.instances).toHaveLength(1);

        vi.advanceTimersByTime(1000);

        expect(MockEventSource.instances).toHaveLength(2);
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('ignores late SSE events after the connection is closed by the client', () => {
        const handlers = createHandlers();
        const connection = connectRoomRealtime(handlers, MockEventSource);
        const socket = MockEventSource.latest();

        connection.close();
        socket.emitOpen();
        socket.emitMessage(createRoomSnapshotMessage());
        socket.emitError();
        socket.emitClose();
        vi.advanceTimersByTime(1000);

        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
        expect(MockEventSource.instances).toHaveLength(1);
    });
});

function createHandlers() {
    return {
        onConnectionStatus: vi.fn(),
        onSnapshot: vi.fn(),
        onInvalidMessage: vi.fn(),
    };
}
