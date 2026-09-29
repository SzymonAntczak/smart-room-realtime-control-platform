import {
    isRoomBffRealtimeServerMessage,
    isRoomBffSnapshot,
    type RoomBffRealtimeServerMessage,
    type RoomBffSnapshot,
} from '@smart-room/contracts/room-bff';

export type RoomBffSnapshotResult =
    | { kind: 'snapshot'; snapshot: RoomBffSnapshot }
    | { kind: 'invalid_response' };
export type RoomBffRealtimeResult =
    | { kind: 'message'; message: RoomBffRealtimeServerMessage }
    | { kind: 'invalid_response' };

export function validateRoomBffSnapshot(value: unknown): RoomBffSnapshotResult {
    return isRoomBffSnapshot(value)
        ? { kind: 'snapshot', snapshot: value }
        : { kind: 'invalid_response' };
}

/** The existing EventSource remains on its current platform contract until ST-4-06a-02. */
export function validateRoomBffRealtimeMessage(value: unknown): RoomBffRealtimeResult {
    return isRoomBffRealtimeServerMessage(value)
        ? { kind: 'message', message: value }
        : { kind: 'invalid_response' };
}
