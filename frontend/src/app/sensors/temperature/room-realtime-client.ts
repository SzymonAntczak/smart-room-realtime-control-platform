import type {
    CommandAvailability,
    CommandAvailabilityPolicy,
    DeviceHealth,
    DeviceProjection,
    DeviceRole,
    DeviceState,
    RoomRealtimeServerMessage,
} from '../../../../../shared/src/contracts';

const defaultRoomRealtimeUrl = 'ws://localhost:4310/room/realtime';

export type TemperatureSnapshotResult =
    | {
          status: 'ready';
          reading: TemperatureSensorReading;
      }
    | {
          status: 'empty';
      };

export interface TemperatureSensorReading {
    sensorName: string;
    value: number;
    unit: 'celsius';
    recordedAt: string;
    health: DeviceProjection['health'];
}

export interface TemperatureRealtimeClientHandlers {
    onOpen(): void;
    onSnapshot(snapshot: TemperatureSnapshotResult): void;
    onError(): void;
    onClose(): void;
    onInvalidMessage(): void;
}

export interface TemperatureRealtimeConnection {
    close(): void;
}

type RealtimeWebSocket = Pick<WebSocket, 'addEventListener' | 'close'>;
type WebSocketConstructor = new (url: string) => RealtimeWebSocket;

export function connectTemperatureRealtime(
    handlers: TemperatureRealtimeClientHandlers,
    WebSocketImplementation: WebSocketConstructor = WebSocket,
): TemperatureRealtimeConnection {
    const socket = new WebSocketImplementation(getRoomRealtimeUrl());
    let isClosed = false;

    socket.addEventListener('open', () => {
        if (!isClosed) {
            handlers.onOpen();
        }
    });
    socket.addEventListener('error', () => {
        if (!isClosed) {
            handlers.onError();
        }
    });
    socket.addEventListener('close', () => {
        if (!isClosed) {
            handlers.onClose();
        }
    });
    socket.addEventListener('message', (event) => {
        if (isClosed) {
            return;
        }

        try {
            handlers.onSnapshot(toTemperatureSnapshotResult(parseRoomRealtimeMessage(event.data)));
        } catch {
            handlers.onInvalidMessage();
        }
    });

    return {
        close() {
            isClosed = true;
            socket.close();
        },
    };
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
        throw new Error('Realtime message did not match the expected contract.');
    }

    return body;
}

function toTemperatureSnapshotResult(
    message: RoomRealtimeServerMessage,
): TemperatureSnapshotResult {
    const temperatureDevice = message.payload.devices.find(
        (device) => device.role === 'temperature-sensor',
    );

    if (!temperatureDevice) {
        return {
            status: 'empty',
        };
    }

    if (!isRenderableTemperatureDevice(temperatureDevice)) {
        throw new Error('Temperature sensor data did not match the expected contract.');
    }

    return {
        status: 'ready',
        reading: {
            sensorName: temperatureDevice.name,
            value: temperatureDevice.reportedState.temperature,
            unit: temperatureDevice.reportedState.temperatureUnit,
            recordedAt: temperatureDevice.lastSeenAt,
            health: temperatureDevice.health,
        },
    };
}

function isRoomRealtimeServerMessage(value: unknown): value is RoomRealtimeServerMessage {
    if (!isRecord(value)) {
        return false;
    }

    if (value.messageType === 'room.snapshot') {
        return (
            value.version === 1 &&
            typeof value.sentAt === 'string' &&
            isRoomSnapshotPayload(value.payload)
        );
    }

    return false;
}

function isRoomSnapshotPayload(value: unknown): value is { devices: DeviceProjection[] } {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.roomName === 'string' &&
        typeof value.updatedAt === 'string' &&
        Array.isArray(value.devices) &&
        value.devices.every(isDeviceProjection) &&
        Array.isArray(value.activeCommands) &&
        Array.isArray(value.recentEvents)
    );
}

function isDeviceProjection(value: unknown): value is DeviceProjection {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.deviceId === 'string' &&
        typeof value.name === 'string' &&
        isDeviceRole(value.role) &&
        isDeviceHealth(value.health) &&
        isDeviceState(value.reportedState) &&
        isCommandAvailability(value.commandAvailability) &&
        (value.lastSeenAt === undefined || typeof value.lastSeenAt === 'string')
    );
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

function isDeviceRole(value: unknown): value is DeviceRole {
    return (
        value === 'temperature-sensor' ||
        value === 'humidity-sensor' ||
        value === 'motion-sensor' ||
        value === 'ambient-light-sensor' ||
        value === 'led-output'
    );
}

function isDeviceHealth(value: unknown): value is DeviceHealth {
    return value === 'online' || value === 'stale' || value === 'offline' || value === 'degraded';
}

function isCommandAvailability(value: unknown): value is CommandAvailability {
    if (!isRecord(value)) {
        return false;
    }

    return (
        isCommandAvailabilityPolicy(value.policy) &&
        (value.reason === undefined || typeof value.reason === 'string')
    );
}

function isCommandAvailabilityPolicy(value: unknown): value is CommandAvailabilityPolicy {
    return value === 'allow' || value === 'allow_with_warning' || value === 'block';
}

function isDeviceState(value: unknown): value is DeviceState {
    if (!isRecord(value)) {
        return false;
    }

    return Object.values(value).every(isDeviceStateValue);
}

function isDeviceStateValue(value: unknown): value is DeviceState[keyof DeviceState] {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
