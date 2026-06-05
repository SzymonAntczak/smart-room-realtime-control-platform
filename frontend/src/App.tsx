import { useEffect, useState } from "react";
import { RoomDashboard } from "./components/RoomDashboard";
import { createMockRealtimeClient } from "./realtime/mockRealtimeClient";
import type { RoomSnapshotView } from "./types/viewModels";

const realtimeClient = createMockRealtimeClient();

export function App() {
  const [snapshot, setSnapshot] = useState<RoomSnapshotView>(() =>
    realtimeClient.getInitialSnapshot(),
  );

  useEffect(() => {
    return realtimeClient.subscribe(setSnapshot);
  }, []);

  return (
    <RoomDashboard
      snapshot={snapshot}
      onLedPowerRequest={(power) =>
        realtimeClient.sendCommand({
          deviceId: "led-main",
          commandType: "set.power",
          requestedState: { power },
        })
      }
    />
  );
}
