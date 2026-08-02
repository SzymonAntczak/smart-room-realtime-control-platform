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
    recentEvents?: EventFeedItemProjection[];
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
    activeCommands: ActiveCommandProjection[];
    recentCommands?: TerminalCommandProjection[];
    /** @deprecated Dashboard cards use DeviceProjection.recentEvents. */
    recentEvents: EventFeedItemProjection[];
}
