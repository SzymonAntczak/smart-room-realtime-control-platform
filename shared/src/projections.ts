import type { ActiveCommandProjection, TerminalCommandProjection } from './commands';
import type { CommandAvailability, DeviceHealth, DeviceRole, DeviceState } from './devices';

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
    recentCommands: TerminalCommandProjection[];
}
