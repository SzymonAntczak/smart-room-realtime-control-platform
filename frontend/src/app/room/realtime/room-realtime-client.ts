import { type RoomSnapshotProjection } from '@smart-room/contracts/projections';
import {
    isRoomRealtimeServerMessage,
    type RoomRealtimeServerMessage,
} from '@smart-room/contracts/realtime';

const defaultRoomRealtimeUrl = 'ws://localhost:4310/room/realtime';
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

type RealtimeWebSocket = Pick<WebSocket, 'addEventListener' | 'close'>;
type WebSocketConstructor = new (url: string) => RealtimeWebSocket;

export function connectRoomRealtime(
    handlers: RoomRealtimeClientHandlers,
    WebSocketImplementation: WebSocketConstructor = WebSocket,
    options: RoomRealtimeClientOptions = {},
): RoomRealtimeConnection {
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
        status: Extract<RoomRealtimeConnectionStatus, 'connecting' | 'reconnecting'>,
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
                validateRenderableDevices(snapshot);
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
            case 'commands.updated': {
                const deviceIndex = roomSnapshot.devices.findIndex(
                    (device) => device.deviceId === message.payload.device.deviceId,
                );
                if (deviceIndex === -1)
                    throw new Error('Realtime update references an unknown device.');
                const devices = [...roomSnapshot.devices];
                devices[deviceIndex] = message.payload.device;
                roomSnapshot = {
                    ...roomSnapshot,
                    devices,
                    activeCommands: message.payload.activeCommands,
                    recentCommands: message.payload.recentCommands,
                };
                break;
            }
        }

        revision = message.revision;
        return roomSnapshot;
    }
}

function validateRenderableDevices(snapshot: RoomSnapshotProjection): void {
    for (const device of snapshot.devices) {
        if (
            device.role === 'led-output' &&
            device.reportedState.power !== undefined &&
            device.reportedState.power !== 'on' &&
            device.reportedState.power !== 'off'
        )
            throw new Error('LED data did not match the expected contract.');
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
