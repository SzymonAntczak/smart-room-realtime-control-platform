import type {
    ActiveCommandProjection,
    ConfirmedCommandProjection,
    FailedCommandProjection,
    TerminalCommandProjection,
    TimedOutCommandProjection,
} from '@smart-room/contracts/commands';
import type {
    DeviceProjection,
    PlatformStorageProjection,
} from '@smart-room/contracts/projections';
import type { RoomBffRealtimeServerMessage, RoomBffSnapshot } from '@smart-room/contracts/room-bff';
import type { UserHistoryItem } from '@smart-room/contracts/user-history';

type CommandsUpdatedMessage = Extract<
    RoomBffRealtimeServerMessage,
    { messageType: 'commands.updated' }
>;
type DeviceUpdatedMessage = Extract<
    RoomBffRealtimeServerMessage,
    { messageType: 'device.updated' }
>;
type PlatformUpdatedMessage = Extract<
    RoomBffRealtimeServerMessage,
    { messageType: 'platform.updated' }
>;

const fixtureTimestamp = '2026-06-08T09:30:00Z';
const commandRequestedAt = '2026-06-08T09:30:01Z';
const commandDispatchedAt = '2026-06-08T09:30:02Z';
const commandConfirmedAt = '2026-06-08T09:30:03Z';
const commandFailedAt = '2026-06-08T09:30:03Z';
const commandTimedOutAt = '2026-06-08T09:30:07Z';
const lateReportAt = '2026-06-08T09:30:08Z';
const temperatureUpdatedAt = '2026-06-08T09:31:00Z';
const temperatureOfflineAt = '2026-06-08T09:33:00Z';
const temperatureRecoveredAt = '2026-06-08T09:34:00Z';
const temperatureFreshAfterRecoveryAt = '2026-06-08T09:35:00Z';
const ledCommandId = 'mock-command-1';

function storagePlatform(): { storage: PlatformStorageProjection } {
    return {
        storage: {
            status: 'available',
            changedAt: fixtureTimestamp,
            historyGenerationId: 'mock-history-generation',
            storedThroughSequence: 0,
        },
    };
}

export function createOnlineLedDeviceProjection(): DeviceProjection {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: fixtureTimestamp,
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: fixtureTimestamp,
        healthDurability: 'durable',
        reportedState: { power: 'off' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: fixtureTimestamp,
                durability: 'durable',
            },
        },
        commandAvailability: { policy: 'allow' },
    };
}

export function createOnlineLedRoomSnapshot(): RoomBffSnapshot {
    return {
        roomName: 'Smart Room',
        updatedAt: fixtureTimestamp,
        devices: [createOnlineLedDeviceProjection()],
        activeCommands: [],
        recentCommands: [],
        userHistory: [],
        platform: storagePlatform(),
    };
}

export function createOnlineTemperatureDeviceProjection(): DeviceProjection {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: fixtureTimestamp,
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: fixtureTimestamp,
        healthDurability: 'durable',
        reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: fixtureTimestamp,
                durability: 'durable',
            },
        },
        commandAvailability: { policy: 'block', reason: 'read_only_device' },
    };
}

function createOnlineWindowTemperatureDeviceProjection(): DeviceProjection {
    return {
        ...createOnlineTemperatureDeviceProjection(),
        deviceId: 'temp-window',
        name: 'Window Temperature',
        reportedState: { temperature: 20.1, temperatureUnit: 'celsius' },
    };
}

export function createOnlineTemperatureRoomSnapshot(): RoomBffSnapshot {
    return {
        roomName: 'Smart Room',
        updatedAt: fixtureTimestamp,
        devices: [
            createOnlineTemperatureDeviceProjection(),
            createOnlineWindowTemperatureDeviceProjection(),
        ],
        activeCommands: [],
        recentCommands: [],
        userHistory: [],
        platform: storagePlatform(),
    };
}

export function createFreshTemperatureDeviceProjection(): DeviceProjection {
    return {
        ...createOnlineTemperatureDeviceProjection(),
        reportedState: { temperature: 22.8, temperatureUnit: 'celsius' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: temperatureUpdatedAt,
                durability: 'durable',
            },
        },
    };
}

export function createStaleTemperatureDeviceProjection(): DeviceProjection {
    return {
        ...createFreshTemperatureDeviceProjection(),
        observationStatus: {
            temperature: {
                freshness: 'stale',
                lastObservedAt: temperatureUpdatedAt,
                durability: 'durable',
            },
        },
    };
}

export function createOfflineTemperatureDeviceProjection(): DeviceProjection {
    return {
        ...createStaleTemperatureDeviceProjection(),
        availability: 'offline',
        availabilityChangedAt: temperatureOfflineAt,
        availabilityReason: 'transport_disconnected',
    };
}

export function createRecoveredTemperatureDeviceProjection(): DeviceProjection {
    return {
        ...createStaleTemperatureDeviceProjection(),
        availabilityChangedAt: temperatureRecoveredAt,
    };
}

export function createFreshTemperatureAfterRecoveryDeviceProjection(): DeviceProjection {
    return {
        ...createRecoveredTemperatureDeviceProjection(),
        reportedState: { temperature: 23.1, temperatureUnit: 'celsius' },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: temperatureFreshAfterRecoveryAt,
                durability: 'durable',
            },
        },
    };
}

export function createPendingLedCommand(): ActiveCommandProjection {
    return {
        commandId: ledCommandId,
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: commandRequestedAt,
        durability: 'durable',
        lifecycleDurability: 'durable',
        delivery: {
            status: 'handed_off',
            dispatchedAt: commandDispatchedAt,
            deadlineAt: commandTimedOutAt,
        },
    };
}

export function createPendingLedDeviceProjection(): DeviceProjection {
    return {
        ...createOnlineLedDeviceProjection(),
        activeCommandId: ledCommandId,
    };
}

export function createConfirmedLedCommand(): ConfirmedCommandProjection {
    return {
        commandId: ledCommandId,
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'confirmed',
        requestedState: { power: 'on' },
        requestedAt: commandRequestedAt,
        durability: 'durable',
        lifecycleDurability: 'durable',
        delivery: {
            status: 'handed_off',
            dispatchedAt: commandDispatchedAt,
            deadlineAt: commandTimedOutAt,
        },
        confirmedAt: commandConfirmedAt,
    };
}

export function createConfirmedLedDeviceProjection(): DeviceProjection {
    return {
        ...createOnlineLedDeviceProjection(),
        reportedState: { power: 'on' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: commandConfirmedAt,
                durability: 'durable',
            },
        },
    };
}

export function createFailedLedCommand(commandId: string): FailedCommandProjection {
    return {
        commandId,
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'failed',
        requestedState: { power: 'on' },
        requestedAt: commandRequestedAt,
        durability: 'durable',
        lifecycleDurability: 'durable',
        failedAt: commandFailedAt,
        reason: 'command_already_active',
        message: 'Device already has an active command.',
    };
}

export function createTimedOutLedCommand(): TimedOutCommandProjection {
    return {
        commandId: ledCommandId,
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'timed_out',
        requestedState: { power: 'on' },
        requestedAt: commandRequestedAt,
        durability: 'durable',
        lifecycleDurability: 'durable',
        delivery: {
            status: 'handed_off',
            dispatchedAt: commandDispatchedAt,
            deadlineAt: commandTimedOutAt,
        },
        timedOutAt: commandTimedOutAt,
        reason: 'confirmation_not_received',
    };
}

export function createLateReportedLedDeviceProjection(): DeviceProjection {
    return {
        ...createOnlineLedDeviceProjection(),
        reportedState: { power: 'on' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: lateReportAt,
                durability: 'durable',
            },
        },
    };
}

export function createDeviceUpdatedMessage(
    previousRevision: number,
    device: DeviceProjection = createOnlineLedDeviceProjection(),
    userHistory?: UserHistoryItem[],
    sentAt = fixtureTimestamp,
): DeviceUpdatedMessage {
    return {
        messageType: 'device.updated',
        previousRevision,
        revision: previousRevision + 1,
        sentAt,
        payload: device,
        ...(userHistory === undefined ? {} : { userHistory }),
    };
}

export function createTemperatureDeviceUpdatedMessage(
    previousRevision: number,
    device: DeviceProjection = createOnlineTemperatureDeviceProjection(),
    userHistory?: UserHistoryItem[],
    sentAt = fixtureTimestamp,
): DeviceUpdatedMessage {
    return createDeviceUpdatedMessage(previousRevision, device, userHistory, sentAt);
}

export function createCommandsUpdatedMessage(
    previousRevision: number,
    {
        devices = [createOnlineLedDeviceProjection()],
        activeCommands = [],
        recentCommands = [],
        userHistory,
        sentAt = fixtureTimestamp,
    }: {
        devices?: DeviceProjection[];
        activeCommands?: ActiveCommandProjection[];
        recentCommands?: TerminalCommandProjection[];
        userHistory?: UserHistoryItem[];
        sentAt?: string;
    } = {},
): CommandsUpdatedMessage {
    return {
        messageType: 'commands.updated',
        previousRevision,
        revision: previousRevision + 1,
        sentAt,
        payload: {
            devices,
            activeCommands,
            recentCommands,
            ...(userHistory === undefined ? {} : { userHistory }),
        },
    };
}

export function createPlatformUpdatedMessage(
    previousRevision: number,
    storedThroughSequence: number,
    sentAt: string,
): PlatformUpdatedMessage {
    return {
        messageType: 'platform.updated' as const,
        previousRevision,
        revision: previousRevision + 1,
        sentAt,
        payload: {
            storage: {
                status: 'available',
                historyGenerationId: 'mock-history-generation',
                storedThroughSequence,
                changedAt: fixtureTimestamp,
            },
        },
    };
}
