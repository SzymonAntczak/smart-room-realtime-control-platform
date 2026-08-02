import { FormatRegistry, type Static, type TSchema, Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { fullFormats } from 'ajv-formats/dist/formats.js';

import { ignoredEventReasons } from './dev-diagnostics';
import { temperatureScenarioActions } from './dev-scenarios';
import { commandAvailabilityPolicies, deviceHealthStates, deviceRoles } from './devices';
import { platformEventSources } from './events';
import { platformEventTypes } from './events';
import type { RoomRealtimeServerMessage } from './realtime';

if (!FormatRegistry.Has('date-time')) {
    FormatRegistry.Set('date-time', isRfc3339DateTime);
}

const nonEmptyStringSchema = Type.String({ minLength: 1 });
const deviceStateValueSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean()]);
const deviceStateSchema = Type.Record(Type.String(), deviceStateValueSchema);
const powerStateSchema = Type.Union([Type.Literal('on'), Type.Literal('off')]);
const powerStateProjectionSchema = Type.Object({ power: powerStateSchema });

export const isoTimestampSchema = Type.String({ format: 'date-time' });
export const canonicalUtcTimestampSchema = Type.String({
    format: 'date-time',
    pattern: 'Z$',
});

const platformEventCandidateShape = {
    eventId: nonEmptyStringSchema,
    eventType: Type.String(),
    version: Type.Number(),
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
    version: Type.Literal(1),
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
const legacyEventFeedItemProjectionSchema = Type.Object(
    {
        eventId: nonEmptyStringSchema,
        eventType: Type.Union(platformEventTypes.map((eventType) => Type.Literal(eventType))),
        occurredAt: isoTimestampSchema,
        source: Type.Union(platformEventSources.map((source) => Type.Literal(source))),
        deviceId: Type.Optional(nonEmptyStringSchema),
        commandId: Type.Optional(nonEmptyStringSchema),
        summary: nonEmptyStringSchema,
    },
    { additionalProperties: false },
);
const legacyDeviceProjectionSchema = Type.Object(
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
        recentEvents: Type.Optional(
            Type.Array(legacyEventFeedItemProjectionSchema, { maxItems: 10 }),
        ),
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
export const roomSnapshotProjectionSchema = Type.Object(
    {
        roomName: nonEmptyStringSchema,
        updatedAt: isoTimestampSchema,
        devices: Type.Array(deviceProjectionSchema),
        activeCommands: Type.Array(activeCommandProjectionSchema),
        recentCommands: Type.Optional(Type.Array(terminalCommandProjectionSchema)),
    },
    { additionalProperties: false },
);
const roomSnapshotV1ProjectionSchema = Type.Object(
    {
        roomName: nonEmptyStringSchema,
        updatedAt: isoTimestampSchema,
        devices: Type.Array(legacyDeviceProjectionSchema),
        activeCommands: Type.Array(activeCommandProjectionSchema),
        recentCommands: Type.Optional(Type.Array(terminalCommandProjectionSchema)),
        recentEvents: Type.Array(legacyEventFeedItemProjectionSchema),
    },
    { additionalProperties: false },
);
export const roomRealtimeServerMessageSchema = Type.Object({
    messageType: Type.Literal('room.snapshot'),
    version: Type.Literal(2),
    revision: Type.Literal(0),
    sentAt: isoTimestampSchema,
    payload: roomSnapshotProjectionSchema,
});
const roomRealtimeV1ServerMessageSchema = Type.Object({
    messageType: Type.Literal('room.snapshot'),
    version: Type.Literal(1),
    sentAt: isoTimestampSchema,
    payload: roomSnapshotV1ProjectionSchema,
});
export const deviceUpdatedMessageSchema = Type.Object({
    messageType: Type.Literal('device.updated'),
    version: Type.Literal(2),
    previousRevision: Type.Integer({ minimum: 0 }),
    revision: Type.Integer({ minimum: 1 }),
    sentAt: isoTimestampSchema,
    payload: deviceProjectionSchema,
});
export const roomRealtimeServerMessageUnionSchema = Type.Union([
    roomRealtimeServerMessageSchema,
    roomRealtimeV1ServerMessageSchema,
    deviceUpdatedMessageSchema,
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

    if (value.messageType === 'room.snapshot') {
        return value.version === 1
            ? isRoomSnapshotV1Projection(value.payload)
            : isRoomSnapshotProjection(value.payload);
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
    const deviceIds = new Set(snapshot.devices.map((device) => device.deviceId));
    if (deviceIds.size !== snapshot.devices.length) return false;
    const activeCommandByDeviceId = new Map<string, string>();
    const commandIds = new Set<string>();

    for (const command of snapshot.activeCommands) {
        if (!deviceIds.has(command.deviceId) || activeCommandByDeviceId.has(command.deviceId)) {
            return false;
        }

        activeCommandByDeviceId.set(command.deviceId, command.commandId);
        commandIds.add(command.commandId);
    }

    for (const command of snapshot.recentCommands ?? []) {
        if (!deviceIds.has(command.deviceId) || commandIds.has(command.commandId)) return false;
        commandIds.add(command.commandId);
    }

    return snapshot.devices.every((device) => {
        const activeCommandId = activeCommandByDeviceId.get(device.deviceId);

        return device.activeCommandId === activeCommandId;
    });
}

function hasCanonicalProjectionTimestamps(
    snapshot: Static<typeof roomSnapshotProjectionSchema>,
): boolean {
    return (
        isCanonicalUtcTimestamp(snapshot.updatedAt) &&
        snapshot.devices.every((device) => hasCanonicalDeviceTimestamps(device)) &&
        snapshot.activeCommands.every(
            (command) =>
                isCanonicalUtcTimestamp(command.requestedAt) &&
                (command.status !== 'pending' || isCanonicalUtcTimestamp(command.dispatchedAt)),
        ) &&
        (snapshot.recentCommands ?? []).every((command) => {
            if (!isCanonicalUtcTimestamp(command.requestedAt)) return false;

            switch (command.status) {
                case 'confirmed':
                    return (
                        isCanonicalUtcTimestamp(command.dispatchedAt) &&
                        isCanonicalUtcTimestamp(command.confirmedAt)
                    );
                case 'failed':
                    return isCanonicalUtcTimestamp(command.failedAt);
                case 'timed_out':
                    return (
                        isCanonicalUtcTimestamp(command.dispatchedAt) &&
                        isCanonicalUtcTimestamp(command.timedOutAt)
                    );
            }
        })
    );
}

function hasCanonicalDeviceTimestamps(device: Static<typeof deviceProjectionSchema>): boolean {
    return device.lastSeenAt === undefined || isCanonicalUtcTimestamp(device.lastSeenAt);
}

function isRoomSnapshotV1Projection(value: unknown): boolean {
    if (!isSchema(roomSnapshotV1ProjectionSchema, value)) return false;

    return (
        hasConsistentCommands(value) &&
        isCanonicalUtcTimestamp(value.updatedAt) &&
        value.devices.every(
            (device) =>
                hasCanonicalDeviceTimestamps(device) &&
                (device.recentEvents ?? []).every(
                    (event) =>
                        isCanonicalUtcTimestamp(event.occurredAt) &&
                        event.deviceId === device.deviceId,
                ),
        ) &&
        value.recentEvents.every((event) => isCanonicalUtcTimestamp(event.occurredAt))
    );
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
