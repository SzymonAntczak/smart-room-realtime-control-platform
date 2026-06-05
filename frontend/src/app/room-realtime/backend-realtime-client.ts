import type { RealtimeClient, RoomSnapshotSubscriber } from './realtime-client';
import type { RoomSnapshotView, SetPowerCommandRequest } from '../room-control/room-view-model';

type BackendRoomMessage =
    | {
          messageType: 'room.snapshot';
          snapshot: RoomSnapshotView;
      }
    | {
          messageType: 'room.updated';
          snapshot: RoomSnapshotView;
      };

const connectingSnapshot: RoomSnapshotView = {
    roomName: 'Local Smart Room',
    connectionStatus: 'connecting',
    updatedAt: new Date(0).toISOString(),
    devices: [],
    activeCommands: [],
    recentEvents: [],
};

export function createBackendRealtimeClient(url: string): RealtimeClient {
    const subscribers = new Set<RoomSnapshotSubscriber>();
    let snapshot = connectingSnapshot;
    let socket: WebSocket | undefined;

    function publish(nextSnapshot: RoomSnapshotView) {
        snapshot = nextSnapshot;
        subscribers.forEach((subscriber) => subscriber(snapshot));
    }

    function publishConnectionStatus(connectionStatus: RoomSnapshotView['connectionStatus']) {
        publish({
            ...snapshot,
            connectionStatus,
            updatedAt: new Date().toISOString(),
        });
    }

    function connect() {
        if (socket && socket.readyState !== WebSocket.CLOSED) {
            return;
        }

        publishConnectionStatus('connecting');
        socket = new WebSocket(url);

        socket.addEventListener('open', () => {
            publishConnectionStatus('connected');
        });

        socket.addEventListener('message', (event: MessageEvent<string>) => {
            const message = parseBackendRoomMessage(event.data);

            if (message) {
                publish({
                    ...message.snapshot,
                    connectionStatus: 'connected',
                });
            }
        });

        socket.addEventListener('close', () => {
            publishConnectionStatus('disconnected');
        });
    }

    return {
        getInitialSnapshot() {
            return snapshot;
        },

        subscribe(subscriber) {
            subscribers.add(subscriber);
            connect();

            return () => {
                subscribers.delete(subscriber);
            };
        },

        async sendCommand(command: SetPowerCommandRequest) {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                throw new Error('Realtime backend is not connected.');
            }

            socket.send(
                JSON.stringify({
                    messageType: 'command.request',
                    command,
                }),
            );
        },
    };
}

function parseBackendRoomMessage(serialized: string) {
    let parsed: unknown;

    try {
        parsed = JSON.parse(serialized);
    } catch {
        return undefined;
    }

    if (!isBackendRoomMessage(parsed)) {
        return undefined;
    }

    return parsed;
}

function isBackendRoomMessage(value: unknown): value is BackendRoomMessage {
    if (!isRecord(value)) {
        return false;
    }

    return (
        (value.messageType === 'room.snapshot' || value.messageType === 'room.updated') &&
        isRoomSnapshot(value.snapshot)
    );
}

function isRoomSnapshot(value: unknown): value is RoomSnapshotView {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.roomName === 'string' &&
        typeof value.updatedAt === 'string' &&
        Array.isArray(value.devices) &&
        Array.isArray(value.activeCommands) &&
        Array.isArray(value.recentEvents)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
