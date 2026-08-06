import { Type } from '@sinclair/typebox';

import { isoTimestampSchema, nonEmptyStringSchema } from '../validation';

export const temperatureScenarioActions = [
    'pause_telemetry',
    'resume_telemetry',
    'replay_last_reading',
    'emit_invalid_reading',
    'emit_next_reading',
    'reset',
] as const;
export const ledScenarioActions = [
    'confirm_immediately',
    'confirm_delayed',
    'reject_command',
    'omit_confirmation',
    'report_after_timeout',
] as const;
export const deviceScenarioActions = [
    ...temperatureScenarioActions,
    ...ledScenarioActions,
] as const;
export type DeviceScenarioAction = (typeof deviceScenarioActions)[number];
/** @deprecated Use DeviceScenarioAction for device-scoped dev controls. */
export type TemperatureScenarioAction = DeviceScenarioAction;
export interface DeviceScenarioResult {
    readonly action: DeviceScenarioAction;
    readonly status: 'completed';
}
/** @deprecated Use DeviceScenarioResult for device-scoped dev controls. */
export type TemperatureScenarioResult = DeviceScenarioResult;
export interface DeviceScenarioDescriptor {
    readonly action: DeviceScenarioAction;
}
export interface DeviceScenarioList {
    readonly deviceId: string;
    readonly scenarios: readonly DeviceScenarioDescriptor[];
}
export const ignoredEventReasons = [
    'duplicate_event',
    'malformed_event',
    'unsupported_event_type',
    'unknown_device',
    'invalid_payload',
    'device_metric_mismatch',
    'future_dated_report',
] as const;
export type IgnoredEventReason = (typeof ignoredEventReasons)[number];
export interface IgnoredEventDiagnostic {
    diagnosticId: string;
    reason: IgnoredEventReason;
    observedAt: string;
    eventId?: string;
    eventType?: string;
    source?: string;
    deviceId?: string;
    commandId?: string;
    occurredAt?: string;
}
export interface DeduplicationEvictionDiagnostic {
    diagnosticId: string;
    evictedEventId: string;
    observedAt: string;
}
export interface EventProcessingDiagnosticsSnapshot {
    ignoredEvents: IgnoredEventDiagnostic[];
    deduplicationEvictions?: DeduplicationEvictionDiagnostic[];
}
export function isIgnoredEventReason(value: unknown): value is IgnoredEventReason {
    return typeof value === 'string' && ignoredEventReasons.some((reason) => reason === value);
}
export const deviceScenarioActionSchema = Type.Union(
    deviceScenarioActions.map((action) => Type.Literal(action)),
);
export const deviceScenarioRequestSchema = Type.Object({
    action: deviceScenarioActionSchema,
});
export const deviceScenarioParamsSchema = Type.Object({ deviceId: nonEmptyStringSchema });
export const deviceScenarioDescriptorSchema = Type.Object({
    action: deviceScenarioActionSchema,
});
export const deviceScenarioListSchema = Type.Object({
    deviceId: nonEmptyStringSchema,
    scenarios: Type.Array(deviceScenarioDescriptorSchema),
});
export const deviceScenarioResultSchema = Type.Object({
    action: deviceScenarioActionSchema,
    status: Type.Literal('completed'),
});
/** @deprecated Use deviceScenarioRequestSchema. */
export const temperatureScenarioRequestSchema = deviceScenarioRequestSchema;
/** @deprecated Use deviceScenarioResultSchema. */
export const temperatureScenarioResultSchema = deviceScenarioResultSchema;
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
