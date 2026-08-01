import type {
    CommandAvailability,
    CommandAvailabilityPolicy,
    DeviceHealth,
    DeviceProjection,
    DeviceRole,
    DeviceState,
    EventFeedItemProjection,
    PlatformEventSource,
    PlatformEventType,
    RoomRealtimeServerMessage,
} from '../../../../../shared/src/contracts';
import {
    commandAvailabilityPolicies,
    deviceHealthStates,
    deviceRoles,
} from '../../../../../shared/src/devices';
import { platformEventSources, platformEventTypes } from '../../../../../shared/src/events';

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
        Array.isArray(value.recentEvents) &&
        value.recentEvents.every(isEventFeedItemProjection)
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
    return typeof value === 'string' && deviceRoles.some((role) => role === value);
}

function isDeviceHealth(value: unknown): value is DeviceHealth {
    return typeof value === 'string' && deviceHealthStates.some((health) => health === value);
}

function isEventFeedItemProjection(value: unknown): value is EventFeedItemProjection {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.eventId === 'string' &&
        isPlatformEventType(value.eventType) &&
        typeof value.occurredAt === 'string' &&
        isPlatformEventSource(value.source) &&
        (value.deviceId === undefined || typeof value.deviceId === 'string') &&
        (value.commandId === undefined || typeof value.commandId === 'string') &&
        typeof value.summary === 'string'
    );
}

function isPlatformEventType(value: unknown): value is PlatformEventType {
    return typeof value === 'string' && platformEventTypes.some((eventType) => eventType === value);
}

function isPlatformEventSource(value: unknown): value is PlatformEventSource {
    return typeof value === 'string' && platformEventSources.some((source) => source === value);
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
    return (
        typeof value === 'string' && commandAvailabilityPolicies.some((policy) => policy === value)
    );
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

function toTemperatureEventFeedItem(event: EventFeedItemProjection): TemperatureEventFeedItem {
    return {
        eventId: event.eventId,
        summary: event.summary,
        occurredAt: event.occurredAt,
        source: event.source,
    };
}
