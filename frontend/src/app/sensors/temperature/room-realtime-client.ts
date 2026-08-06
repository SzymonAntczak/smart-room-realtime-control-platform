import type { DeviceState } from '@smart-room/contracts/devices';
import {
    type DeviceProjection,
    type RoomSnapshotProjection,
} from '@smart-room/contracts/projections';
import {
    isRoomRealtimeServerMessage,
    type RoomRealtimeServerMessage,
} from '@smart-room/contracts/realtime';

const defaultRoomRealtimeUrl = 'ws://localhost:4310/room/realtime';
const defaultReconnectDelayMs = 1000;

export type TemperatureRealtimeConnectionStatus =
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected';

export interface TemperatureSensorReading {
    sensorId: string;
    sensorName: string;
    value: number;
    unit: 'celsius';
    recordedAt: string;
    health: DeviceProjection['health'];
}

export interface TemperatureRealtimeClientHandlers {
    onConnectionStatus(status: TemperatureRealtimeConnectionStatus): void;
    onSnapshot(snapshot: RoomSnapshotProjection): void;
    onInvalidMessage(): void;
}

export interface TemperatureRealtimeConnection {
    close(): void;
}

export interface TemperatureRealtimeClientOptions {
    reconnectDelayMs?: number;
}

type RealtimeWebSocket = Pick<WebSocket, 'addEventListener' | 'close'>;
type WebSocketConstructor = new (url: string) => RealtimeWebSocket;

export function connectTemperatureRealtime(
    handlers: TemperatureRealtimeClientHandlers,
    WebSocketImplementation: WebSocketConstructor = WebSocket,
    options: TemperatureRealtimeClientOptions = {},
): TemperatureRealtimeConnection {
    const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelayMs;
    let isClosed = false;
    let activeSocket: RealtimeWebSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let roomSnapshot: RoomSnapshotProjection | undefined;
    let revision: number | undefined;

    connectSocket('connecting');

    return {
        close() {
            isClosed = true;

            if (reconnectTimer !== undefined) {
                clearTimeout(reconnectTimer);
                reconnectTimer = undefined;
            }

            activeSocket?.close();
            activeSocket = undefined;
        },
    };

    function connectSocket(
        status: Extract<TemperatureRealtimeConnectionStatus, 'connecting' | 'reconnecting'>,
    ): void {
        if (isClosed) {
            return;
        }

        roomSnapshot = undefined;
        revision = undefined;
        handlers.onConnectionStatus(status);

        const socket = new WebSocketImplementation(getRoomRealtimeUrl());
        activeSocket = socket;

        socket.addEventListener('error', () => {
            scheduleReconnect(socket);
        });
        socket.addEventListener('close', () => {
            scheduleReconnect(socket);
        });
        socket.addEventListener('message', (event) => {
            if (isClosed || activeSocket !== socket) {
                return;
            }

            try {
                const message = parseRoomRealtimeMessage(event.data);
                const snapshot = applyRealtimeMessage(message);
                validateTemperatureDevices(snapshot);
                handlers.onSnapshot(snapshot);
            } catch {
                handlers.onInvalidMessage();
                scheduleReconnect(socket);
                socket.close();
            }
        });
    }

    function scheduleReconnect(socket: RealtimeWebSocket): void {
        if (isClosed || activeSocket !== socket) {
            return;
        }

        activeSocket = undefined;
        handlers.onConnectionStatus('reconnecting');

        if (reconnectTimer !== undefined) {
            return;
        }

        reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            connectSocket('reconnecting');
        }, reconnectDelayMs);
    }

    function applyRealtimeMessage(message: RoomRealtimeServerMessage): RoomSnapshotProjection {
        if (message.messageType === 'room.snapshot') {
            if (roomSnapshot || revision !== undefined) {
                throw new Error('Realtime room stream sent an unexpected snapshot baseline.');
            }
            roomSnapshot = message.payload;
            revision = message.revision;
            return roomSnapshot;
        }

        if (!roomSnapshot || revision === undefined || message.previousRevision !== revision) {
            throw new Error('Realtime room stream has a revision gap.');
        }

        switch (message.messageType) {
            case 'device.updated': {
                const deviceIndex = roomSnapshot.devices.findIndex(
                    (device) => device.deviceId === message.payload.deviceId,
                );
                if (deviceIndex === -1)
                    throw new Error('Realtime update references an unknown device.');
                const devices = [...roomSnapshot.devices];
                devices[deviceIndex] = message.payload;
                roomSnapshot = { ...roomSnapshot, devices };
                break;
            }
        }

        revision = message.revision;
        return roomSnapshot;
    }
}

function getRoomRealtimeUrl(): string {
    return import.meta.env.VITE_ROOM_REALTIME_URL ?? defaultRoomRealtimeUrl;
}

function parseRoomRealtimeMessage(data: unknown): RoomRealtimeServerMessage {
    if (typeof data !== 'string') {
        throw new Error('Realtime message data must be text.');
    }

    const body: unknown = JSON.parse(data);

    if (!isRoomRealtimeServerMessage(body)) {
        throw new Error('Realtime message did not match the room snapshot contract.');
    }

    return body;
}

export function toTemperatureSensorReading(device: DeviceProjection): TemperatureSensorReading {
    if (!isRenderableTemperatureDevice(device)) {
        throw new Error('Temperature sensor data did not match the expected contract.');
    }

    return {
        sensorId: device.deviceId,
        sensorName: device.name,
        value: device.reportedState.temperature,
        unit: device.reportedState.temperatureUnit,
        recordedAt: device.lastSeenAt,
        health: device.health,
    };
}

function validateTemperatureDevices(snapshot: RoomSnapshotProjection): void {
    for (const device of snapshot.devices) {
        if (device.role === 'temperature-sensor') {
            toTemperatureSensorReading(device);
        }
    }
}

function isRenderableTemperatureDevice(device: DeviceProjection): device is DeviceProjection & {
    lastSeenAt: string;
    reportedState: DeviceState & {
        temperature: number;
        temperatureUnit: 'celsius';
    };
} {
    return (
        typeof device.reportedState.temperature === 'number' &&
        device.reportedState.temperatureUnit === 'celsius' &&
        typeof device.lastSeenAt === 'string'
    );
}
