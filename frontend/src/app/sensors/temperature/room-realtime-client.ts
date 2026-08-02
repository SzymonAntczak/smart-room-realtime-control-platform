import {
    type DeviceProjection,
    type DeviceState,
    type EventFeedItemProjection,
    isRoomRealtimeServerMessage,
    type PlatformEventSource,
    type RoomRealtimeServerMessage,
    type RoomSnapshotProjection,
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
                const result = applyRealtimeMessage(message);
                handlers.onSnapshot(toTemperatureSnapshotResult(result.snapshot, result.sentAt));
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

    function applyRealtimeMessage(message: RoomRealtimeServerMessage): {
        snapshot: RoomSnapshotProjection;
        sentAt: string;
    } {
        if (message.messageType === 'room.snapshot') {
            const isLegacySnapshotSession = roomSnapshot !== undefined && revision === undefined;
            if (
                (roomSnapshot || revision !== undefined) &&
                !(message.version === 1 && isLegacySnapshotSession)
            ) {
                throw new Error('Realtime room stream sent an unexpected snapshot baseline.');
            }
            roomSnapshot = message.payload;
            revision = message.version === 2 ? message.revision : undefined;
            return { snapshot: roomSnapshot, sentAt: message.sentAt };
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
        return { snapshot: roomSnapshot, sentAt: message.sentAt };
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

function toTemperatureSnapshotResult(
    snapshot: RoomSnapshotProjection,
    sentAt: string,
): TemperatureSnapshotResult {
    const temperatureDevice = snapshot.devices.find(
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
            snapshotSentAt: sentAt,
            recentEvents: (
                temperatureDevice.recentEvents ??
                snapshot.recentEvents.filter(
                    (event) => event.deviceId === temperatureDevice.deviceId,
                )
            )
                .slice(0, 10)
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
