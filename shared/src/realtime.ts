import type {
    DeviceProjection,
    LegacyRoomSnapshotProjection,
    RoomSnapshotProjection,
} from './projections';

export type RoomRealtimeServerMessage = RoomSnapshotMessage | DeviceUpdatedMessage;

export interface RoomSnapshotV1Message {
    messageType: 'room.snapshot';
    version: 1;
    sentAt: string;
    payload: LegacyRoomSnapshotProjection;
}

export interface RoomSnapshotV2Message {
    messageType: 'room.snapshot';
    version: 2;
    revision: 0;
    sentAt: string;
    payload: RoomSnapshotProjection;
}

export type RoomSnapshotMessage = RoomSnapshotV1Message | RoomSnapshotV2Message;

export interface DeviceUpdatedMessage {
    messageType: 'device.updated';
    version: 2;
    previousRevision: number;
    revision: number;
    sentAt: string;
    payload: DeviceProjection;
}
