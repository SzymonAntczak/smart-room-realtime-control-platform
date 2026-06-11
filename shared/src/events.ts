import type { CommandRequestedBy, CommandType } from './commands';
import type { DeviceHealth, DeviceState } from './devices';

export type PlatformEventType =
    | 'device.state.reported'
    | 'device.health.changed'
    | 'telemetry.reading.recorded'
    | 'command.requested'
    | 'command.dispatched'
    | 'command.confirmed'
    | 'command.failed'
    | 'command.timed_out';

export type PlatformEventSource = 'simulator-adapter' | 'hardware-adapter' | 'backend';

export type PlatformEventVersion = 1;

export type TelemetryMetric = 'temperature';

export type TemperatureUnit = 'celsius';

export interface PlatformEventEnvelope<
    TEventType extends PlatformEventType = PlatformEventType,
    TPayload = unknown,
> {
    eventId: string;
    eventType: TEventType;
    version: PlatformEventVersion;
    occurredAt: string;
    source: PlatformEventSource;
    deviceId?: string;
    commandId?: string;
    payload: TPayload;
}

export interface DeviceStateReportedPayload {
    reportedState: DeviceState;
    reportedAt: string;
}

export interface DeviceHealthChangedPayload {
    previousHealth: DeviceHealth;
    health: DeviceHealth;
    reason: string;
}

export interface TelemetryReadingRecordedPayload {
    metric: TelemetryMetric;
    value: number;
    unit: TemperatureUnit;
}

export interface CommandRequestedPayload {
    commandType: CommandType;
    requestedState: DeviceState;
    requestedBy: CommandRequestedBy;
}

export interface CommandDispatchedPayload {
    commandType: CommandType;
    target: PlatformEventSource;
}

export interface CommandConfirmedPayload {
    confirmationSource: PlatformEventType;
    matchedState: DeviceState;
}

export interface CommandFailedPayload {
    reason: string;
    message: string;
}

export interface CommandTimedOutPayload {
    timeoutMs: number;
    reason: string;
}

export type DeviceStateReportedEvent = PlatformEventEnvelope<
    'device.state.reported',
    DeviceStateReportedPayload
> & {
    deviceId: string;
};

export type DeviceHealthChangedEvent = PlatformEventEnvelope<
    'device.health.changed',
    DeviceHealthChangedPayload
> & {
    deviceId: string;
};

export type TelemetryReadingRecordedEvent = PlatformEventEnvelope<
    'telemetry.reading.recorded',
    TelemetryReadingRecordedPayload
> & {
    deviceId: string;
};

export type CommandRequestedEvent = PlatformEventEnvelope<
    'command.requested',
    CommandRequestedPayload
> & {
    commandId: string;
};

export type CommandDispatchedEvent = PlatformEventEnvelope<
    'command.dispatched',
    CommandDispatchedPayload
> & {
    commandId: string;
};

export type CommandConfirmedEvent = PlatformEventEnvelope<
    'command.confirmed',
    CommandConfirmedPayload
> & {
    commandId: string;
};

export type CommandFailedEvent = PlatformEventEnvelope<'command.failed', CommandFailedPayload> & {
    commandId: string;
};

export type CommandTimedOutEvent = PlatformEventEnvelope<
    'command.timed_out',
    CommandTimedOutPayload
> & {
    commandId: string;
};

export type PlatformEvent =
    | DeviceStateReportedEvent
    | DeviceHealthChangedEvent
    | TelemetryReadingRecordedEvent
    | CommandRequestedEvent
    | CommandDispatchedEvent
    | CommandConfirmedEvent
    | CommandFailedEvent
    | CommandTimedOutEvent;
