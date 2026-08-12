import { type RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    isRoomRealtimeServerMessage,
    isRoomSnapshotProjection,
    type RoomRealtimeServerMessage,
    roomRealtimeServerMessageTypes,
} from '@smart-room/contracts/realtime';

const defaultRoomRealtimeUrl = 'http://localhost:4310/room/realtime';
const defaultReconnectDelayMs = 1000;

export type RoomRealtimeConnectionStatus =
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected';

export interface RoomRealtimeClientHandlers {
    onConnectionStatus(status: RoomRealtimeConnectionStatus): void;
    onSnapshot(snapshot: RoomSnapshotProjection): void;
    onInvalidMessage(): void;
}

export interface RoomRealtimeConnection {
    close(): void;
}

export interface RoomRealtimeClientOptions {
    reconnectDelayMs?: number;
}

interface RealtimeEventSource {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void;
    close(): void;
}
type EventSourceConstructor = new (url: string) => RealtimeEventSource;

export function connectRoomRealtime(
    handlers: RoomRealtimeClientHandlers,
    EventSourceImplementation: EventSourceConstructor = EventSource,
    options: RoomRealtimeClientOptions = {},
): RoomRealtimeConnection {
    const reconnectDelayMs = options.reconnectDelayMs ?? defaultReconnectDelayMs;
    let isClosed = false;
    let activeSource: RealtimeEventSource | undefined;
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

            activeSource?.close();
            activeSource = undefined;
        },
    };

    function connectSocket(
        status: Extract<RoomRealtimeConnectionStatus, 'connecting' | 'reconnecting'>,
    ): void {
        if (isClosed) {
            return;
        }

        roomSnapshot = undefined;
        revision = undefined;
        handlers.onConnectionStatus(status);

        const source = new EventSourceImplementation(getRoomRealtimeUrl());
        activeSource = source;

        source.addEventListener('error', () => {
            scheduleReconnect(source);
            source.close();
        });

        const handleMessage = (event: Event): void => {
            if (isClosed || activeSource !== source) {
                return;
            }

            try {
                const message = parseRoomRealtimeMessage((event as MessageEvent<unknown>).data);

                if (event.type !== message.messageType) {
                    throw new Error('Realtime SSE event name did not match its message contract.');
                }

                const snapshot = applyRealtimeMessage(message);
                validateRenderableDevices(snapshot);
                handlers.onSnapshot(snapshot);
            } catch {
                handlers.onInvalidMessage();
                scheduleReconnect(source);
                source.close();
            }
        };

        roomRealtimeServerMessageTypes.forEach((messageType) => {
            source.addEventListener(messageType, handleMessage);
        });
    }

    function scheduleReconnect(source: RealtimeEventSource): void {
        if (isClosed || activeSource !== source) {
            return;
        }

        activeSource = undefined;
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

                if (deviceIndex === -1) {
                    throw new Error('Realtime update references an unknown device.');
                }

                const devices = [...roomSnapshot.devices];
                devices[deviceIndex] = message.payload;
                roomSnapshot = { ...roomSnapshot, devices };
                break;
            }

            case 'commands.updated': {
                if (!hasSameDeviceSet(roomSnapshot.devices, message.payload.devices)) {
                    throw new Error('Realtime command update changed the configured device set.');
                }

                roomSnapshot = {
                    ...roomSnapshot,
                    devices: message.payload.devices,
                    activeCommands: message.payload.activeCommands,
                    recentCommands: message.payload.recentCommands,
                };

                if (!isRoomSnapshotProjection(roomSnapshot)) {
                    throw new Error(
                        'Realtime command update did not produce a valid room snapshot.',
                    );
                }

                break;
            }
        }

        revision = message.revision;

        return roomSnapshot;
    }
}

function hasSameDeviceSet(
    currentDevices: RoomSnapshotProjection['devices'],
    updatedDevices: RoomSnapshotProjection['devices'],
): boolean {
    if (currentDevices.length !== updatedDevices.length) {
        return false;
    }

    const currentDeviceIds = new Set(currentDevices.map((device) => device.deviceId));
    const updatedDeviceIds = new Set(updatedDevices.map((device) => device.deviceId));

    return (
        currentDeviceIds.size === currentDevices.length &&
        updatedDeviceIds.size === updatedDevices.length &&
        updatedDevices.every((device) => currentDeviceIds.has(device.deviceId))
    );
}

function validateRenderableDevices(snapshot: RoomSnapshotProjection): void {
    for (const device of snapshot.devices) {
        if (
            device.role === 'led-output' &&
            device.reportedState.power !== undefined &&
            device.reportedState.power !== 'on' &&
            device.reportedState.power !== 'off'
        ) {
            throw new Error('LED data did not match the expected contract.');
        }

        if (
            device.role === 'temperature-sensor' &&
            device.observationStatus.temperature?.lastObservedAt !== undefined &&
            (typeof device.reportedState.temperature !== 'number' ||
                device.reportedState.temperatureUnit !== 'celsius')
        ) {
            throw new Error('Temperature sensor data did not match the expected contract.');
        }
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
