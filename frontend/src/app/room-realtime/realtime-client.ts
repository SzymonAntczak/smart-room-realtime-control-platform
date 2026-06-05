import type { RoomSnapshotView, SetPowerCommandRequest } from '../room-control/room-view-model';

export type RoomSnapshotSubscriber = (snapshot: RoomSnapshotView) => void;

export interface RealtimeClient {
    getInitialSnapshot(): RoomSnapshotView;
    subscribe(subscriber: RoomSnapshotSubscriber): () => void;
    sendCommand(command: SetPowerCommandRequest): Promise<void>;
}
