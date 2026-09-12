import { Type } from '@sinclair/typebox';

import type { IgnoredEventReason } from './diagnostics';
import { ignoredEventReasonSchema } from './diagnostics';
import { isoTimestampSchema, nonEmptyStringSchema } from './validation';

export { ignoredEventReasons, isIgnoredEventReason } from './diagnostics';
export type { IgnoredEventReason } from './diagnostics';

export const deviceConnectionScenarioActions = ['disconnect_device', 'reconnect_device'] as const;
export const deviceHealthScenarioActions = ['degrade_device', 'recover_device'] as const;
export const temperatureScenarioActions = [
    'pause_telemetry',
    'resume_telemetry',
    'replay_last_reading',
    'emit_invalid_reading',
    'emit_next_reading',
    'emit_future_dated_reading',
    'reset',
    ...deviceConnectionScenarioActions,
    ...deviceHealthScenarioActions,
] as const;
export const ledScenarioActions = [
    'confirm_immediately',
    'confirm_delayed',
    'reject_command',
    'omit_confirmation',
    'report_after_timeout',
    ...deviceConnectionScenarioActions,
    ...deviceHealthScenarioActions,
] as const;
export const deviceScenarioActions = [
    ...temperatureScenarioActions,
    ...ledScenarioActions,
] as const;
export type DeviceScenarioAction = (typeof deviceScenarioActions)[number];
export interface DeviceScenarioResult {
    readonly action: DeviceScenarioAction;
    readonly status: 'completed';
}
export interface DeviceScenarioDescriptor {
    readonly action: DeviceScenarioAction;
}
export interface DeviceScenarioList {
    readonly deviceId: string;
    readonly scenarios: readonly DeviceScenarioDescriptor[];
}
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

export const deviceScenarioActionSchema = Type.Union(
    deviceScenarioActions.map((action) => Type.Literal(action)),
);
export const deviceScenarioRequestSchema = Type.Object(
    {
        action: deviceScenarioActionSchema,
    },
    { additionalProperties: false },
);
export const deviceScenarioParamsSchema = Type.Object(
    { deviceId: nonEmptyStringSchema },
    { additionalProperties: false },
);
export const deviceScenarioDescriptorSchema = Type.Object(
    {
        action: deviceScenarioActionSchema,
    },
    { additionalProperties: false },
);
export const deviceScenarioListSchema = Type.Object(
    {
        deviceId: nonEmptyStringSchema,
        scenarios: Type.Array(deviceScenarioDescriptorSchema),
    },
    { additionalProperties: false },
);
export const deviceScenarioResultSchema = Type.Object(
    {
        action: deviceScenarioActionSchema,
        status: Type.Literal('completed'),
    },
    { additionalProperties: false },
);
export const apiErrorResponseSchema = Type.Object(
    {
        error: nonEmptyStringSchema,
        message: nonEmptyStringSchema,
    },
    { additionalProperties: false },
);
const ignoredEventDiagnosticSchema = Type.Object(
    {
        diagnosticId: nonEmptyStringSchema,
        reason: ignoredEventReasonSchema,
        observedAt: isoTimestampSchema,
        eventId: Type.Optional(Type.String()),
        eventType: Type.Optional(Type.String()),
        source: Type.Optional(Type.String()),
        deviceId: Type.Optional(Type.String()),
        commandId: Type.Optional(Type.String()),
        occurredAt: Type.Optional(isoTimestampSchema),
    },
    { additionalProperties: false },
);
export const eventProcessingDiagnosticsSnapshotSchema = Type.Object(
    {
        ignoredEvents: Type.Array(ignoredEventDiagnosticSchema),
        deduplicationEvictions: Type.Optional(
            Type.Array(
                Type.Object(
                    {
                        diagnosticId: nonEmptyStringSchema,
                        evictedEventId: nonEmptyStringSchema,
                        observedAt: isoTimestampSchema,
                    },
                    { additionalProperties: false },
                ),
            ),
        ),
    },
    { additionalProperties: false },
);
