import type { ActiveCommandProjection, TerminalCommandProjection } from './commands';
import type { CommandAvailability, DeviceHealth, DeviceRole, DeviceState } from './devices';
import type { PlatformEventSource, PlatformEventType } from './events';

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

export interface RoomSnapshotProjection {
    roomName: string;
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: ActiveCommandProjection[];
    recentCommands?: TerminalCommandProjection[];
}

/**
 * Frozen v1 transport shape retained only so existing clients can reconnect.
 * New projections and all v2 transport intentionally omit event history.
 */
export interface LegacyEventFeedItemProjection {
    eventId: string;
    eventType: PlatformEventType;
    occurredAt: string;
    source: PlatformEventSource;
    deviceId?: string;
    commandId?: string;
    summary: string;
}

export interface LegacyDeviceProjection extends DeviceProjection {
    recentEvents?: LegacyEventFeedItemProjection[];
}

export interface LegacyRoomSnapshotProjection {
    roomName: string;
    updatedAt: string;
    devices: LegacyDeviceProjection[];
    activeCommands: ActiveCommandProjection[];
    recentCommands?: TerminalCommandProjection[];
    recentEvents: LegacyEventFeedItemProjection[];
}
