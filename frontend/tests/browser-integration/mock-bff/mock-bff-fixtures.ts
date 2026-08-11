import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceProjection, RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { CommandsUpdatedMessage, DeviceUpdatedMessage } from '@smart-room/contracts/realtime';

const fixtureTimestamp = '2026-06-08T09:30:00Z';

export function createOnlineLedDeviceProjection(): DeviceProjection {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: fixtureTimestamp,
        health: 'healthy',
        healthChangedAt: fixtureTimestamp,
        reportedState: { power: 'off' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: fixtureTimestamp,
            },
        },
        commandAvailability: { policy: 'allow' },
    };
}

export function createOnlineLedRoomSnapshot(): RoomSnapshotProjection {
    return {
        roomName: 'Smart Room',
        updatedAt: fixtureTimestamp,
        devices: [createOnlineLedDeviceProjection()],
        activeCommands: [],
        recentCommands: [],
    };
}

export function createDeviceUpdatedMessage(
    previousRevision: number,
    device: DeviceProjection = createOnlineLedDeviceProjection(),
): DeviceUpdatedMessage {
    return {
        messageType: 'device.updated',
        previousRevision,
        revision: previousRevision + 1,
        sentAt: fixtureTimestamp,
        payload: device,
    };
}

export function createCommandsUpdatedMessage(
    previousRevision: number,
    {
        device = createOnlineLedDeviceProjection(),
        activeCommands = [],
        recentCommands = [],
    }: {
        device?: DeviceProjection;
        activeCommands?: ActiveCommandProjection[];
        recentCommands?: TerminalCommandProjection[];
    } = {},
): CommandsUpdatedMessage {
    return {
        messageType: 'commands.updated',
        previousRevision,
        revision: previousRevision + 1,
        sentAt: fixtureTimestamp,
        payload: { device, activeCommands, recentCommands },
    };
}
