import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomRealtimeServerMessage } from '../../../../../shared/src/contracts';
import { connectTemperatureRealtime } from './room-realtime-client';

describe('connectTemperatureRealtime', () => {
    beforeEach(() => {
        MockWebSocket.instances.length = 0;
    });

    afterEach(() => {
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
                sensorName: 'Desk Temperature',
                value: 22.4,
                unit: 'celsius',
                recordedAt: '2026-06-08T09:30:00Z',
                health: 'online',
            },
        });
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
            version: 1,
            sentAt: '2026-06-08T09:30:00Z',
            payload: {
                roomName: 'Smart Room',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
    });

    it('reports unsupported realtime message types as invalid messages', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            messageType: 'room.error',
            version: 1,
            sentAt: '2026-06-08T09:30:00Z',
            payload: {
                reason: 'internal_error',
                message: 'Stream failed.',
            },
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
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

        expect(handlers.onOpen).not.toHaveBeenCalled();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
        expect(handlers.onError).not.toHaveBeenCalled();
        expect(handlers.onClose).not.toHaveBeenCalled();
        expect(handlers.onInvalidMessage).not.toHaveBeenCalled();
    });
});

function createHandlers() {
    return {
        onOpen: vi.fn(),
        onSnapshot: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
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
        version: 1,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands: [],
            recentEvents: [],
        },
    };
}

function createTemperatureDevice() {
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
    } as const;
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
