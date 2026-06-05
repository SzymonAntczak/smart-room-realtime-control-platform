import type { RealtimeClient, RoomSnapshotSubscriber } from "./RealtimeClient";
import { mockRoomSnapshot } from "./mockData";
import type { RoomSnapshotView, SetPowerCommandRequest } from "../types/viewModels";

function cloneSnapshot(): RoomSnapshotView {
  return structuredClone(mockRoomSnapshot);
}

export function createMockRealtimeClient(): RealtimeClient {
  const subscribers = new Set<RoomSnapshotSubscriber>();

  return {
    getInitialSnapshot() {
      return cloneSnapshot();
    },

    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },

    async sendCommand(_command: SetPowerCommandRequest) {
      await Promise.resolve();
    },
  };
}
