import { useEffect, useState } from 'react';

import type { RenderableRoomSnapshot } from '../shared/room-rendering';

import { createRoomHistorySource, type RoomHistorySource } from './room-history-source';
import { connectRoomRealtime, type RoomRealtimeConnectionStatus } from './room-realtime-client';

type RoomRealtimeView =
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

export type RoomRealtimeState = RoomRealtimeView & { historySource: RoomHistorySource };

export function useRoomRealtime(): RoomRealtimeState {
    const [history] = useState(createRoomHistorySource);
    const [state, setState] = useState<RoomRealtimeView>({
        status: 'connecting',
        connectionStatus: 'connecting',
    });

    useEffect(() => {
        const connection = connectRoomRealtime({
            onHistoryUpdate: (update, baseline) => history.publish(update, baseline),
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
            onSnapshot(snapshot) {
                setState({ status: 'ready', snapshot, connectionStatus: 'connected' });
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

    return { ...state, historySource: history.source };
}
