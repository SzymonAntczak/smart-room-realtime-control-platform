import type { RoomSnapshotView, SetPowerCommandRequest } from "../types/viewModels";

export type RoomSnapshotSubscriber = (snapshot: RoomSnapshotView) => void;

export interface RealtimeClient {
  getInitialSnapshot(): RoomSnapshotView;
  subscribe(subscriber: RoomSnapshotSubscriber): () => void;
  sendCommand(command: SetPowerCommandRequest): Promise<void>;
}
