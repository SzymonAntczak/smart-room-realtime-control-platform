export type DeviceHealth = 'online' | 'stale' | 'offline' | 'degraded';

export type DeviceRole =
    | 'temperature-sensor'
    | 'humidity-sensor'
    | 'motion-sensor'
    | 'ambient-light-sensor'
    | 'led-output';

export type PowerState = 'on' | 'off';

export type CommandStatus =
    | 'idle'
    | 'submitting'
    | 'pending'
    | 'confirmed'
    | 'failed'
    | 'timed_out';

export type CommandAvailabilityPolicy = 'allow' | 'allow_with_warning' | 'block';

export type CommandType = 'set.power';

export type PlatformEventType =
    | 'device.state.reported'
    | 'device.health.changed'
    | 'telemetry.reading.recorded'
    | 'command.requested'
    | 'command.dispatched'
    | 'command.confirmed'
    | 'command.failed'
    | 'command.timed_out';

export type PlatformEventSource = 'simulator-adapter' | 'hardware-adapter' | 'backend';

export type DeviceStateValue = string | number | boolean;

export type DeviceState = Record<string, DeviceStateValue>;

export interface CommandAvailability {
    policy: CommandAvailabilityPolicy;
    reason?: string;
}

export interface DeviceProjection {
    deviceId: string;
    name: string;
    role: DeviceRole;
    health: DeviceHealth;
    reportedState: DeviceState;
    requestedState?: DeviceState;
    commandAvailability: CommandAvailability;
    lastSeenAt?: string;
    warning?: string;
    activeCommandId?: string;
}

export interface CommandProjection {
    commandId: string;
    deviceId: string;
    commandType: CommandType;
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

export interface EventFeedItemProjection {
    eventId: string;
    eventType: PlatformEventType;
    occurredAt: string;
    source: PlatformEventSource;
    deviceId?: string;
    commandId?: string;
    summary: string;
}

export interface RoomSnapshotProjection {
    roomName: string;
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: CommandProjection[];
    recentEvents: EventFeedItemProjection[];
}

export interface SetPowerCommandRequest {
    deviceId: string;
    commandType: 'set.power';
    requestedState: {
        power: PowerState;
    };
}
