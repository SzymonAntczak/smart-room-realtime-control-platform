import type {
    PlatformEventEnvelope,
    PlatformEventSource,
    TelemetryReadingRecordedEvent,
    TelemetryReadingRecordedPayload,
} from '../../../../shared/src/events';
import type { DeviceDefinition, RoomProjection, RoomProjector } from '../read-model/room-projection';

export type { DeviceDefinition } from '../read-model/room-projection';

export interface EventProcessorConfig {
    devices: DeviceDefinition[];
    roomProjector: RoomProjector;
}

export type EventProcessorState = RoomProjection;

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
export type IgnoredEventReason = Extract<EventProcessingResult, { status: 'ignored' }>['reason'];

export interface EventProcessor {
    processEvent(event: unknown): EventProcessingResult;
}

export function createEventProcessor({
    devices,
    roomProjector,
}: EventProcessorConfig): EventProcessor {
    const deviceDefinitions = new Map(devices.map((device) => [device.deviceId, device]));
    const seenEventIds = new Set<string>();

    return {
        processEvent(candidateEvent) {
            const ignored = (reason: IgnoredEventReason): EventProcessingResult => ({
                status: 'ignored',
                reason,
                state: roomProjector.getProjection(),
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

            const acceptedEvent: TelemetryReadingRecordedEvent = {
                ...event,
                eventType: 'telemetry.reading.recorded',
                version: 1,
                deviceId: event.deviceId,
                payload: event.payload,
            };

            seenEventIds.add(event.eventId);

            return {
                status: 'accepted',
                state: roomProjector.applyTelemetryReadingRecorded(acceptedEvent),
            };
        },
    };
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
