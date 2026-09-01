import { type Static, Type } from '@sinclair/typebox';

import type { ActiveCommandProjection, TerminalCommandProjection } from './commands';
import type { DeviceProjection, PlatformStorageProjection } from './projections';
import {
    activeCommandProjectionSchema,
    deviceProjectionSchema,
    platformStorageProjectionSchema,
    recentCommandProjectionsSchema,
    type RoomSnapshotProjection,
    roomSnapshotProjectionSchema,
    type terminalCommandProjectionSchema,
} from './projections';
import { canonicalUtcTimestampSchema, isoTimestampSchema, isSchema } from './validation';

export const roomRealtimeServerMessageTypes = [
    'room.snapshot',
    'device.updated',
    'commands.updated',
    'platform.updated',
] as const;

export const roomRealtimeServerMessageSchema = Type.Object(
    {
        messageType: Type.Literal('room.snapshot'),
        revision: Type.Literal(0),
        sentAt: isoTimestampSchema,
        payload: roomSnapshotProjectionSchema,
    },
    { additionalProperties: false },
);
export const deviceUpdatedMessageSchema = Type.Object(
    {
        messageType: Type.Literal('device.updated'),
        previousRevision: Type.Integer({ minimum: 0 }),
        revision: Type.Integer({ minimum: 1 }),
        sentAt: isoTimestampSchema,
        payload: deviceProjectionSchema,
    },
    { additionalProperties: false },
);
export const commandsUpdatedMessageSchema = Type.Object(
    {
        messageType: Type.Literal('commands.updated'),
        previousRevision: Type.Integer({ minimum: 0 }),
        revision: Type.Integer({ minimum: 1 }),
        sentAt: isoTimestampSchema,
        payload: Type.Object(
            {
                devices: Type.Array(deviceProjectionSchema),
                activeCommands: Type.Array(activeCommandProjectionSchema),
                recentCommands: recentCommandProjectionsSchema,
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export const platformUpdatedMessageSchema = Type.Object(
    {
        messageType: Type.Literal('platform.updated'),
        previousRevision: Type.Integer({ minimum: 0 }),
        revision: Type.Integer({ minimum: 1 }),
        sentAt: isoTimestampSchema,
        payload: Type.Object(
            {
                storage: platformStorageProjectionSchema,
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export const roomRealtimeServerMessageUnionSchema = Type.Union([
    roomRealtimeServerMessageSchema,
    deviceUpdatedMessageSchema,
    commandsUpdatedMessageSchema,
    platformUpdatedMessageSchema,
]);

export interface RoomSnapshotMessage {
    messageType: 'room.snapshot';
    revision: 0;
    sentAt: string;
    payload: RoomSnapshotProjection;
}
export interface DeviceUpdatedMessage {
    messageType: 'device.updated';
    previousRevision: number;
    revision: number;
    sentAt: string;
    payload: DeviceProjection;
}
export interface CommandsUpdatedMessage {
    messageType: 'commands.updated';
    previousRevision: number;
    revision: number;
    sentAt: string;
    payload: {
        devices: DeviceProjection[];
        activeCommands: ActiveCommandProjection[];
        recentCommands: TerminalCommandProjection[];
    };
}
export interface PlatformUpdatedMessage {
    messageType: 'platform.updated';
    previousRevision: number;
    revision: number;
    sentAt: string;
    payload: { storage: PlatformStorageProjection };
}
export type RoomRealtimeServerMessage =
    | RoomSnapshotMessage
    | DeviceUpdatedMessage
    | CommandsUpdatedMessage
    | PlatformUpdatedMessage;

export function isRoomRealtimeServerMessage(value: unknown): value is RoomRealtimeServerMessage {
    if (
        !isSchema(roomRealtimeServerMessageUnionSchema, value) ||
        !isCanonicalUtcTimestamp(value.sentAt)
    ) {
        return false;
    }

    if (value.messageType === 'room.snapshot') {
        return isRoomSnapshotProjection(value.payload);
    }

    if (value.messageType === 'commands.updated') {
        return (
            value.revision === value.previousRevision + 1 &&
            hasConsistentCommandCollections(
                value.payload.devices,
                value.payload.activeCommands,
                value.payload.recentCommands,
            ) &&
            value.payload.devices.every(
                (device) => hasCanonicalDeviceTimestamps(device) && hasValidDeviceSemantics(device),
            ) &&
            hasCanonicalCommandTimestamps(
                value.payload.activeCommands,
                value.payload.recentCommands,
            )
        );
    }

    if (value.messageType === 'platform.updated') {
        return (
            value.revision === value.previousRevision + 1 &&
            hasValidPlatformStorage(value.payload.storage)
        );
    }

    return (
        value.revision === value.previousRevision + 1 &&
        hasCanonicalDeviceTimestamps(value.payload) &&
        hasValidDeviceSemantics(value.payload)
    );
}

function hasValidPlatformStorage(storage: {
    status: 'available' | 'degraded' | 'recovering';
    changedAt: string;
    reason?: string;
    historyGenerationId: string | null;
    storedThroughSequence: number | null;
}): boolean {
    return (
        isCanonicalUtcTimestamp(storage.changedAt) &&
        (storage.historyGenerationId === null) === (storage.storedThroughSequence === null) &&
        (storage.status === 'available'
            ? storage.historyGenerationId !== null && storage.storedThroughSequence !== null
            : storage.reason !== undefined)
    );
}

export function isRoomSnapshotProjection(value: unknown): value is RoomSnapshotProjection {
    return (
        isSchema(roomSnapshotProjectionSchema, value) &&
        hasConsistentCommandCollections(
            value.devices,
            value.activeCommands,
            value.recentCommands,
        ) &&
        isCanonicalUtcTimestamp(value.updatedAt) &&
        hasValidPlatformStorage(value.platform.storage) &&
        value.devices.every(
            (device) => hasCanonicalDeviceTimestamps(device) && hasValidDeviceSemantics(device),
        ) &&
        hasCanonicalCommandTimestamps(value.activeCommands, value.recentCommands)
    );
}

function hasConsistentCommandCollections(
    devices: Static<typeof deviceProjectionSchema>[],
    activeCommands: Static<typeof activeCommandProjectionSchema>[],
    recentCommands: Static<typeof terminalCommandProjectionSchema>[],
): boolean {
    const devicesById = new Map(devices.map((device) => [device.deviceId, device]));

    if (devicesById.size !== devices.length) {
        return false;
    }

    const activeCommandByDeviceId = new Map<string, string>();
    const commandIds = new Set<string>();

    for (const command of activeCommands) {
        if (
            !isSetPowerCapableDevice(devicesById.get(command.deviceId)) ||
            activeCommandByDeviceId.has(command.deviceId) ||
            commandIds.has(command.commandId)
        ) {
            return false;
        }

        activeCommandByDeviceId.set(command.deviceId, command.commandId);
        commandIds.add(command.commandId);
    }

    for (const command of recentCommands) {
        if (
            !devicesById.has(command.deviceId) ||
            (command.status !== 'failed' &&
                !isSetPowerCapableDevice(devicesById.get(command.deviceId))) ||
            commandIds.has(command.commandId)
        ) {
            return false;
        }

        commandIds.add(command.commandId);
    }

    return devices.every(
        (device) => device.activeCommandId === activeCommandByDeviceId.get(device.deviceId),
    );
}

function isSetPowerCapableDevice(
    device: Static<typeof deviceProjectionSchema> | undefined,
): boolean {
    return device?.role === 'led-output';
}

function hasCanonicalCommandTimestamps(
    activeCommands: Static<typeof activeCommandProjectionSchema>[],
    recentCommands: Static<typeof terminalCommandProjectionSchema>[],
): boolean {
    return (
        activeCommands.every(
            (command) =>
                isCanonicalUtcTimestamp(command.requestedAt) &&
                (command.status !== 'pending' ||
                    hasCanonicalDelivery(command.delivery, command.requestedAt)),
        ) &&
        recentCommands.every((command) => {
            if (!isCanonicalUtcTimestamp(command.requestedAt)) {
                return false;
            }

            switch (command.status) {
                case 'confirmed':
                    return (
                        hasCanonicalDelivery(command.delivery, command.requestedAt) &&
                        isCanonicalUtcTimestamp(command.confirmedAt) &&
                        areChronological(deliveryOrigin(command.delivery), command.confirmedAt)
                    );
                case 'failed':
                    return (
                        isCanonicalUtcTimestamp(command.failedAt) &&
                        (command.delivery === undefined ||
                            (hasCanonicalDelivery(command.delivery, command.requestedAt) &&
                                areChronological(
                                    deliveryOrigin(command.delivery),
                                    command.failedAt,
                                ))) &&
                        (command.delivery !== undefined ||
                            areChronological(command.requestedAt, command.failedAt))
                    );
                case 'timed_out':
                    return (
                        hasCanonicalDelivery(command.delivery, command.requestedAt) &&
                        isCanonicalUtcTimestamp(command.timedOutAt) &&
                        areChronological(
                            deliveryOrigin(command.delivery),
                            command.delivery.deadlineAt,
                            command.timedOutAt,
                        )
                    );
            }
        }) &&
        recentCommands.every((command, index) => {
            const next = recentCommands[index + 1];

            return next === undefined || terminalTimestamp(command) >= terminalTimestamp(next);
        })
    );
}

function hasCanonicalDelivery(
    delivery:
        | { status: 'handed_off'; dispatchedAt: string; deadlineAt: string }
        | { status: 'uncertain'; firstAttemptedAt: string; deadlineAt: string },
    requestedAt: string,
): boolean {
    const origin = deliveryOrigin(delivery);

    return (
        isCanonicalUtcTimestamp(origin) &&
        isCanonicalUtcTimestamp(delivery.deadlineAt) &&
        areChronological(requestedAt, origin, delivery.deadlineAt)
    );
}

function deliveryOrigin(
    delivery:
        | { status: 'handed_off'; dispatchedAt: string; deadlineAt: string }
        | { status: 'uncertain'; firstAttemptedAt: string; deadlineAt: string },
): string {
    return delivery.status === 'handed_off' ? delivery.dispatchedAt : delivery.firstAttemptedAt;
}

function hasCanonicalDeviceTimestamps(device: Static<typeof deviceProjectionSchema>): boolean {
    return (
        isCanonicalUtcTimestamp(device.availabilityChangedAt) &&
        isCanonicalUtcTimestamp(device.healthChangedAt) &&
        Object.values(device.observationStatus).every(
            (status) =>
                status.lastObservedAt === undefined ||
                isCanonicalUtcTimestamp(status.lastObservedAt),
        )
    );
}

function hasValidDeviceSemantics(device: Static<typeof deviceProjectionSchema>): boolean {
    if ((device.availability === 'offline') !== (device.availabilityReason !== undefined)) {
        return false;
    }

    if ((device.health === 'degraded') !== (device.healthReason !== undefined)) {
        return false;
    }

    if (
        Object.values(device.observationStatus).some(
            (status) =>
                (status.freshness === 'fresh' || status.freshness === 'stale') &&
                status.lastObservedAt === undefined,
        )
    ) {
        return false;
    }

    if (device.role !== 'led-output') {
        return (
            device.commandAvailability.policy === 'block' &&
            device.commandAvailability.reason === 'read_only_device'
        );
    }

    if (device.availability === 'offline') {
        return (
            device.commandAvailability.policy === 'block' &&
            device.commandAvailability.reason === 'device_offline'
        );
    }

    if (device.availability === 'unknown') {
        return (
            device.commandAvailability.policy === 'block' &&
            device.commandAvailability.reason === 'availability_unknown'
        );
    }

    if (device.health !== 'degraded') {
        return (
            device.commandAvailability.policy === 'allow' &&
            device.commandAvailability.reason === undefined
        );
    }

    return (
        (device.commandAvailability.policy === 'allow_with_warning' ||
            device.commandAvailability.policy === 'block') &&
        device.commandAvailability.reason === 'device_degraded'
    );
}

function isCanonicalUtcTimestamp(value: string): boolean {
    return isSchema(canonicalUtcTimestampSchema, value);
}

function areChronological(...timestamps: string[]): boolean {
    return timestamps.every(
        (timestamp, index) =>
            index === 0 || Date.parse(timestamps[index - 1]) <= Date.parse(timestamp),
    );
}

function terminalTimestamp(command: Static<typeof terminalCommandProjectionSchema>): number {
    switch (command.status) {
        case 'confirmed':
            return Date.parse(command.confirmedAt);
        case 'failed':
            return Date.parse(command.failedAt);
        case 'timed_out':
            return Date.parse(command.timedOutAt);
    }
}
