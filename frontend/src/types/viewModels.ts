export type DeviceHealth = "online" | "stale" | "offline" | "degraded";

export type DeviceRole =
  | "temperature-sensor"
  | "humidity-sensor"
  | "motion-sensor"
  | "ambient-light-sensor"
  | "led-output";

export type PowerState = "on" | "off";

export type CommandStatus =
  | "idle"
  | "submitting"
  | "pending"
  | "confirmed"
  | "failed"
  | "timed_out";

export type ConnectionStatus = "mock" | "connecting" | "connected" | "disconnected";

export type DeviceStateValue = string | number | boolean;

export type DeviceState = Record<string, DeviceStateValue>;

export interface DeviceView {
  deviceId: string;
  name: string;
  role: DeviceRole;
  health: DeviceHealth;
  reportedState: DeviceState;
  requestedState?: DeviceState;
  lastSeenAt?: string;
  warning?: string;
  activeCommandId?: string;
}

export interface CommandView {
  commandId: string;
  deviceId: string;
  commandType: "set.power";
  status: CommandStatus;
  requestedState: DeviceState;
  requestedAt: string;
  dispatchedAt?: string;
  confirmedAt?: string;
  failedAt?: string;
  timedOutAt?: string;
  reason?: string;
  message?: string;
}

export interface EventFeedItemView {
  eventId: string;
  eventType:
    | "device.state.reported"
    | "device.health.changed"
    | "telemetry.reading.recorded"
    | "command.requested"
    | "command.dispatched"
    | "command.confirmed"
    | "command.failed"
    | "command.timed_out";
  occurredAt: string;
  source: "simulator-adapter" | "hardware-adapter" | "backend";
  deviceId?: string;
  commandId?: string;
  summary: string;
}

export interface RoomSnapshotView {
  roomName: string;
  connectionStatus: ConnectionStatus;
  updatedAt: string;
  devices: DeviceView[];
  activeCommands: CommandView[];
  recentEvents: EventFeedItemView[];
}

export interface SetPowerCommandRequest {
  deviceId: string;
  commandType: "set.power";
  requestedState: {
    power: PowerState;
  };
}
