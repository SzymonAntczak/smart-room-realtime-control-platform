import type { DeviceProjection, RoomSnapshotProjection } from './projections';

export type RoomRealtimeServerMessage = RoomSnapshotMessage | DeviceUpdatedMessage;

export interface RoomSnapshotMessage {
    messageType: 'room.snapshot';
    revision: 0;
    sentAt: string;
    payload: RoomSnapshotProjection;
}

export interface DeviceUpdatedMessage {
    messageType: 'device.updated';
    previousRevision: number;
    revision: number;
    sentAt: string;
    payload: DeviceProjection;
}
