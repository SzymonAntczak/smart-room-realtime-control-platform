import type { CommandProjection } from '../../../shared/src/commands';
import type { DeviceRole, DeviceState } from '../../../shared/src/devices';
import type { DeviceProjection, EventFeedItemProjection } from '../../../shared/src/projections';
import type {
    PlatformEventEnvelope,
    PlatformEventSource,
    PlatformEventType,
    TelemetryReadingRecordedPayload,
} from '../../../shared/src/events';

export interface DeviceDefinition {
    deviceId: string;
    name: string;
    role: DeviceRole;
}

export interface EventProcessorConfig {
    devices: DeviceDefinition[];
    initialUpdatedAt: string;
}

export interface EventProcessorState {
    updatedAt: string;
    devices: DeviceProjection[];
    activeCommands: CommandProjection[];
    recentEvents: EventFeedItemProjection[];
}

export type EventProcessingResult =
    | {
          status: 'accepted';
          state: EventProcessorState;
      }
    | {
          status: 'ignored';
          reason:
              | 'duplicate_event'
              | 'malformed_event'
              | 'unsupported_event_type'
              | 'unsupported_event_version'
              | 'unknown_device'
              | 'invalid_payload'
              | 'device_metric_mismatch';
          state: EventProcessorState;
      };
type IgnoredEventReason = Extract<EventProcessingResult, { status: 'ignored' }>['reason'];

export interface EventProcessor {
    processEvent(event: unknown): EventProcessingResult;
    getState(): EventProcessorState;
}

export function createEventProcessor({
    devices,
    initialUpdatedAt,
}: EventProcessorConfig): EventProcessor {
    const deviceDefinitions = new Map(devices.map((device) => [device.deviceId, device]));
    const deviceProjections = new Map<string, DeviceProjection>();
    const recentEvents: EventFeedItemProjection[] = [];
    const seenEventIds = new Set<string>();
    let updatedAt = initialUpdatedAt;

    return {
        processEvent(candidateEvent) {
            const ignored = (reason: IgnoredEventReason): EventProcessingResult => ({
                status: 'ignored',
                reason,
                state: buildState(),
            });

            if (!isPlatformEventEnvelope(candidateEvent)) {
                return ignored('malformed_event');
            }

            const event = candidateEvent;

            if (seenEventIds.has(event.eventId)) {
                return ignored('duplicate_event');
            }

            if (event.version !== 1) {
                return ignored('unsupported_event_version');
            }

            if (event.eventType !== 'telemetry.reading.recorded') {
                return ignored('unsupported_event_type');
            }

            if (!event.deviceId) {
                return ignored('unknown_device');
            }

            const device = deviceDefinitions.get(event.deviceId);

            if (!device) {
                return ignored('unknown_device');
            }

            if (!isTemperatureReadingPayload(event.payload)) {
                return ignored('invalid_payload');
            }

            if (device.role !== 'temperature-sensor') {
                return ignored('device_metric_mismatch');
            }

            seenEventIds.add(event.eventId);
            updatedAt = event.occurredAt;
            deviceProjections.set(device.deviceId, {
                deviceId: device.deviceId,
                name: device.name,
                role: device.role,
                health: 'online',
                reportedState: toTemperatureReportedState(event.payload),
                commandAvailability: {
                    policy: 'block',
                    reason: 'read_only_device',
                },
                lastSeenAt: event.occurredAt,
            });
            recentEvents.unshift(toEventFeedItem(event));

            return {
                status: 'accepted',
                state: buildState(),
            };
        },
        getState() {
            return buildState();
        },
    };

    function buildState(): EventProcessorState {
        return {
            updatedAt,
            devices: [...deviceProjections.values()],
            activeCommands: [],
            recentEvents: [...recentEvents],
        };
    }
}

function isPlatformEventEnvelope(value: unknown): value is PlatformEventEnvelope {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.eventId === 'string' &&
        value.eventId.length > 0 &&
        typeof value.eventType === 'string' &&
        typeof value.version === 'number' &&
        typeof value.occurredAt === 'string' &&
        Date.parse(value.occurredAt) >= 0 &&
        isPlatformEventSource(value.source) &&
        'payload' in value &&
        (value.deviceId === undefined || typeof value.deviceId === 'string') &&
        (value.commandId === undefined || typeof value.commandId === 'string')
    );
}

function isPlatformEventSource(value: unknown): value is PlatformEventSource {
    return value === 'simulator-adapter' || value === 'hardware-adapter' || value === 'backend';
}

function isTemperatureReadingPayload(payload: unknown): payload is TelemetryReadingRecordedPayload {
    if (!isRecord(payload)) {
        return false;
    }

    return (
        payload.metric === 'temperature' &&
        Number.isFinite(payload.value) &&
        payload.unit === 'celsius'
    );
}

function toTemperatureReportedState(payload: TelemetryReadingRecordedPayload): DeviceState {
    return {
        temperature: payload.value,
        temperatureUnit: payload.unit,
    };
}

function toEventFeedItem(event: PlatformEventEnvelope<PlatformEventType>): EventFeedItemProjection {
    return {
        eventId: event.eventId,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        source: event.source,
        deviceId: event.deviceId,
        commandId: event.commandId,
        summary: 'Temperature reading recorded',
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
