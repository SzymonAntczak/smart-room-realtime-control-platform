import {
    type IgnoredEventReason,
    isSchema,
    normalizeIsoTimestamp,
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
    maxFutureReportSkewMs?: number;
}

export type EventProcessorState = RoomProjection;

export type EventProcessingResult =
    | {
          status: 'accepted';
          state: EventProcessorState;
          evaluatedAt: string;
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
              | 'device_metric_mismatch'
              | 'future_dated_report';
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
    maxFutureReportSkewMs = defaultMaxFutureReportSkewMs,
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

            const event = normalizeEventTimestamps(candidateEvent);

            if (!isSchema(platformEventCandidateSchema, event)) {
                return ignored('malformed_event');
            }

            const deduplicationCheck = deduplicator.check(event.eventId);

            if (deduplicationCheck.isDuplicate) {
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

            if (!isSchema(telemetryReadingRecordedEventSchema, event)) {
                return ignored('invalid_payload');
            }

            if (device.role !== 'temperature-sensor') {
                return ignored('device_metric_mismatch');
            }

            const acceptedEvent = event as TelemetryReadingRecordedEvent;

            if (
                isFutureDatedBeyondTolerance(
                    acceptedEvent.occurredAt,
                    deduplicationCheck.checkedAt,
                    maxFutureReportSkewMs,
                )
            ) {
                return ignored('future_dated_report');
            }

            const deduplicationEvictedEventIds = deduplicator.remember(event.eventId);

            return {
                status: 'accepted',
                evaluatedAt: deduplicationCheck.checkedAt,
                state: roomProjector.applyTelemetryReadingRecorded(acceptedEvent, {
                    evaluatedAt: deduplicationCheck.checkedAt,
                }),
                ...(deduplicationEvictedEventIds.length > 0
                    ? { deduplicationEvictedEventIds }
                    : {}),
            };
        },
    };
}

function normalizeEventTimestamps(event: unknown): unknown {
    if (!isRecord(event)) {
        return event;
    }

    const occurredAt = normalizeIsoTimestamp(event.occurredAt);
    const payload = normalizeReportedAt(event.payload);

    return {
        ...event,
        ...(occurredAt ? { occurredAt } : {}),
        ...(payload ? { payload } : {}),
    };
}

function normalizeReportedAt(payload: unknown): Record<string, unknown> | undefined {
    if (!isRecord(payload)) {
        return undefined;
    }

    const reportedAt = normalizeIsoTimestamp(payload.reportedAt);

    return reportedAt ? { ...payload, reportedAt } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

const realClock: EventDeduplicationClock = {
    now() {
        return new Date().toISOString();
    },
};

export const defaultMaxFutureReportSkewMs = 1_000;

function isFutureDatedBeyondTolerance(
    occurredAt: string,
    backendNow: string,
    maxFutureReportSkewMs: number,
): boolean {
    return Date.parse(occurredAt) - Date.parse(backendNow) > maxFutureReportSkewMs;
}
