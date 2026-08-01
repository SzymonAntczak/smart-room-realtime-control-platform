import { useEffect, useState } from 'react';
import {
    connectTemperatureRealtime,
    type TemperatureRealtimeConnectionStatus,
    type TemperatureSensorReading,
    type TemperatureSnapshotResult,
} from './room-realtime-client';

export type TemperatureControlState =
    | {
          status: 'connecting';
          connectionStatus: Extract<
              TemperatureRealtimeConnectionStatus,
              'connecting' | 'reconnecting'
          >;
      }
    | {
          status: 'ready';
          reading: TemperatureSensorReading;
          connectionStatus: Extract<
              TemperatureRealtimeConnectionStatus,
              'connected' | 'reconnecting'
          >;
      }
    | {
          status: 'empty';
          connectionStatus: Extract<
              TemperatureRealtimeConnectionStatus,
              'connected' | 'reconnecting'
          >;
      }
    | { status: 'error'; message: string };

export function useTemperatureRealtime(): TemperatureControlState {
    const [controlState, setControlState] = useState<TemperatureControlState>({
        status: 'connecting',
        connectionStatus: 'connecting',
    });

    useEffect(() => {
        const connection = connectTemperatureRealtime({
            onConnectionStatus(connectionStatus) {
                setControlState((currentState) => {
                    if (currentState.status === 'ready' || currentState.status === 'empty') {
                        return {
                            ...currentState,
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
                    };
                });
            },
            onSnapshot(snapshot) {
                setControlState(toControlState(snapshot));
            },
            onInvalidMessage() {
                setControlState({
                    status: 'error',
                    message: 'Realtime room stream sent an invalid snapshot.',
                });
            },
        });
        return () => connection.close();
    }, []);

    return controlState;
}

function toControlState(snapshot: TemperatureSnapshotResult): TemperatureControlState {
    return snapshot.status === 'empty'
        ? { status: 'empty', connectionStatus: 'connected' }
        : { status: 'ready', reading: snapshot.reading, connectionStatus: 'connected' };
}
