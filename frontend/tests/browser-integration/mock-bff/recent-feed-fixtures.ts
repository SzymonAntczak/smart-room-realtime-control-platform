import type { ActiveCommandProjection } from '@smart-room/contracts/commands';
import type { RecentEventProjection } from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';

import {
    createOfflineTemperatureDeviceProjection,
    createOnlineLedDeviceProjection,
    createOnlineLedRoomSnapshot,
    createOnlineTemperatureDeviceProjection,
    createOnlineTemperatureRoomSnapshot,
    createTimedOutLedCommand,
} from './mock-bff-fixtures';

const time = {
    offline: '2026-09-10T10:00:00.000Z',
    online: '2026-09-10T10:02:00.000Z',
    degraded: '2026-09-10T10:03:00.000Z',
    requested: '2026-09-10T10:01:00.000Z',
    dispatched: '2026-09-10T10:01:01.000Z',
    reported: '2026-09-10T10:01:03.000Z',
    confirmed: '2026-09-10T10:01:03.000Z',
    noFeedStart: '2026-09-10T09:59:00.000Z',
    timedOut: '2026-09-10T10:00:00.000Z',
    telemetry: '2026-09-10T10:01:00.000Z',
    noChange: '2026-09-10T10:02:00.000Z',
    watermark: '2026-09-10T10:03:00.000Z',
    recovered: '2026-09-10T10:04:00.000Z',
};
const storageStatusChangedAt = '2026-06-08T09:30:00Z';

export function createAvailabilityFact(
    id: number,
    previousAvailability: 'online' | 'offline',
    availability: 'online' | 'offline',
    occurredAt: string,
    storageSequence: number,
): RecentEventProjection {
    return {
        ...durableFact(id, occurredAt, storageSequence),
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        eventType: 'device.availability.changed',
        payload: {
            previousAvailability,
            availability,
            reason: availability === 'online' ? 'reconnected' : 'disconnected',
        },
    };
}

export function createHealthFact(
    id: number,
    previousHealth: 'healthy' | 'degraded',
    health: 'healthy' | 'degraded',
    occurredAt: string,
    storageSequence: number,
): RecentEventProjection {
    return {
        ...durableFact(id, occurredAt, storageSequence),
        source: 'simulator-adapter',
        deviceId: 'temp-desk',
        eventType: 'device.health.changed',
        payload: {
            previousHealth,
            health,
            reason: health === 'degraded' ? 'partial_data' : 'recovered',
        },
    };
}

export function createRequestedFact(id: number, occurredAt: string): RecentEventProjection {
    return {
        ...durableFact(id, occurredAt, 1),
        source: 'backend',
        deviceId: 'led-main',
        commandId: 'mock-command-1',
        eventType: 'command.requested',
        payload: {
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedBy: 'user',
        },
    };
}

export function createDispatchedFact(id: number, occurredAt: string): RecentEventProjection {
    return {
        ...durableFact(id, occurredAt, 2),
        source: 'backend',
        deviceId: 'led-main',
        commandId: 'mock-command-1',
        eventType: 'command.dispatched',
        payload: { commandType: 'set.power', target: 'simulator-adapter' },
    };
}

export function createReportedFact(id: number, occurredAt: string): RecentEventProjection {
    return createLedStateFact(id, occurredAt, 3, 'on');
}

export function createLedStateFact(
    id: number,
    occurredAt: string,
    storageSequence: number,
    power: 'on' | 'off',
): RecentEventProjection {
    return {
        ...durableFact(id, occurredAt, storageSequence),
        source: 'simulator-adapter',
        deviceId: 'led-main',
        eventType: 'device.state.reported',
        payload: { reportedState: { power } },
    };
}

export function createConfirmedFact(id: number, occurredAt: string): RecentEventProjection {
    return {
        ...durableFact(id, occurredAt, 4),
        source: 'backend',
        deviceId: 'led-main',
        commandId: 'mock-command-1',
        eventType: 'command.confirmed',
        payload: { sourceEventId: 'report-led-on', confirmedAt: occurredAt },
    };
}

export function createTimedOutFact(id: number, occurredAt: string): RecentEventProjection {
    return {
        ...durableFact(id, occurredAt, 2),
        source: 'backend',
        deviceId: 'led-main',
        commandId: 'mock-command-1',
        eventType: 'command.timed_out',
        payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
    };
}

export function createAvailabilityHealthSnapshot(): RoomSnapshotProjection {
    const snapshot = createOnlineTemperatureRoomSnapshot();
    const offlineDevice = {
        ...createOfflineTemperatureDeviceProjection(),
        availabilityChangedAt: time.offline,
        availabilityReason: 'disconnected',
    };
    const offlineFact = createAvailabilityFact(1, 'online', 'offline', time.offline, 1);

    return {
        ...snapshot,
        updatedAt: time.offline,
        devices: snapshot.devices.map((device) =>
            device.deviceId === 'temp-desk' ? offlineDevice : device,
        ),
        recentEvents: [offlineFact],
        platform: {
            storage: {
                status: 'available',
                changedAt: storageStatusChangedAt,
                historyGenerationId: 'mock-history-generation',
                storedThroughSequence: 1,
            },
        },
    };
}

export function createCommandFeedSnapshot(): RoomSnapshotProjection {
    return createOnlineLedRoomSnapshot();
}

export function createNoFeedSnapshot(): RoomSnapshotProjection {
    const snapshot = createOnlineTemperatureRoomSnapshot();
    const led = createOnlineLedDeviceProjection();
    const timeout = createTimedOutFact(2, time.timedOut);
    const degraded = createHealthFact(1, 'healthy', 'degraded', time.noFeedStart, 1);
    const devices = snapshot.devices.map((device) =>
        device.deviceId === 'temp-desk'
            ? {
                  ...device,
                  health: 'degraded' as const,
                  healthChangedAt: time.noFeedStart,
                  healthReason: 'partial_data',
              }
            : device,
    );

    return {
        ...snapshot,
        updatedAt: time.timedOut,
        devices: [...devices, led],
        recentEvents: [timeout, degraded],
        recentCommands: [
            {
                ...createTimedOutLedCommand(),
                requestedAt: '2026-09-10T09:59:50.000Z',
                delivery: {
                    status: 'handed_off',
                    dispatchedAt: '2026-09-10T09:59:55.000Z',
                    deadlineAt: '2026-09-10T10:00:00.000Z',
                },
                timedOutAt: time.timedOut,
            },
        ],
        platform: {
            storage: {
                status: 'available',
                changedAt: storageStatusChangedAt,
                historyGenerationId: 'mock-history-generation',
                storedThroughSequence: 2,
            },
        },
    };
}

export function createTemperatureHealthRecovery(): {
    device: ReturnType<typeof createOnlineTemperatureDeviceProjection>;
    event: RecentEventProjection;
    sentAt: string;
} {
    return {
        device: {
            ...createOnlineTemperatureDeviceProjection(),
            health: 'healthy',
            healthChangedAt: time.recovered,
        },
        event: createHealthFact(7, 'degraded', 'healthy', time.recovered, 7),
        sentAt: time.recovered,
    };
}

export const recentFeedFixtureTimes = time;

export function createAcceptedLedCommandProjection(): ActiveCommandProjection {
    return {
        commandId: 'mock-command-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'accepted',
        requestedState: { power: 'on' },
        requestedAt: time.requested,
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}

function durableFact(id: number, occurredAt: string, storageSequence: number) {
    return {
        recordId: `rec:v1:sha256:${id.toString(16).padStart(64, '0')}`,
        occurredAt,
        durability: 'durable' as const,
        storageSequence,
    };
}
