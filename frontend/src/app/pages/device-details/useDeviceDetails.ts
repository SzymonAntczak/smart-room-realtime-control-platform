import type { DeviceProjection } from '@smart-room/contracts/projections';
import { useEffect, useState } from 'react';

import { connectRoomRealtime, type RoomRealtimeConnectionStatus } from '../../api/room';

export type DeviceDetailsState =
    | {
          status: 'connecting';
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connecting' | 'reconnecting'>;
      }
    | {
          status: 'ready';
          deviceId: string | undefined;
          device?: DeviceProjection;
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connected' | 'reconnecting'>;
          contractError?: boolean;
      };

export function useDeviceDetails(deviceId: string | undefined): DeviceDetailsState {
    const [state, setState] = useState<DeviceDetailsState>({
        status: 'connecting',
        connectionStatus: 'connecting',
    });

    useEffect(() => {
        const connection = connectRoomRealtime({
            onConnectionStatus(connectionStatus) {
                setState((current) =>
                    current.status === 'ready'
                        ? {
                              ...current,
                              connectionStatus:
                                  connectionStatus === 'connected' ? 'connected' : 'reconnecting',
                          }
                        : {
                              status: 'connecting',
                              connectionStatus:
                                  connectionStatus === 'connecting' ||
                                  connectionStatus === 'connected'
                                      ? 'connecting'
                                      : 'reconnecting',
                          },
                );
            },
            onMessage({ snapshot }) {
                setState({
                    status: 'ready',
                    deviceId,
                    device: snapshot.devices.find((device) => device.deviceId === deviceId),
                    connectionStatus: 'connected',
                });
            },
            onInterrupted() {
                setState((current) => ({ ...current, connectionStatus: 'reconnecting' }));
            },
            onInvalidMessage() {
                setState((current) =>
                    current.status === 'ready' ? { ...current, contractError: true } : current,
                );
            },
        });

        return () => connection.close();
    }, [deviceId]);

    if (state.status === 'ready' && state.deviceId !== deviceId) {
        return { status: 'connecting', connectionStatus: 'connecting' };
    }

    return state;
}
