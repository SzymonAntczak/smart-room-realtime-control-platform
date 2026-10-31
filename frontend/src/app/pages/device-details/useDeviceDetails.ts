import type { DeviceProjection } from '@smart-room/contracts/projections';

import type { RoomRealtimeConnectionStatus } from '../../api/room';
import { useRoomConnection } from '../../shared/room-realtime';

type DeviceDetailsState =
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
    const { room } = useRoomConnection();

    if (room.status !== 'ready') {
        return { status: 'connecting', connectionStatus: room.connectionStatus };
    }

    return {
        status: 'ready',
        deviceId,
        device: room.snapshot.devices.find((device) => device.deviceId === deviceId),
        connectionStatus: room.connectionStatus,
        ...(room.contractError ? { contractError: true } : {}),
    };
}
