import type { RoomRealtimeServerMessage, RoomSnapshotProjection } from '@smart-room/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { connectTemperatureRealtime } from './room-realtime-client';

describe('connectTemperatureRealtime', () => {
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('connects to the default realtime room endpoint', () => {
        connectTemperatureRealtime(createHandlers(), MockWebSocket);

        expect(MockWebSocket.instances[0]?.url).toBe('ws://localhost:4310/room/realtime');
    });

    it('connects to the configured realtime room endpoint', () => {
        vi.stubEnv('VITE_ROOM_REALTIME_URL', 'ws://127.0.0.1:4999/room/realtime');

        connectTemperatureRealtime(createHandlers(), MockWebSocket);

        expect(MockWebSocket.instances[0]?.url).toBe('ws://127.0.0.1:4999/room/realtime');
    });

    it('emits a renderable temperature snapshot from a room snapshot message', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledWith({
            status: 'ready',
            reading: {
                sensorId: 'temp-desk',
                sensorName: 'Desk Temperature',
                value: 22.4,
                unit: 'celsius',
                recordedAt: '2026-06-08T09:30:00Z',
                health: 'online',
            },
        });
    });

    it('rejects a realtime snapshot whose timestamp is not canonical UTC', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            sentAt: '2026-06-08T11:30:01+02:00',
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('emits empty when the room snapshot has no temperature sensor', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({
                devices: [],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledWith({
            status: 'empty',
        });
    });

    it('reports invalid messages without rendering them', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            messageType: 'room.snapshot',
            sentAt: '2026-06-08T09:30:00Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a snapshot carrying removed history fields', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            payload: { ...createRoomSnapshotMessage().payload, recentEvents: [] },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reconnects after an invalid snapshot and accepts a later valid snapshot', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, {
            reconnectDelayMs: 1000,
        });

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
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

        expect(MockWebSocket.instances).toHaveLength(2);

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledTimes(2);
    });

    it('reports unsupported realtime message types as invalid messages', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            messageType: 'room.error',
            sentAt: '2026-06-08T09:30:00Z',
            payload: {
                reason: 'internal_error',
                message: 'Stream failed.',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a snapshot carrying a removed contract field', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            version: 1,
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('rejects a delta carrying a removed contract field without replacing the valid view', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            version: 1,
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reports snapshots with invalid timestamps as invalid messages', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            sentAt: 'not-a-timestamp',
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('applies a contiguous device delta with current state and health', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(
            createDeviceUpdatedMessage({
                reportedState: { temperature: 23.1, temperatureUnit: 'celsius' },
                health: 'stale',
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenLastCalledWith(
            expect.objectContaining({
                reading: expect.objectContaining({
                    value: 23.1,
                    health: 'stale',
                }),
            }),
        );
    });

    it('rejects removed history fields without replacing the valid view', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
            ...createDeviceUpdatedMessage(),
            payload: { ...createTemperatureDevice(), recentEvents: [] },
        });

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('preserves the valid view and reconnects after a revision gap', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(
            createDeviceUpdatedMessage({ previousRevision: 1, revision: 2 }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects a delta for an unknown device without replacing the valid view', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(createDeviceUpdatedMessage({ deviceId: 'temp-window' }));

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('rejects an unexpected snapshot after the baseline instead of resetting the revision', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, { reconnectDelayMs: 1000 });
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());

        expect(handlers.onSnapshot).toHaveBeenCalledOnce();
        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('reports connection status and reconnects after the stream closes', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, {
            reconnectDelayMs: 1000,
        });

        expect(handlers.onConnectionStatus).toHaveBeenCalledWith('connecting');

        MockWebSocket.latest().emitOpen();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('connecting');

        MockWebSocket.latest().emitClose();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
        expect(MockWebSocket.instances).toHaveLength(1);

        vi.advanceTimersByTime(1000);

        expect(MockWebSocket.instances).toHaveLength(2);
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('reconnecting');
    });

    it('ignores late WebSocket events after the connection is closed by the client', () => {
        const handlers = createHandlers();
        const connection = connectTemperatureRealtime(handlers, MockWebSocket);
        const socket = MockWebSocket.latest();

        connection.close();
        socket.emitOpen();
        socket.emitMessage(createRoomSnapshotMessage());
        socket.emitError();
        socket.emitClose();
        vi.advanceTimersByTime(1000);

        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
        expect(MockWebSocket.instances).toHaveLength(1);
    });
});

function createHandlers() {
    return {
        onConnectionStatus: vi.fn(),
        onSnapshot: vi.fn(),
        onInvalidMessage: vi.fn(),
    };
}

function createRoomSnapshotMessage({
    devices = [createTemperatureDevice()],
}: {
    devices?: RoomRealtimeServerMessage extends { payload: infer Payload }
        ? Payload extends { devices: infer Devices }
            ? Devices
            : never
        : never;
} = {}): RoomRealtimeServerMessage {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands: [],
            recentCommands: [],
        },
    };
}

function createDeviceUpdatedMessage({
    previousRevision = 0,
    revision = 1,
    deviceId = 'temp-desk',
    health,
    reportedState = { temperature: 22.8, temperatureUnit: 'celsius' },
}: {
    previousRevision?: number;
    revision?: number;
    deviceId?: string;
    health?: RoomSnapshotProjection['devices'][number]['health'];
    reportedState?: { temperature: number; temperatureUnit: 'celsius' };
} = {}): RoomRealtimeServerMessage {
    return {
        messageType: 'device.updated',
        previousRevision,
        revision,
        sentAt: '2026-06-08T09:30:02Z',
        payload: {
            ...createTemperatureDevice(),
            deviceId,
            ...(health ? { health } : {}),
            reportedState,
        },
    };
}

function createTemperatureDevice(): RoomSnapshotProjection['devices'][number] {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        health: 'online',
        reportedState: {
            temperature: 22.4,
            temperatureUnit: 'celsius',
        },
        commandAvailability: {
            policy: 'block',
            reason: 'read_only_device',
        },
        lastSeenAt: '2026-06-08T09:30:00Z',
    };
}

class MockWebSocket extends EventTarget {
    static instances: MockWebSocket[] = [];

    readonly url: string;

    constructor(url: string) {
        super();
        this.url = url;
        MockWebSocket.instances.push(this);
    }

    static latest(): MockWebSocket {
        const instance = MockWebSocket.instances.at(-1);

        if (!instance) {
            throw new Error('No mock websocket instance was created.');
        }

        return instance;
    }

    close(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitOpen(): void {
        this.dispatchEvent(new Event('open'));
    }

    emitError(): void {
        this.dispatchEvent(new Event('error'));
    }

    emitClose(): void {
        this.dispatchEvent(new Event('close'));
    }

    emitMessage(data: unknown): void {
        this.dispatchEvent(
            new MessageEvent('message', {
                data: JSON.stringify(data),
            }),
        );
    }
}
