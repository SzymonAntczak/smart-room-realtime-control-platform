import {
    type DeviceProjection,
    type DeviceState,
    type EventFeedItemProjection,
    type PlatformEventSource,
    type RoomRealtimeServerMessage,
    roomRealtimeServerMessageSchema,
} from '@smart-room/contracts';

const defaultRoomRealtimeUrl = 'ws://localhost:4310/room/realtime';
const defaultReconnectDelayMs = 1000;

export type TemperatureRealtimeConnectionStatus =
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected';

export type TemperatureSnapshotResult =
    | {
          status: 'ready';
          reading: TemperatureSensorReading;
      }
    | {
          status: 'empty';
      };

export interface TemperatureSensorReading {
    sensorId: string;
    sensorName: string;
    value: number;
    unit: 'celsius';
    recordedAt: string;
    health: DeviceProjection['health'];
    snapshotSentAt: string;
    recentEvents: TemperatureEventFeedItem[];
}

export interface TemperatureEventFeedItem {
    eventId: string;
    summary: string;
    occurredAt: string;
    source: PlatformEventSource;
}

export interface TemperatureRealtimeClientHandlers {
    onConnectionStatus(status: TemperatureRealtimeConnectionStatus): void;
    onSnapshot(snapshot: TemperatureSnapshotResult): void;
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

        handlers.onConnectionStatus(status);

        const socket = new WebSocketImplementation(getRoomRealtimeUrl());
        activeSocket = socket;

        socket.addEventListener('open', () => {
            if (!isClosed && activeSocket === socket) {
                handlers.onConnectionStatus('connected');
            }
        });
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
                handlers.onSnapshot(
                    toTemperatureSnapshotResult(parseRoomRealtimeMessage(event.data)),
                );
            } catch {
                isClosed = true;
                activeSocket?.close();
                activeSocket = undefined;
                handlers.onInvalidMessage();
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
}

function getRoomRealtimeUrl(): string {
    return import.meta.env.VITE_ROOM_REALTIME_URL ?? defaultRoomRealtimeUrl;
}

function parseRoomRealtimeMessage(data: unknown): RoomRealtimeServerMessage {
    if (typeof data !== 'string') {
        throw new Error('Realtime message data must be text.');
    }

    const body: unknown = JSON.parse(data);

    return roomRealtimeServerMessageSchema.parse(body);
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
            sensorId: temperatureDevice.deviceId,
            sensorName: temperatureDevice.name,
            value: temperatureDevice.reportedState.temperature,
            unit: temperatureDevice.reportedState.temperatureUnit,
            recordedAt: temperatureDevice.lastSeenAt,
            health: temperatureDevice.health,
            snapshotSentAt: message.sentAt,
            recentEvents: message.payload.recentEvents
                .filter((event) => event.deviceId === temperatureDevice.deviceId)
                .slice(0, 5)
                .map(toTemperatureEventFeedItem),
        },
    };
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

function toTemperatureEventFeedItem(event: EventFeedItemProjection): TemperatureEventFeedItem {
    return {
        eventId: event.eventId,
        summary: event.summary,
        occurredAt: event.occurredAt,
        source: event.source,
    };
}
