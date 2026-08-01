import { z } from 'zod';

import { ignoredEventReasons } from './dev-diagnostics';
import { temperatureScenarioActions } from './dev-scenarios';
import { commandAvailabilityPolicies, deviceHealthStates, deviceRoles } from './devices';
import { platformEventSources, platformEventTypes } from './events';

const deviceStateValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const deviceStateSchema = z.record(z.string(), deviceStateValueSchema);
const powerStateSchema = z.enum(['on', 'off']);
const powerStateProjectionSchema = z.object({ power: powerStateSchema });
const nonEmptyStringSchema = z.string().min(1);

export const isoTimestampSchema = z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value).toISOString().replace('.000Z', 'Z'));

const platformEventCandidateShape = {
    eventId: nonEmptyStringSchema,
    eventType: z.string(),
    version: z.number(),
    occurredAt: isoTimestampSchema,
    source: z.enum(platformEventSources),
    deviceId: nonEmptyStringSchema.optional(),
    commandId: nonEmptyStringSchema.optional(),
    payload: z.unknown(),
};

export const platformEventCandidateSchema = z.object(platformEventCandidateShape);

const deviceStateReportedPayloadSchema = z.object({
    reportedState: deviceStateSchema,
    reportedAt: isoTimestampSchema,
});

const deviceHealthChangedPayloadSchema = z.object({
    previousHealth: z.enum(deviceHealthStates),
    health: z.enum(deviceHealthStates),
    reason: nonEmptyStringSchema,
});

export const telemetryReadingRecordedPayloadSchema = z.object({
    metric: z.literal('temperature'),
    value: z.number().finite(),
    unit: z.literal('celsius'),
});

const commandRequestedPayloadSchema = z.object({
    commandType: z.literal('set.power'),
    requestedState: powerStateProjectionSchema,
    requestedBy: z.enum(['user', 'automation']),
});

const commandDispatchedPayloadSchema = z.object({
    commandType: z.literal('set.power'),
    target: z.enum(platformEventSources),
});

const commandConfirmedPayloadSchema = z.object({
    confirmationSource: z.literal('device.state.reported'),
    matchedState: powerStateProjectionSchema,
});

const commandFailedPayloadSchema = z.object({
    reason: nonEmptyStringSchema,
    message: nonEmptyStringSchema,
});

const commandTimedOutPayloadSchema = z.object({
    timeoutMs: z.number().int().positive(),
    reason: nonEmptyStringSchema,
});

const platformEventBaseShape = {
    eventId: nonEmptyStringSchema,
    version: z.literal(1),
    occurredAt: isoTimestampSchema,
    source: z.enum(platformEventSources),
};

export const deviceStateReportedEventSchema = z.object({
    ...platformEventBaseShape,
    eventType: z.literal('device.state.reported'),
    deviceId: nonEmptyStringSchema,
    payload: deviceStateReportedPayloadSchema,
});

export const deviceHealthChangedEventSchema = z.object({
    ...platformEventBaseShape,
    eventType: z.literal('device.health.changed'),
    deviceId: nonEmptyStringSchema,
    payload: deviceHealthChangedPayloadSchema,
});

export const telemetryReadingRecordedEventSchema = z.object({
    ...platformEventBaseShape,
    eventType: z.literal('telemetry.reading.recorded'),
    deviceId: nonEmptyStringSchema,
    payload: telemetryReadingRecordedPayloadSchema,
});

const commandEventBaseShape = {
    ...platformEventBaseShape,
    deviceId: nonEmptyStringSchema,
    commandId: nonEmptyStringSchema,
};

export const commandRequestedEventSchema = z.object({
    ...commandEventBaseShape,
    eventType: z.literal('command.requested'),
    payload: commandRequestedPayloadSchema,
});

export const commandDispatchedEventSchema = z.object({
    ...commandEventBaseShape,
    eventType: z.literal('command.dispatched'),
    payload: commandDispatchedPayloadSchema,
});

export const commandConfirmedEventSchema = z.object({
    ...commandEventBaseShape,
    eventType: z.literal('command.confirmed'),
    payload: commandConfirmedPayloadSchema,
});

export const commandFailedEventSchema = z.object({
    ...commandEventBaseShape,
    eventType: z.literal('command.failed'),
    payload: commandFailedPayloadSchema,
});

export const commandTimedOutEventSchema = z.object({
    ...commandEventBaseShape,
    eventType: z.literal('command.timed_out'),
    payload: commandTimedOutPayloadSchema,
});

export const platformEventEnvelopeSchema = z.discriminatedUnion('eventType', [
    deviceStateReportedEventSchema,
    deviceHealthChangedEventSchema,
    telemetryReadingRecordedEventSchema,
    commandRequestedEventSchema,
    commandDispatchedEventSchema,
    commandConfirmedEventSchema,
    commandFailedEventSchema,
    commandTimedOutEventSchema,
]);

const commandAvailabilitySchema = z.object({
    policy: z.enum(commandAvailabilityPolicies),
    reason: z.string().optional(),
});

const deviceProjectionSchema = z.object({
    deviceId: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    role: z.enum(deviceRoles),
    health: z.enum(deviceHealthStates),
    reportedState: deviceStateSchema,
    requestedState: deviceStateSchema.optional(),
    commandAvailability: commandAvailabilitySchema,
    lastSeenAt: isoTimestampSchema.optional(),
    warning: z.string().optional(),
    activeCommandId: nonEmptyStringSchema.optional(),
});

const activeCommandProjectionBaseShape = {
    commandId: nonEmptyStringSchema,
    deviceId: nonEmptyStringSchema,
    commandType: z.literal('set.power'),
    requestedState: powerStateProjectionSchema,
    requestedAt: isoTimestampSchema,
    reason: z.string().optional(),
    message: z.string().optional(),
    confirmedAt: z.never().optional(),
    failedAt: z.never().optional(),
    timedOutAt: z.never().optional(),
};

const activeCommandProjectionSchema = z.discriminatedUnion('status', [
    z.object({
        ...activeCommandProjectionBaseShape,
        status: z.literal('accepted'),
        dispatchedAt: z.never().optional(),
    }),
    z.object({
        ...activeCommandProjectionBaseShape,
        status: z.literal('pending'),
        dispatchedAt: isoTimestampSchema,
    }),
]);

const eventFeedItemProjectionSchema = z.object({
    eventId: nonEmptyStringSchema,
    eventType: z.enum(platformEventTypes),
    occurredAt: isoTimestampSchema,
    source: z.enum(platformEventSources),
    deviceId: nonEmptyStringSchema.optional(),
    commandId: nonEmptyStringSchema.optional(),
    summary: nonEmptyStringSchema,
});

export const roomSnapshotProjectionSchema = z
    .object({
        roomName: nonEmptyStringSchema,
        updatedAt: isoTimestampSchema,
        devices: z.array(deviceProjectionSchema),
        activeCommands: z.array(activeCommandProjectionSchema),
        recentEvents: z.array(eventFeedItemProjectionSchema),
    })
    .superRefine((snapshot, context) => {
        const activeCommandByDeviceId = new Map<string, string>();

        for (const [index, command] of snapshot.activeCommands.entries()) {
            if (activeCommandByDeviceId.has(command.deviceId)) {
                context.addIssue({
                    code: 'custom',
                    message: 'A device can have at most one active command.',
                    path: ['activeCommands', index, 'deviceId'],
                });
            }
            activeCommandByDeviceId.set(command.deviceId, command.commandId);
        }

        for (const [index, device] of snapshot.devices.entries()) {
            if (
                device.activeCommandId &&
                activeCommandByDeviceId.get(device.deviceId) !== device.activeCommandId
            ) {
                context.addIssue({
                    code: 'custom',
                    message: 'activeCommandId must reference the device active command.',
                    path: ['devices', index, 'activeCommandId'],
                });
            }
        }
    });

export const roomRealtimeServerMessageSchema = z.object({
    messageType: z.literal('room.snapshot'),
    version: z.literal(1),
    sentAt: isoTimestampSchema,
    payload: roomSnapshotProjectionSchema,
});

export const temperatureScenarioActionSchema = z.enum(temperatureScenarioActions);

export const temperatureScenarioRequestSchema = z.object({
    action: temperatureScenarioActionSchema,
});

export const temperatureScenarioResultSchema = z.object({
    action: temperatureScenarioActionSchema,
    status: z.literal('completed'),
});

const ignoredEventDiagnosticSchema = z.object({
    diagnosticId: nonEmptyStringSchema,
    reason: z.enum(ignoredEventReasons),
    observedAt: isoTimestampSchema,
    eventId: z.string().optional(),
    eventType: z.string().optional(),
    source: z.string().optional(),
    deviceId: z.string().optional(),
    commandId: z.string().optional(),
    occurredAt: isoTimestampSchema.optional(),
});

export const eventProcessingDiagnosticsSnapshotSchema = z.object({
    ignoredEvents: z.array(ignoredEventDiagnosticSchema),
    deduplicationEvictions: z
        .array(
            z.object({
                diagnosticId: nonEmptyStringSchema,
                evictedEventId: nonEmptyStringSchema,
                observedAt: isoTimestampSchema,
            }),
        )
        .optional(),
});
