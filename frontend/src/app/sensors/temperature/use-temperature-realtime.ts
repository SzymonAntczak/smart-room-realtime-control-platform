import type { DeviceProjection, RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { useEffect, useState } from 'react';

import {
    connectRoomRealtime as connectTemperatureRealtime,
    type RoomRealtimeConnectionStatus as TemperatureRealtimeConnectionStatus,
} from '../../room/realtime/room-realtime-client';

import { toTemperatureSensorReading } from './temperature-reading';

export type TemperatureControlState =
    | {
          status: 'connecting';
          connectionStatus: Extract<
              TemperatureRealtimeConnectionStatus,
              'connecting' | 'reconnecting'
          >;
          contractError?: string;
      }
    | {
          status: 'ready';
          devices: readonly DeviceProjection[];
          connectionStatus: Extract<
              TemperatureRealtimeConnectionStatus,
              'connected' | 'reconnecting'
          >;
          contractError?: string;
      }
    | {
          status: 'empty';
          connectionStatus: Extract<
              TemperatureRealtimeConnectionStatus,
              'connected' | 'reconnecting'
          >;
          contractError?: string;
      };

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
                        contractError: currentState.contractError,
                    };
                });
            },
            onSnapshot(snapshot) {
                for (const device of snapshot.devices) {
                    if (device.role === 'temperature-sensor') toTemperatureSensorReading(device);
                }
                setControlState(toControlState(snapshot));
            },
            onInvalidMessage() {
                setControlState((currentState) => ({
                    ...currentState,
                    contractError: 'Realtime room stream sent an invalid update.',
                }));
            },
        });
        return () => connection.close();
    }, []);

    return controlState;
}

function toControlState(snapshot: RoomSnapshotProjection): TemperatureControlState {
    const devices = snapshot.devices.filter((device) => device.role === 'temperature-sensor');

    return devices.length === 0
        ? { status: 'empty', connectionStatus: 'connected' }
        : { status: 'ready', devices, connectionStatus: 'connected' };
}
