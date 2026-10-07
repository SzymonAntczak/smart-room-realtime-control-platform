import type { DeviceProjection } from '@smart-room/contracts/projections';
import type { RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import { useEffect, useState } from 'react';

import {
    connectRoomRealtime,
    type RoomRealtimeConnectionStatus,
    type RoomRealtimeUpdate,
} from '../../api/room';

import type { RenderableDeviceProjection } from './device-projection';
import type { RoomHistorySource } from './room-history-source';
import type { RoomHistoryRealtimeUpdate } from './room-history-update';

export interface RenderableRoomSnapshot extends Omit<RoomBffSnapshot, 'devices'> {
    readonly devices: RenderableDeviceProjection[];
}

type RoomRealtimeState =
    | {
          status: 'connecting';
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connecting' | 'reconnecting'>;
          contractError?: string;
      }
    | {
          status: 'ready';
          snapshot: RenderableRoomSnapshot;
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connected' | 'reconnecting'>;
          contractError?: string;
      };

type HistoryBaseline = Extract<RoomHistoryRealtimeUpdate, { kind: 'baseline' }>;

interface RoomHistoryBridge {
    readonly source: RoomHistorySource;
    setRequestBaseline(action: () => void): void;
    publish(update: RoomHistoryRealtimeUpdate, currentBaseline?: HistoryBaseline): void;
}

/** Keeps the current room baseline and synchronously forwards realtime history updates. */
function createRoomHistoryBridge(): RoomHistoryBridge {
    let baseline: HistoryBaseline | undefined;
    let requestBaseline = () => undefined as void;
    const listeners = new Set<(update: RoomHistoryRealtimeUpdate) => void>();
    const source: RoomHistorySource = {
        subscribe(listener) {
            listeners.add(listener);

            return () => {
                listeners.delete(listener);
            };
        },
        getBaseline: () => baseline,
        requestBaseline: () => requestBaseline(),
    };

    return {
        source,
        setRequestBaseline(action) {
            requestBaseline = action;
        },
        publish(update, currentBaseline) {
            baseline = update.kind === 'interrupted' ? undefined : (currentBaseline ?? baseline);

            for (const listener of [...listeners]) {
                listener(update);
            }
        },
    };
}

function toRenderableRoomSnapshot(snapshot: RoomBffSnapshot): RenderableRoomSnapshot {
    return {
        ...snapshot,
        devices: snapshot.devices.flatMap((device) => {
            const renderableDevice = toRenderableDeviceProjection(device);

            return renderableDevice ? [renderableDevice] : [];
        }),
    };
}

function toRenderableDeviceProjection(
    device: DeviceProjection,
): RenderableDeviceProjection | undefined {
    switch (device.role) {
        case 'led-output': {
            const power = device.reportedState.power;

            if (power !== undefined && power !== 'on' && power !== 'off') {
                throw new Error('LED data did not match the expected rendering contract.');
            }

            return {
                ...device,
                role: 'led-output',
                reportedState: {
                    ...device.reportedState,
                    ...(power === undefined ? {} : { power }),
                },
            };
        }

        case 'temperature-sensor': {
            const observation = device.observationStatus.temperature;
            const temperature = device.reportedState.temperature;
            const temperatureUnit = device.reportedState.temperatureUnit;
            const hasTemperatureState = temperature !== undefined || temperatureUnit !== undefined;

            if (
                !observation ||
                (hasTemperatureState &&
                    (typeof temperature !== 'number' ||
                        temperatureUnit !== 'celsius' ||
                        observation.lastObservedAt === undefined))
            ) {
                throw new Error(
                    'Temperature sensor data did not match the expected rendering contract.',
                );
            }

            return {
                ...device,
                role: 'temperature-sensor',
                observationStatus: { ...device.observationStatus, temperature: observation },
            };
        }

        default:
            return undefined;
    }
}

export function useRoom() {
    const [history] = useState(createRoomHistoryBridge);
    const [state, setState] = useState<RoomRealtimeState>({
        status: 'connecting',
        connectionStatus: 'connecting',
    });

    useEffect(() => {
        const bridge = {
            onMessage({
                message,
                snapshot,
                generationChanged,
                lastKnownHistoryGenerationId,
            }: RoomRealtimeUpdate) {
                const baseline = {
                    kind: 'baseline',
                    storage: snapshot.platform.storage,
                    history: snapshot.userHistory,
                    lastKnownHistoryGenerationId,
                } as const;

                if (message.messageType === 'room.snapshot' || generationChanged) {
                    history.publish(baseline, baseline);
                } else {
                    history.publish(
                        {
                            kind: 'addition',
                            storage: snapshot.platform.storage,
                            history:
                                message.messageType === 'device.updated'
                                    ? 'userHistory' in message
                                        ? message.userHistory
                                        : undefined
                                    : message.payload.userHistory,
                            telemetrySample:
                                message.messageType === 'device.updated' &&
                                'telemetrySample' in message
                                    ? message.telemetrySample
                                    : undefined,
                        },
                        baseline,
                    );
                }
            },
            onInterrupted() {
                history.publish({ kind: 'interrupted' });
            },
        };
        const connection = connectRoomRealtime({
            onInterrupted: bridge.onInterrupted,
            onConnectionStatus(connectionStatus) {
                setState((current) => {
                    if (current.status === 'ready') {
                        return {
                            ...current,
                            connectionStatus:
                                connectionStatus === 'connected' ? 'connected' : 'reconnecting',
                        };
                    }

                    return {
                        status: 'connecting',
                        connectionStatus:
                            connectionStatus === 'connecting' || connectionStatus === 'connected'
                                ? 'connecting'
                                : 'reconnecting',
                        contractError: current.contractError,
                    };
                });
            },
            onMessage(update) {
                const snapshot = toRenderableRoomSnapshot(update.snapshot);
                bridge.onMessage(update);
                setState({
                    status: 'ready',
                    snapshot,
                    connectionStatus: 'connected',
                });
            },
            onInvalidMessage() {
                setState((current) => ({
                    ...current,
                    contractError: 'Realtime room stream sent an invalid update.',
                }));
            },
        });

        history.setRequestBaseline(() => connection.requestBaseline());

        return () => {
            history.setRequestBaseline(() => undefined);
            connection.close();
        };
    }, [history]);

    return { room: state, historySource: history.source };
}
