import type { ActiveCommandProjection, TerminalCommandProjection } from './commands';
import type { DeviceProjection, RoomSnapshotProjection } from './projections';

export type RoomRealtimeServerMessage =
    | RoomSnapshotMessage
    | DeviceUpdatedMessage
    | CommandsUpdatedMessage;

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

export interface CommandsUpdatedMessage {
    messageType: 'commands.updated';
    previousRevision: number;
    revision: number;
    sentAt: string;
    payload: {
        device: DeviceProjection;
        activeCommands: ActiveCommandProjection[];
        recentCommands: TerminalCommandProjection[];
    };
}
