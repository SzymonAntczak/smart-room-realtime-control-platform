import { type ReactNode, useEffect, useState } from 'react';

import { connectRoomRealtime, type RoomRealtimeUpdate } from '../../api/room';
import type { HistoryLiveSource, HistoryLiveUpdate } from '../history';

import { RoomContext, type RoomRealtimeState } from './useRoomConnection';

type HistoryBaseline = Extract<HistoryLiveUpdate, { kind: 'baseline' }>;

interface RoomHistoryBridge {
    readonly source: HistoryLiveSource;
    setRequestBaseline(action: () => void): void;
    publish(update: HistoryLiveUpdate, currentBaseline?: HistoryBaseline): void;
}

/** Keeps the current room baseline and synchronously forwards realtime history updates. */
function createRoomHistoryBridge(): RoomHistoryBridge {
    let baseline: HistoryBaseline | undefined;
    let requestBaseline = () => undefined as void;
    const listeners = new Set<(update: HistoryLiveUpdate) => void>();
    const source: HistoryLiveSource = {
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

export function RoomProvider({ children }: { children: ReactNode }) {
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
                const snapshot = update.snapshot;

                for (const device of snapshot.devices) {
                    if (
                        device.role === 'led-output' &&
                        device.reportedState.power !== undefined &&
                        device.reportedState.power !== 'on' &&
                        device.reportedState.power !== 'off'
                    ) {
                        throw new Error('Invalid LED rendering contract');
                    }

                    if (device.role === 'temperature-sensor') {
                        const observation = device.observationStatus.temperature;
                        const { temperature, temperatureUnit } = device.reportedState;

                        if (
                            !observation ||
                            ((temperature !== undefined || temperatureUnit !== undefined) &&
                                (typeof temperature !== 'number' ||
                                    temperatureUnit !== 'celsius' ||
                                    observation.lastObservedAt === undefined))
                        ) {
                            throw new Error('Invalid temperature rendering contract');
                        }
                    }
                }

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

    return (
        <RoomContext value={{ room: state, historySource: history.source }}>{children}</RoomContext>
    );
}
