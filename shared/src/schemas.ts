import { FormatRegistry, type Static, type TSchema, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { fullFormats } from 'ajv-formats/dist/formats.js';

import { ignoredEventReasons } from './dev-diagnostics';
import { temperatureScenarioActions } from './dev-scenarios';
import { commandAvailabilityPolicies, deviceHealthStates, deviceRoles } from './devices';
import { platformEventSources } from './events';
import type { RoomRealtimeServerMessage } from './realtime';

if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set('date-time', isRfc3339DateTime);
}

const nonEmptyStringSchema = Type.String({ minLength: 1 });
const deviceStateValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const deviceStateSchema = Type.Record(Type.String(), deviceStateValueSchema);
const powerStateSchema = Type.Union([Type.Literal('on'), Type.Literal('off')]);
const powerStateProjectionSchema = Type.Object(
    { power: powerStateSchema },
    { additionalProperties: false },
);

export const setPowerCommandRequestSchema = Type.Object(
    {
        deviceId: nonEmptyStringSchema,
        commandType: Type.Literal('set.power'),
        requestedState: powerStateProjectionSchema,
    },
    { additionalProperties: false },
);
export const acceptedCommandResponseSchema = Type.Object(
    {
        commandId: nonEmptyStringSchema,
        status: Type.Literal('accepted'),
    },
    { additionalProperties: false },
);
export const rejectedCommandResponseSchema = Type.Object(
    {
        commandId: nonEmptyStringSchema,
        status: Type.Literal('rejected'),
        reason: nonEmptyStringSchema,
        message: nonEmptyStringSchema,
    },
    { additionalProperties: false },
);

export const isoTimestampSchema = Type.String({ format: 'date-time' });
export const canonicalUtcTimestampSchema = Type.String({
    format: 'date-time',
    pattern: 'Z$',
});

const platformEventCandidateShape = {
    eventId: nonEmptyStringSchema,
    eventType: Type.String(),
    occurredAt: isoTimestampSchema,
    source: Type.Union(platformEventSources.map((source) => Type.Literal(source))),
    deviceId: Type.Optional(nonEmptyStringSchema),
    commandId: Type.Optional(nonEmptyStringSchema),
    payload: Type.Unknown(),
};

export const platformEventCandidateSchema = Type.Object(platformEventCandidateShape);

const deviceStateReportedPayloadSchema = Type.Object({
    reportedState: deviceStateSchema,
    reportedAt: isoTimestampSchema,
});
const deviceHealthChangedPayloadSchema = Type.Object({
    previousHealth: Type.Union(deviceHealthStates.map((health) => Type.Literal(health))),
    health: Type.Union(deviceHealthStates.map((health) => Type.Literal(health))),
    reason: nonEmptyStringSchema,
});
export const telemetryReadingRecordedPayloadSchema = Type.Object({
    metric: Type.Literal('temperature'),
    value: Type.Number(),
    unit: Type.Literal('celsius'),
});

const commandRequestedPayloadSchema = Type.Object({
    commandType: Type.Literal('set.power'),
    requestedState: powerStateProjectionSchema,
    requestedBy: Type.Union([Type.Literal('user'), Type.Literal('automation')]),
});
const commandDispatchedPayloadSchema = Type.Object({
    commandType: Type.Literal('set.power'),
    target: Type.Union(platformEventSources.map((source) => Type.Literal(source))),
});
const commandConfirmedPayloadSchema = Type.Object({
    confirmationSource: Type.Literal('device.state.reported'),
    matchedState: powerStateProjectionSchema,
});
const commandFailedPayloadSchema = Type.Object({
    reason: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
});
const commandTimedOutPayloadSchema = Type.Object({
    timeoutMs: Type.Integer({ minimum: 1 }),
    reason: nonEmptyStringSchema,
});

const platformEventBaseShape = {
    eventId: nonEmptyStringSchema,
    occurredAt: isoTimestampSchema,
    source: Type.Union(platformEventSources.map((source) => Type.Literal(source))),
};

export const deviceStateReportedEventSchema = Type.Object({
    ...platformEventBaseShape,
    eventType: Type.Literal('device.state.reported'),
    deviceId: nonEmptyStringSchema,
    payload: deviceStateReportedPayloadSchema,
});
export const deviceHealthChangedEventSchema = Type.Object({
    ...platformEventBaseShape,
    eventType: Type.Literal('device.health.changed'),
    deviceId: nonEmptyStringSchema,
    payload: deviceHealthChangedPayloadSchema,
});
export const telemetryReadingRecordedEventSchema = Type.Object({
    ...platformEventBaseShape,
    eventType: Type.Literal('telemetry.reading.recorded'),
    deviceId: nonEmptyStringSchema,
    payload: telemetryReadingRecordedPayloadSchema,
});

const commandEventBaseShape = {
    ...platformEventBaseShape,
    deviceId: nonEmptyStringSchema,
    commandId: nonEmptyStringSchema,
};
export const commandRequestedEventSchema = Type.Object({
    ...commandEventBaseShape,
    eventType: Type.Literal('command.requested'),
    payload: commandRequestedPayloadSchema,
});
export const commandDispatchedEventSchema = Type.Object({
    ...commandEventBaseShape,
    eventType: Type.Literal('command.dispatched'),
    payload: commandDispatchedPayloadSchema,
});
export const commandConfirmedEventSchema = Type.Object({
    ...commandEventBaseShape,
    eventType: Type.Literal('command.confirmed'),
    payload: commandConfirmedPayloadSchema,
});
export const commandFailedEventSchema = Type.Object({
    ...commandEventBaseShape,
    eventType: Type.Literal('command.failed'),
    payload: commandFailedPayloadSchema,
});
export const commandTimedOutEventSchema = Type.Object({
    ...commandEventBaseShape,
    eventType: Type.Literal('command.timed_out'),
    payload: commandTimedOutPayloadSchema,
});

export const platformEventEnvelopeSchema = Type.Union([
    deviceStateReportedEventSchema,
    deviceHealthChangedEventSchema,
    telemetryReadingRecordedEventSchema,
    commandRequestedEventSchema,
    commandDispatchedEventSchema,
    commandConfirmedEventSchema,
    commandFailedEventSchema,
    commandTimedOutEventSchema,
]);

const commandAvailabilitySchema = Type.Object({
    policy: Type.Union(commandAvailabilityPolicies.map((policy) => Type.Literal(policy))),
    reason: Type.Optional(Type.String()),
});
const deviceProjectionSchema = Type.Object(
    {
        deviceId: nonEmptyStringSchema,
        name: nonEmptyStringSchema,
        role: Type.Union(deviceRoles.map((role) => Type.Literal(role))),
        health: Type.Union(deviceHealthStates.map((health) => Type.Literal(health))),
        reportedState: deviceStateSchema,
        requestedState: Type.Optional(deviceStateSchema),
        commandAvailability: commandAvailabilitySchema,
        lastSeenAt: Type.Optional(isoTimestampSchema),
        warning: Type.Optional(Type.String()),
        activeCommandId: Type.Optional(nonEmptyStringSchema),
    },
    { additionalProperties: false },
);
const activeCommandProjectionBaseShape = {
    commandId: nonEmptyStringSchema,
    deviceId: nonEmptyStringSchema,
    commandType: Type.Literal('set.power'),
    requestedState: powerStateProjectionSchema,
    requestedAt: isoTimestampSchema,
    reason: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
};
const activeCommandProjectionSchema = Type.Union([
    Type.Object(
        { ...activeCommandProjectionBaseShape, status: Type.Literal('accepted') },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...activeCommandProjectionBaseShape,
            status: Type.Literal('pending'),
            dispatchedAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
]);
const terminalCommandProjectionSchema = Type.Union([
    Type.Object(
        {
            ...activeCommandProjectionBaseShape,
            status: Type.Literal('confirmed'),
            dispatchedAt: isoTimestampSchema,
            confirmedAt: isoTimestampSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...activeCommandProjectionBaseShape,
            status: Type.Literal('failed'),
            dispatchedAt: Type.Optional(isoTimestampSchema),
            failedAt: isoTimestampSchema,
            reason: nonEmptyStringSchema,
            message: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
    Type.Object(
        {
            ...activeCommandProjectionBaseShape,
            status: Type.Literal('timed_out'),
            dispatchedAt: isoTimestampSchema,
            timedOutAt: isoTimestampSchema,
            reason: nonEmptyStringSchema,
        },
        { additionalProperties: false },
    ),
]);
const recentCommandProjectionsSchema = Type.Array(terminalCommandProjectionSchema, {
    maxItems: 20,
});
export const roomSnapshotProjectionSchema = Type.Object(
    {
        roomName: nonEmptyStringSchema,
        updatedAt: isoTimestampSchema,
        devices: Type.Array(deviceProjectionSchema),
        activeCommands: Type.Array(activeCommandProjectionSchema),
        recentCommands: recentCommandProjectionsSchema,
    },
    { additionalProperties: false },
);
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

export const temperatureScenarioActionSchema = Type.Union(
    temperatureScenarioActions.map((action) => Type.Literal(action)),
);
export const temperatureScenarioRequestSchema = Type.Object({
    action: temperatureScenarioActionSchema,
});
export const deviceScenarioParamsSchema = Type.Object({
    deviceId: nonEmptyStringSchema,
});
export const deviceScenarioDescriptorSchema = Type.Object({
    action: temperatureScenarioActionSchema,
});
export const deviceScenarioListSchema = Type.Object({
    deviceId: nonEmptyStringSchema,
    scenarios: Type.Array(deviceScenarioDescriptorSchema),
});
export const temperatureScenarioResultSchema = Type.Object({
    action: temperatureScenarioActionSchema,
    status: Type.Literal('completed'),
});
export const apiErrorResponseSchema = Type.Object({
    error: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
});

const ignoredEventDiagnosticSchema = Type.Object({
    diagnosticId: nonEmptyStringSchema,
    reason: Type.Union(ignoredEventReasons.map((reason) => Type.Literal(reason))),
    observedAt: isoTimestampSchema,
    eventId: Type.Optional(Type.String()),
    eventType: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
    deviceId: Type.Optional(Type.String()),
    commandId: Type.Optional(Type.String()),
    occurredAt: Type.Optional(isoTimestampSchema),
});
export const eventProcessingDiagnosticsSnapshotSchema = Type.Object({
    ignoredEvents: Type.Array(ignoredEventDiagnosticSchema),
    deduplicationEvictions: Type.Optional(
        Type.Array(
            Type.Object({
                diagnosticId: nonEmptyStringSchema,
                evictedEventId: nonEmptyStringSchema,
                observedAt: isoTimestampSchema,
            }),
        ),
    ),
});

export function isSchema<TSchemaType extends TSchema>(
    schema: TSchemaType,
    value: unknown,
): value is Static<TSchemaType> {
    return Value.Check(schema, value);
}

export function normalizeIsoTimestamp(value: unknown): string | undefined {
    if (typeof value !== 'string' || !isSchema(isoTimestampSchema, value)) {
        return undefined;
    }

    return new Date(value).toISOString().replace('.000Z', 'Z');
}

export function isRoomRealtimeServerMessage(value: unknown): value is RoomRealtimeServerMessage {
    if (
        !isSchema(roomRealtimeServerMessageUnionSchema, value) ||
        !isCanonicalUtcTimestamp(value.sentAt)
    ) {
        return false;
    }

    if (value.messageType === 'room.snapshot') return isRoomSnapshotProjection(value.payload);

    if (value.messageType === 'commands.updated') {
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
    }

    return (
        value.revision === value.previousRevision + 1 && hasCanonicalDeviceTimestamps(value.payload)
    );
}

export function isRoomSnapshotProjection(value: unknown): boolean {
    return (
        isSchema(roomSnapshotProjectionSchema, value) &&
        hasConsistentCommands(value) &&
        hasCanonicalProjectionTimestamps(value)
    );
}

function hasConsistentCommands(snapshot: Static<typeof roomSnapshotProjectionSchema>): boolean {
    return hasConsistentCommandCollections(
        snapshot.devices,
        snapshot.activeCommands,
        snapshot.recentCommands,
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
        ) {
            return false;
        }

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
        ) {
            return false;
        }
        commandIds.add(command.commandId);
    }

    return devices.every((device) => {
        const activeCommandId = activeCommandByDeviceId.get(device.deviceId);

        return device.activeCommandId === activeCommandId;
    });
}

function isSetPowerCapableDevice(
    device: Static<typeof deviceProjectionSchema> | undefined,
): boolean {
    return device?.role === 'led-output';
}

function hasCanonicalProjectionTimestamps(
    snapshot: Static<typeof roomSnapshotProjectionSchema>,
): boolean {
    return (
        isCanonicalUtcTimestamp(snapshot.updatedAt) &&
        snapshot.devices.every((device) => hasCanonicalDeviceTimestamps(device)) &&
        hasCanonicalCommandTimestamps(snapshot.activeCommands, snapshot.recentCommands)
    );
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
            const nextCommand = recentCommands[index + 1];
            return (
                nextCommand === undefined ||
                terminalTimestamp(command) >= terminalTimestamp(nextCommand)
            );
        })
    );
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

function hasCanonicalDeviceTimestamps(device: Static<typeof deviceProjectionSchema>): boolean {
    return device.lastSeenAt === undefined || isCanonicalUtcTimestamp(device.lastSeenAt);
}

function isCanonicalUtcTimestamp(value: string): boolean {
    return isSchema(canonicalUtcTimestampSchema, value);
}

function isRfc3339DateTime(value: string): boolean {
    const format = fullFormats['date-time'];
    const validator =
        typeof format === 'object' && format !== null && 'validate' in format
            ? (format.validate as (candidate: string) => boolean)
            : undefined;

    return typeof validator === 'function' && validator(value) === true;
}
