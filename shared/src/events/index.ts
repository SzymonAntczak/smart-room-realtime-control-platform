import { Type } from '@sinclair/typebox';

import { commandRequestedByValues, powerStateProjectionSchema } from '../commands';
import { deviceHealthStates } from '../devices';
import { isoTimestampSchema, nonEmptyStringSchema } from '../validation';

export const platformEventSources = ['simulator-adapter', 'hardware-adapter', 'backend'] as const;
export type PlatformEventSource = (typeof platformEventSources)[number];
export interface PlatformEventEnvelope<TEventType extends string = string, TPayload = unknown> {
    eventId: string;
    eventType: TEventType;
    occurredAt: string;
    source: PlatformEventSource;
    payload: TPayload;
    deviceId?: string;
    commandId?: string;
}
export interface DeviceStateReportedPayload {
    reportedState: Record<string, string | number | boolean>;
    reportedAt: string;
}
export interface DeviceHealthChangedPayload {
    previousHealth: (typeof deviceHealthStates)[number];
    health: (typeof deviceHealthStates)[number];
    reason: string;
}
export interface TelemetryReadingRecordedPayload {
    metric: 'temperature';
    value: number;
    unit: 'celsius';
}
export interface CommandRequestedPayload {
    commandType: 'set.power';
    requestedState: { power: 'on' | 'off' };
    requestedBy: (typeof commandRequestedByValues)[number];
}
export interface CommandDispatchedPayload {
    commandType: 'set.power';
    target: PlatformEventSource;
}
export interface CommandConfirmedPayload {
    confirmationSource: 'device.state.reported';
    matchedState: { power: 'on' | 'off' };
}
export interface CommandFailedPayload {
    reason: string;
    message: string;
    commandType?: 'set.power';
    requestedState?: { power: 'on' | 'off' };
    requestedAt?: string;
}
export interface CommandTimedOutPayload {
    timeoutMs: number;
    reason: string;
}
export type DeviceStateReportedEvent = PlatformEventEnvelope<
    'device.state.reported',
    DeviceStateReportedPayload
> & { deviceId: string };
export type DeviceHealthChangedEvent = PlatformEventEnvelope<
    'device.health.changed',
    DeviceHealthChangedPayload
> & { deviceId: string };
export type TelemetryReadingRecordedEvent = PlatformEventEnvelope<
    'telemetry.reading.recorded',
    TelemetryReadingRecordedPayload
> & { deviceId: string };
export type CommandRequestedEvent = PlatformEventEnvelope<
    'command.requested',
    CommandRequestedPayload
> & { deviceId: string; commandId: string };
export type CommandDispatchedEvent = PlatformEventEnvelope<
    'command.dispatched',
    CommandDispatchedPayload
> & { deviceId: string; commandId: string };
export type CommandConfirmedEvent = PlatformEventEnvelope<
    'command.confirmed',
    CommandConfirmedPayload
> & { deviceId: string; commandId: string };
export type CommandFailedEvent = PlatformEventEnvelope<'command.failed', CommandFailedPayload> & {
    deviceId: string;
    commandId: string;
};
export type CommandTimedOutEvent = PlatformEventEnvelope<
    'command.timed_out',
    CommandTimedOutPayload
> & { deviceId: string; commandId: string };
export type PlatformEvent =
    | DeviceStateReportedEvent
    | DeviceHealthChangedEvent
    | TelemetryReadingRecordedEvent
    | CommandRequestedEvent
    | CommandDispatchedEvent
    | CommandConfirmedEvent
    | CommandFailedEvent
    | CommandTimedOutEvent;

const deviceStateSchema = Type.Record(
    Type.String(),
    Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
);
export const platformEventCandidateSchema = Type.Object({
    eventId: nonEmptyStringSchema,
    eventType: Type.String(),
    occurredAt: isoTimestampSchema,
    source: Type.Union(platformEventSources.map((source) => Type.Literal(source))),
    deviceId: Type.Optional(nonEmptyStringSchema),
    commandId: Type.Optional(nonEmptyStringSchema),
    payload: Type.Unknown(),
});
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
    requestedBy: Type.Union(commandRequestedByValues.map((value) => Type.Literal(value))),
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
    commandType: Type.Optional(Type.Literal('set.power')),
    requestedState: Type.Optional(powerStateProjectionSchema),
    requestedAt: Type.Optional(isoTimestampSchema),
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
