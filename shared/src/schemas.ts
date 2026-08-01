import { z } from 'zod';

import { ignoredEventReasons } from './dev-diagnostics';
import { temperatureScenarioActions } from './dev-scenarios';
import { commandAvailabilityPolicies, deviceHealthStates, deviceRoles } from './devices';
import { platformEventSources, platformEventTypes } from './events';

const deviceStateValueSchema = z.union([z.string(), z.number(), z.boolean()]);
const deviceStateSchema = z.record(z.string(), deviceStateValueSchema);
const isoTimestampSchema = z
    .string()
    .refine(
        (value) =>
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
            !Number.isNaN(Date.parse(value)),
        {
            message: 'Expected an ISO UTC timestamp.',
        },
    );

export const platformEventEnvelopeSchema = z.object({
    eventId: z.string().min(1),
    eventType: z.string(),
    version: z.number(),
    occurredAt: z.string().refine((value) => Date.parse(value) >= 0, {
        message: 'Expected a valid timestamp string.',
    }),
    source: z.enum(platformEventSources),
    deviceId: z.string().optional(),
    commandId: z.string().optional(),
    payload: z.unknown(),
});

export const telemetryReadingRecordedPayloadSchema = z.object({
    metric: z.literal('temperature'),
    value: z.number().finite(),
    unit: z.literal('celsius'),
});

const commandAvailabilitySchema = z.object({
    policy: z.enum(commandAvailabilityPolicies),
    reason: z.string().optional(),
});

const deviceProjectionSchema = z.object({
    deviceId: z.string(),
    name: z.string(),
    role: z.enum(deviceRoles),
    health: z.enum(deviceHealthStates),
    reportedState: deviceStateSchema,
    requestedState: deviceStateSchema.optional(),
    commandAvailability: commandAvailabilitySchema,
    lastSeenAt: z.string().optional(),
    warning: z.string().optional(),
    activeCommandId: z.string().optional(),
});

const commandProjectionSchema = z.object({
    commandId: z.string(),
    deviceId: z.string(),
    commandType: z.literal('set.power'),
    status: z.enum(['idle', 'pending', 'confirmed', 'failed', 'timed_out']),
    requestedState: deviceStateSchema,
    requestedAt: z.string(),
    dispatchedAt: z.string().optional(),
    confirmedAt: z.string().optional(),
    failedAt: z.string().optional(),
    timedOutAt: z.string().optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
});

const eventFeedItemProjectionSchema = z.object({
    eventId: z.string(),
    eventType: z.enum(platformEventTypes),
    occurredAt: z.string(),
    source: z.enum(platformEventSources),
    deviceId: z.string().optional(),
    commandId: z.string().optional(),
    summary: z.string(),
});

export const roomSnapshotProjectionSchema = z.object({
    roomName: z.string(),
    updatedAt: z.string(),
    devices: z.array(deviceProjectionSchema),
    activeCommands: z.array(commandProjectionSchema),
    recentEvents: z.array(eventFeedItemProjectionSchema),
});

export const roomRealtimeServerMessageSchema = z.object({
    messageType: z.literal('room.snapshot'),
    version: z.literal(1),
    sentAt: z.string(),
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
    diagnosticId: z.string(),
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
                diagnosticId: z.string(),
                evictedEventId: z.string(),
                observedAt: z.string(),
            }),
        )
        .optional(),
});
