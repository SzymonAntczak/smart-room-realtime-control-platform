import type { LiveTelemetrySampleProjection } from '@smart-room/contracts/history';
import { roomRealtimeServerMessageTypes } from '@smart-room/contracts/realtime';
import {
    isRoomBffSnapshot,
    type RoomBffRealtimeServerMessage,
    type RoomBffSnapshot,
} from '@smart-room/contracts/room-bff';
import {
    compareUserHistoryDescending,
    type UserHistoryItem,
} from '@smart-room/contracts/user-history';

import { type RenderableRoomSnapshot, toRenderableRoomSnapshot } from '../shared/room-rendering';

import { validateRoomBffRealtimeMessage } from './room-bff-client';

const defaultRoomRealtimeUrl = 'http://localhost:4310/room/realtime';
const defaultReconnectDelayMs = 1000;

export type RoomRealtimeConnectionStatus =
    | 'connecting'
    | 'connected'
    | 'reconnecting'
    | 'disconnected';

export interface RoomRealtimeClientHandlers {
    onConnectionStatus(status: RoomRealtimeConnectionStatus): void;
    onSnapshot(snapshot: RenderableRoomSnapshot): void;
    onInvalidMessage(): void;
    onHistoryUpdate?(
        update: RoomHistoryRealtimeUpdate,
        baseline?: Extract<RoomHistoryRealtimeUpdate, { kind: 'baseline' }>,
    ): void;
}

export type RoomHistoryRealtimeUpdate =
    | { kind: 'interrupted' }
    | {
          kind: 'baseline';
          storage: RoomBffSnapshot['platform']['storage'];
          userHistory: readonly UserHistoryItem[];
          /** Connection evidence retained when current storage metadata is unknown. */
          lastKnownHistoryGenerationId?: string | null;
      }
    | {
          kind: 'addition';
          storage: RoomBffSnapshot['platform']['storage'];
          userHistory?: readonly UserHistoryItem[];
          telemetrySample?: LiveTelemetrySampleProjection;
      };

export interface RoomRealtimeConnection {
    requestBaseline(): void;
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
    let roomSnapshot: RoomBffSnapshot | undefined;
    let revision: number | undefined;
    let lastKnownHistoryGenerationId: string | null = null;

    connectSocket('connecting');

    return {
        requestBaseline() {
            if (activeSource) {
                const source = activeSource;
                scheduleReconnect(source);
                source.close();
            }
        },
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

                const previousGenerationId = lastKnownHistoryGenerationId;
                const snapshot = applyRealtimeMessage(message);
                const incomingGenerationId = snapshot.platform.storage.historyGenerationId;
                const generationChanged =
                    incomingGenerationId !== null &&
                    previousGenerationId !== null &&
                    incomingGenerationId !== previousGenerationId;

                if (incomingGenerationId !== null) {
                    lastKnownHistoryGenerationId = incomingGenerationId;
                }

                const renderableSnapshot = toRenderableRoomSnapshot(snapshot);

                const baseline = {
                    kind: 'baseline',
                    storage: snapshot.platform.storage,
                    userHistory: snapshot.userHistory,
                    lastKnownHistoryGenerationId,
                } as const;

                if (message.messageType === 'room.snapshot' || generationChanged) {
                    handlers.onHistoryUpdate?.(baseline, baseline);
                } else {
                    handlers.onHistoryUpdate?.(
                        {
                            kind: 'addition',
                            storage: snapshot.platform.storage,
                            userHistory:
                                message.messageType === 'device.updated'
                                    ? 'userHistory' in message
                                        ? message.userHistory
                                        : undefined
                                    : message.payload.userHistory,
                            telemetrySample:
                                message.messageType === 'device.updated'
                                    ? 'telemetrySample' in message
                                        ? message.telemetrySample
                                        : undefined
                                    : undefined,
                        },
                        baseline,
                    );
                }

                handlers.onSnapshot(renderableSnapshot);
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
        handlers.onHistoryUpdate?.({ kind: 'interrupted' });

        if (reconnectTimer !== undefined) {
            return;
        }

        reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            connectSocket('reconnecting');
        }, reconnectDelayMs);
    }

    function applyRealtimeMessage(message: RoomBffRealtimeServerMessage): RoomBffSnapshot {
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
                const nextSnapshot = {
                    ...roomSnapshot,
                    devices,
                    userHistory: mergeUserHistory(
                        roomSnapshot.userHistory,
                        'userHistory' in message ? message.userHistory : undefined,
                    ),
                };

                if (!isRoomBffSnapshot(nextSnapshot)) {
                    throw new Error(
                        'Realtime device update did not produce a valid room snapshot.',
                    );
                }

                roomSnapshot = nextSnapshot;
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
                    userHistory: mergeUserHistory(
                        roomSnapshot.userHistory,
                        message.payload.userHistory,
                    ),
                };

                if (!isRoomBffSnapshot(roomSnapshot)) {
                    throw new Error(
                        'Realtime command update did not produce a valid room snapshot.',
                    );
                }

                break;
            }

            case 'platform.updated': {
                const incomingGenerationId = message.payload.storage.historyGenerationId;
                const generationChanged =
                    incomingGenerationId !== null &&
                    lastKnownHistoryGenerationId !== null &&
                    incomingGenerationId !== lastKnownHistoryGenerationId;

                roomSnapshot = {
                    ...roomSnapshot,
                    platform: { storage: message.payload.storage },
                    userHistory: generationChanged
                        ? (message.payload.userHistory ?? [])
                        : mergeUserHistory(roomSnapshot.userHistory, message.payload.userHistory),
                };

                if (!isRoomBffSnapshot(roomSnapshot)) {
                    throw new Error(
                        'Realtime platform update did not produce a valid room snapshot.',
                    );
                }

                break;
            }
        }

        revision = message.revision;

        return roomSnapshot;
    }
}

function mergeUserHistory(
    current: UserHistoryItem[],
    updates: UserHistoryItem[] | undefined,
): UserHistoryItem[] {
    if (!updates || updates.length === 0) {
        return current;
    }

    const byRecordId = new Map(current.map((event) => [event.recordId, event]));

    for (const event of updates) {
        const previous = byRecordId.get(event.recordId);

        if (!previous || event.durability === 'durable' || previous.durability !== 'durable') {
            byRecordId.set(event.recordId, event);
        }
    }

    return [...byRecordId.values()].sort(compareUserHistoryDescending).slice(0, 20);
}

function hasSameDeviceSet(
    currentDevices: RoomBffSnapshot['devices'],
    updatedDevices: RoomBffSnapshot['devices'],
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

function getRoomRealtimeUrl(): string {
    return import.meta.env.VITE_ROOM_REALTIME_URL ?? defaultRoomRealtimeUrl;
}

function parseRoomRealtimeMessage(data: unknown): RoomBffRealtimeServerMessage {
    if (typeof data !== 'string') {
        throw new Error('Realtime message data must be text.');
    }

    const body: unknown = JSON.parse(data);

    const result = validateRoomBffRealtimeMessage(body);

    if (result.kind !== 'message') {
        throw new Error('Realtime message did not match the room snapshot contract.');
    }

    return result.message;
}
