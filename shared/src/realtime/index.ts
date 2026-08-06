import { type Static, Type } from '@sinclair/typebox';

import type { ActiveCommandProjection, TerminalCommandProjection } from '../commands';
import {
    activeCommandProjectionSchema,
    type DeviceProjection,
    deviceProjectionSchema,
    recentCommandProjectionsSchema,
    type RoomSnapshotProjection,
    roomSnapshotProjectionSchema,
    type terminalCommandProjectionSchema,
} from '../projections';
import { canonicalUtcTimestampSchema, isoTimestampSchema, isSchema } from '../validation';

export type RoomRealtimeServerMessage =
    | RoomSnapshotMessage
    | DeviceUpdatedMessage
    | CommandsUpdatedMessage;
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
        device: DeviceProjection;
        activeCommands: ActiveCommandProjection[];
        recentCommands: TerminalCommandProjection[];
    };
}

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
                device: deviceProjectionSchema,
                activeCommands: Type.Array(activeCommandProjectionSchema),
                recentCommands: recentCommandProjectionsSchema,
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
]);

export function isRoomRealtimeServerMessage(value: unknown): value is RoomRealtimeServerMessage {
    if (
        !isSchema(roomRealtimeServerMessageUnionSchema, value) ||
        !isCanonicalUtcTimestamp(value.sentAt)
    )
        return false;
    if (value.messageType === 'room.snapshot') return isRoomSnapshotProjection(value.payload);
    if (value.messageType === 'commands.updated')
        return (
            value.revision === value.previousRevision + 1 &&
            hasConsistentCommandCollections(
                [value.payload.device],
                value.payload.activeCommands,
                value.payload.recentCommands,
            ) &&
            hasCanonicalDeviceTimestamps(value.payload.device) &&
            hasCanonicalCommandTimestamps(
                value.payload.activeCommands,
                value.payload.recentCommands,
            )
        );
    return (
        value.revision === value.previousRevision + 1 && hasCanonicalDeviceTimestamps(value.payload)
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
        value.devices.every(hasCanonicalDeviceTimestamps) &&
        hasCanonicalCommandTimestamps(value.activeCommands, value.recentCommands)
    );
}

function hasConsistentCommandCollections(
    devices: Static<typeof deviceProjectionSchema>[],
    activeCommands: Static<typeof activeCommandProjectionSchema>[],
    recentCommands: Static<typeof terminalCommandProjectionSchema>[],
): boolean {
    const deviceIds = new Set(devices.map((device) => device.deviceId));
    if (deviceIds.size !== devices.length) return false;
    const activeCommandByDeviceId = new Map<string, string>();
    const commandIds = new Set<string>();
    for (const command of activeCommands) {
        if (
            !deviceIds.has(command.deviceId) ||
            !isSetPowerCapableDevice(
                devices.find((device) => device.deviceId === command.deviceId),
            ) ||
            activeCommandByDeviceId.has(command.deviceId) ||
            commandIds.has(command.commandId)
        )
            return false;
        activeCommandByDeviceId.set(command.deviceId, command.commandId);
        commandIds.add(command.commandId);
    }
    for (const command of recentCommands) {
        if (
            !deviceIds.has(command.deviceId) ||
            (command.status !== 'failed' &&
                !isSetPowerCapableDevice(
                    devices.find((device) => device.deviceId === command.deviceId),
                )) ||
            commandIds.has(command.commandId)
        )
            return false;
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
                    (isCanonicalUtcTimestamp(command.dispatchedAt) &&
                        areChronological(command.requestedAt, command.dispatchedAt))),
        ) &&
        recentCommands.every((command) => {
            if (!isCanonicalUtcTimestamp(command.requestedAt)) return false;
            switch (command.status) {
                case 'confirmed':
                    return (
                        isCanonicalUtcTimestamp(command.dispatchedAt) &&
                        isCanonicalUtcTimestamp(command.confirmedAt) &&
                        areChronological(
                            command.requestedAt,
                            command.dispatchedAt,
                            command.confirmedAt,
                        )
                    );
                case 'failed':
                    return (
                        isCanonicalUtcTimestamp(command.failedAt) &&
                        (command.dispatchedAt === undefined ||
                            (isCanonicalUtcTimestamp(command.dispatchedAt) &&
                                areChronological(
                                    command.requestedAt,
                                    command.dispatchedAt,
                                    command.failedAt,
                                ))) &&
                        (command.dispatchedAt !== undefined ||
                            areChronological(command.requestedAt, command.failedAt))
                    );
                case 'timed_out':
                    return (
                        isCanonicalUtcTimestamp(command.dispatchedAt) &&
                        isCanonicalUtcTimestamp(command.timedOutAt) &&
                        areChronological(
                            command.requestedAt,
                            command.dispatchedAt,
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
function hasCanonicalDeviceTimestamps(device: Static<typeof deviceProjectionSchema>): boolean {
    return device.lastSeenAt === undefined || isCanonicalUtcTimestamp(device.lastSeenAt);
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
