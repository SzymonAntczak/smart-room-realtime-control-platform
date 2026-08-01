import {
    type IgnoredEventReason,
    platformEventCandidateSchema,
    type TelemetryReadingRecordedEvent,
    telemetryReadingRecordedEventSchema,
} from '@smart-room/contracts';

import type {
    DeviceDefinition,
    RoomProjection,
    RoomProjector,
} from '../read-model/room-projection';

import { createEventDeduplicator, type EventDeduplicationClock } from './event-deduplicator';

export type { DeviceDefinition } from '../read-model/room-projection';

export interface EventProcessorConfig {
    devices: DeviceDefinition[];
    roomProjector: RoomProjector;
    clock?: EventDeduplicationClock;
    deduplicationRetentionMs?: number;
    deduplicationEntryLimit?: number;
}

export type EventProcessorState = RoomProjection;

export type EventProcessingResult =
    | {
          status: 'accepted';
          state: EventProcessorState;
          deduplicationEvictedEventIds?: string[];
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
export type { IgnoredEventReason } from '@smart-room/contracts';

export interface EventProcessor {
    processEvent(event: unknown): EventProcessingResult;
}

export function createEventProcessor({
    devices,
    roomProjector,
    clock = realClock,
    deduplicationRetentionMs,
    deduplicationEntryLimit,
}: EventProcessorConfig): EventProcessor {
    const deviceDefinitions = new Map(devices.map((device) => [device.deviceId, device]));
    const deduplicator = createEventDeduplicator({
        clock,
        retentionMs: deduplicationRetentionMs,
        entryLimit: deduplicationEntryLimit,
    });

    return {
        processEvent(candidateEvent) {
            const ignored = (reason: IgnoredEventReason): EventProcessingResult => ({
                status: 'ignored',
                reason,
                state: roomProjector.getProjection(),
            });

            const parsedCandidate = platformEventCandidateSchema.safeParse(candidateEvent);

            if (!parsedCandidate.success) {
                return ignored('malformed_event');
            }

            const event = parsedCandidate.data;

            if (deduplicator.has(event.eventId)) {
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

            const parsedEvent = telemetryReadingRecordedEventSchema.safeParse(event);

            if (!parsedEvent.success) {
                return ignored('invalid_payload');
            }

            if (device.role !== 'temperature-sensor') {
                return ignored('device_metric_mismatch');
            }

            const acceptedEvent: TelemetryReadingRecordedEvent = parsedEvent.data;

            const deduplicationEvictedEventIds = deduplicator.remember(event.eventId);

            return {
                status: 'accepted',
                state: roomProjector.applyTelemetryReadingRecorded(acceptedEvent),
                ...(deduplicationEvictedEventIds.length > 0
                    ? { deduplicationEvictedEventIds }
                    : {}),
            };
        },
    };
}

const realClock: EventDeduplicationClock = {
    now() {
        return new Date().toISOString();
    },
};
