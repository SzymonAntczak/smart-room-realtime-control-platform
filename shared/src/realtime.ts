import type { RoomSnapshotProjection } from './projections';

export type RoomRealtimeServerMessage = RoomSnapshotMessage;

export interface RoomSnapshotMessage {
    messageType: 'room.snapshot';
    version: 1;
    sentAt: string;
    payload: RoomSnapshotProjection;
}
