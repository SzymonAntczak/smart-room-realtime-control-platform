import type { RoomBffRealtimeServerMessage, RoomBffSnapshot } from '@smart-room/contracts/room-bff';

export function createInvalidRenderableDevices(): readonly {
    label: string;
    device: RoomBffSnapshot['devices'][number];
}[] {
    return [
        {
            label: 'a temperature device without an observation status',
            device: { ...createTemperatureDevice(), observationStatus: {} },
        },
        {
            label: 'a temperature reading without a timestamp',
            device: {
                ...createTemperatureDevice(),
                observationStatus: { temperature: { freshness: 'unknown', durability: 'durable' } },
            },
        },
        {
            label: 'an LED with an unsupported reported power state',
            device: { ...createLedDevice(), reportedState: { power: 'standby' } },
        },
    ];
}

export function createRoomSnapshotMessage({
    devices = [createTemperatureDevice()],
    activeCommands = [],
    recentCommands = [],
    userHistory = [],
}: {
    devices?: RoomBffRealtimeServerMessage extends { payload: infer Payload }
        ? Payload extends { devices: infer Devices }
            ? Devices
            : never
        : never;
    activeCommands?: RoomBffSnapshot['activeCommands'];
    recentCommands?: RoomBffSnapshot['recentCommands'];
    userHistory?: RoomBffSnapshot['userHistory'];
} = {}): RoomBffRealtimeServerMessage {
    return {
        messageType: 'room.snapshot',
        revision: 0,
        sentAt: '2026-06-08T09:30:01Z',
        payload: {
            roomName: 'Smart Room',
            updatedAt: '2026-06-08T09:30:00Z',
            devices,
            activeCommands,
            recentCommands,
            userHistory,
            platform: {
                storage: {
                    status: 'available',
                    changedAt: '2026-06-08T09:30:00Z',
                    historyGenerationId: 'generation-test',
                    storedThroughSequence: 0,
                },
            },
        },
    };
}

export function createDeviceUpdatedMessage({
    previousRevision = 0,
    revision = 1,
    deviceId = 'temp-desk',
    health,
    healthReason,
    reportedState = { temperature: 22.8, temperatureUnit: 'celsius' },
}: {
    previousRevision?: number;
    revision?: number;
    deviceId?: string;
    health?: RoomBffSnapshot['devices'][number]['health'];
    healthReason?: string;
    reportedState?: { temperature: number; temperatureUnit: 'celsius' };
} = {}): RoomBffRealtimeServerMessage {
    return {
        messageType: 'device.updated',
        previousRevision,
        revision,
        sentAt: '2026-06-08T09:30:02Z',
        payload: {
            ...createTemperatureDevice(),
            deviceId,
            ...(health ? { health } : {}),
            ...(healthReason ? { healthReason } : {}),
            reportedState,
        },
    };
}

export function createTemperatureDevice(): RoomBffSnapshot['devices'][number] {
    return {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: {
            temperature: 22.4,
            temperatureUnit: 'celsius',
        },
        commandAvailability: {
            policy: 'block',
            reason: 'read_only_device',
        },
        observationStatus: {
            temperature: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
    };
}

export function createLedDevice(activeCommandId?: string): RoomBffSnapshot['devices'][number] {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-06-08T09:30:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-06-08T09:30:00Z',
        healthDurability: 'durable',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: {
                freshness: 'fresh',
                lastObservedAt: '2026-06-08T09:30:00Z',
                durability: 'durable',
            },
        },
        ...(activeCommandId ? { activeCommandId } : {}),
    };
}

export function createCommandsUpdatedMessage({
    previousRevision = 0,
    revision = 1,
    activeCommands = [createPendingCommand()],
    recentCommands = [],
    devices = [createLedDevice(activeCommands[0]?.commandId)],
}: {
    previousRevision?: number;
    revision?: number;
    devices?: RoomBffSnapshot['devices'];
    activeCommands?: RoomBffSnapshot['activeCommands'];
    recentCommands?: RoomBffSnapshot['recentCommands'];
} = {}): RoomBffRealtimeServerMessage {
    return {
        messageType: 'commands.updated',
        previousRevision,
        revision,
        sentAt: '2026-06-08T09:30:02Z',
        payload: {
            devices,
            activeCommands,
            recentCommands,
        },
    };
}

export function createPendingCommand(): RoomBffSnapshot['activeCommands'][number] {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: '2026-06-08T09:30:00Z',
        delivery: {
            status: 'handed_off',
            dispatchedAt: '2026-06-08T09:30:01Z',
            deadlineAt: '2026-06-08T09:30:06Z',
        },
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}

export function createConfirmedCommand(): RoomBffSnapshot['recentCommands'][number] {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'confirmed',
        requestedState: { power: 'on' },
        requestedAt: '2026-06-08T09:30:00Z',
        delivery: {
            status: 'handed_off',
            dispatchedAt: '2026-06-08T09:30:01Z',
            deadlineAt: '2026-06-08T09:30:06Z',
        },
        confirmedAt: '2026-06-08T09:30:03Z',
        durability: 'durable',
        lifecycleDurability: 'durable',
    };
}
