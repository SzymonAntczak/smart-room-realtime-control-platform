import { describe, expect, it } from "vitest";
import { createMockRealtimeClient } from "./mockRealtimeClient";

describe("createMockRealtimeClient", () => {
  it("returns an initial room snapshot without opening a WebSocket", () => {
    const client = createMockRealtimeClient();
    const snapshot = client.getInitialSnapshot();

    expect(snapshot.roomName).toBe("Local Smart Room");
    expect(snapshot.connectionStatus).toBe("mock");
    expect(snapshot.devices.some((device) => device.deviceId === "led-main")).toBe(true);
  });
});
