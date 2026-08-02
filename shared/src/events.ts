import type { CommandRequestedBy } from './commands';
import type { DeviceHealth, DeviceState, PowerState } from './devices';

export const platformEventTypes = [
    'device.state.reported',
    'device.health.changed',
    'telemetry.reading.recorded',
    'command.requested',
    'command.dispatched',
    'command.confirmed',
    'command.failed',
    'command.timed_out',
] as const;

export type PlatformEventType = (typeof platformEventTypes)[number];

export const platformEventSources = ['simulator-adapter', 'hardware-adapter', 'backend'] as const;

export type PlatformEventSource = (typeof platformEventSources)[number];

export type TelemetryMetric = 'temperature';

export type TemperatureUnit = 'celsius';

export interface PlatformEventEnvelope<
    TEventType extends PlatformEventType = PlatformEventType,
    TPayload = unknown,
> {
    eventId: string;
    eventType: TEventType;
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
    commandType: 'set.power';
    requestedState: { power: PowerState };
    requestedBy: CommandRequestedBy;
}

export interface CommandDispatchedPayload {
    commandType: 'set.power';
    target: PlatformEventSource;
}

export interface CommandConfirmedPayload {
    confirmationSource: 'device.state.reported';
    matchedState: { power: PowerState };
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
    deviceId: string;
    commandId: string;
};

export type CommandDispatchedEvent = PlatformEventEnvelope<
    'command.dispatched',
    CommandDispatchedPayload
> & {
    deviceId: string;
    commandId: string;
};

export type CommandConfirmedEvent = PlatformEventEnvelope<
    'command.confirmed',
    CommandConfirmedPayload
> & {
    deviceId: string;
    commandId: string;
};

export type CommandFailedEvent = PlatformEventEnvelope<'command.failed', CommandFailedPayload> & {
    deviceId: string;
    commandId: string;
};

export type CommandTimedOutEvent = PlatformEventEnvelope<
    'command.timed_out',
    CommandTimedOutPayload
> & {
    deviceId: string;
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
