import type { RoomRealtimeServerMessage } from '@smart-room/contracts';
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
                snapshotSentAt: '2026-06-08T09:30:01Z',
                recentEvents: [
                    {
                        eventId: 'evt-temperature-2',
                        summary: 'Temperature reading recorded',
                        occurredAt: '2026-06-08T09:30:01Z',
                        source: 'simulator-adapter',
                    },
                    {
                        eventId: 'evt-temperature-1',
                        summary: 'Temperature reading recorded',
                        occurredAt: '2026-06-08T09:30:00Z',
                        source: 'simulator-adapter',
                    },
                ],
            },
        });
    });

    it('limits the renderable temperature event feed to recent events for the sensor', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage(
            createRoomSnapshotMessage({
                recentEvents: [
                    createEventFeedItem({ eventId: 'evt-temperature-6' }),
                    createEventFeedItem({ eventId: 'evt-temperature-5' }),
                    createEventFeedItem({ eventId: 'evt-temperature-4' }),
                    createEventFeedItem({ eventId: 'evt-temperature-3' }),
                    createEventFeedItem({ eventId: 'evt-temperature-2' }),
                    createEventFeedItem({ eventId: 'evt-temperature-1' }),
                    createEventFeedItem({
                        eventId: 'evt-humidity-1',
                        deviceId: 'humidity-desk',
                    }),
                ],
            }),
        );

        expect(handlers.onSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({
                reading: expect.objectContaining({
                    recentEvents: [
                        expect.objectContaining({ eventId: 'evt-temperature-6' }),
                        expect.objectContaining({ eventId: 'evt-temperature-5' }),
                        expect.objectContaining({ eventId: 'evt-temperature-4' }),
                        expect.objectContaining({ eventId: 'evt-temperature-3' }),
                        expect.objectContaining({ eventId: 'evt-temperature-2' }),
                    ],
                }),
            }),
        );
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

    it('reconnects after an invalid snapshot and accepts a later valid snapshot', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, {
            reconnectDelayMs: 1000,
        });

        MockWebSocket.latest().emitMessage(createRoomSnapshotMessage());
        MockWebSocket.latest().emitMessage({
            messageType: 'room.snapshot',
            version: 1,
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

    it('reports unsupported snapshot versions as invalid messages', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket);

        MockWebSocket.latest().emitMessage({
            ...createRoomSnapshotMessage(),
            version: 2,
        });

        expect(handlers.onInvalidMessage).toHaveBeenCalledOnce();
        expect(handlers.onSnapshot).not.toHaveBeenCalled();
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

    it('reports connection status and reconnects after the stream closes', () => {
        const handlers = createHandlers();
        connectTemperatureRealtime(handlers, MockWebSocket, {
            reconnectDelayMs: 1000,
        });

        expect(handlers.onConnectionStatus).toHaveBeenCalledWith('connecting');

        MockWebSocket.latest().emitOpen();
        expect(handlers.onConnectionStatus).toHaveBeenLastCalledWith('connected');

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
    recentEvents = [
        createEventFeedItem({
            eventId: 'evt-temperature-2',
            occurredAt: '2026-06-08T09:30:01Z',
        }),
        createEventFeedItem({
            eventId: 'evt-temperature-1',
            occurredAt: '2026-06-08T09:30:00Z',
        }),
    ],
}: {
    devices?: RoomRealtimeServerMessage extends { payload: infer Payload }
        ? Payload extends { devices: infer Devices }
            ? Devices
            : never
        : never;
    recentEvents?: RoomRealtimeServerMessage extends { payload: infer Payload }
        ? Payload extends { recentEvents: infer RecentEvents }
            ? RecentEvents
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
            recentEvents,
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

function createEventFeedItem({
    eventId,
    deviceId = 'temp-desk',
    occurredAt = '2026-06-08T09:30:00Z',
}: {
    eventId: string;
    deviceId?: string;
    occurredAt?: string;
}) {
    return {
        eventId,
        eventType: 'telemetry.reading.recorded',
        occurredAt,
        source: 'simulator-adapter',
        deviceId,
        commandId: undefined,
        summary: 'Temperature reading recorded',
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
