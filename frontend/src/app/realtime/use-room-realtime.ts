import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { useEffect, useState } from 'react';

import { connectRoomRealtime, type RoomRealtimeConnectionStatus } from './room-realtime-client';

export type RoomRealtimeState =
    | {
          status: 'connecting';
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connecting' | 'reconnecting'>;
          contractError?: string;
      }
    | {
          status: 'ready';
          snapshot: RoomSnapshotProjection;
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connected' | 'reconnecting'>;
          contractError?: string;
      };

export function useRoomRealtime(): RoomRealtimeState {
    const [state, setState] = useState<RoomRealtimeState>({
        status: 'connecting',
        connectionStatus: 'connecting',
    });

    useEffect(() => {
        const connection = connectRoomRealtime({
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

        return () => connection.close();
    }, []);

    return state;
}
