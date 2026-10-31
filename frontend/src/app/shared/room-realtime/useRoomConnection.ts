import type { RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import { createContext, useContext } from 'react';

import type { RoomRealtimeConnectionStatus } from '../../api/room';
import type { HistoryLiveSource } from '../history';

export type RoomRealtimeState =
    | {
          status: 'connecting';
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connecting' | 'reconnecting'>;
          contractError?: string;
      }
    | {
          status: 'ready';
          snapshot: RoomBffSnapshot;
          connectionStatus: Extract<RoomRealtimeConnectionStatus, 'connected' | 'reconnecting'>;
          contractError?: string;
      };

export const RoomContext = createContext<{
    room: RoomRealtimeState;
    historySource: HistoryLiveSource;
} | null>(null);

export function useRoomConnection() {
    const value = useContext(RoomContext);

    if (!value) {
        throw new Error('Room connection requires RoomProvider');
    }

    return value;
}
