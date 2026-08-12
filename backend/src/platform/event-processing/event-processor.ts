import type { IgnoredEventReason } from '@smart-room/contracts/development';
import {
    type CommandDispatchedEvent,
    commandDispatchedEventSchema,
    type CommandFailedEvent,
    commandFailedEventSchema,
    type CommandRequestedEvent,
    commandRequestedEventSchema,
    type CommandTimedOutEvent,
    commandTimedOutEventSchema,
    type DeviceAvailabilityChangedEvent,
    deviceAvailabilityChangedEventSchema,
    type DeviceHealthChangedEvent,
    deviceHealthChangedEventSchema,
    type DeviceStateReportedEvent,
    deviceStateReportedEventSchema,
    platformEventCandidateSchema,
    type TelemetryReadingRecordedEvent,
    telemetryReadingRecordedEventSchema,
} from '@smart-room/contracts/events';
import { isSchema, normalizeIsoTimestamp } from '@smart-room/contracts/validation';

import {
    type DeviceDefinition,
    InvalidLifecycleTransitionError,
    type RoomProjection,
    type RoomProjector,
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
              | 'unknown_device'
              | 'invalid_payload'
              | 'invalid_lifecycle_transition'
              | 'device_metric_mismatch'
              | 'future_dated_report'
              | 'stale_device_transition';
          state: EventProcessorState;
      };
export type { IgnoredEventReason } from '@smart-room/contracts/development';

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

            if (!event.deviceId) {
                return ignored('unknown_device');
            }

            const device = deviceDefinitions.get(event.deviceId);

            if (!device) {
                return ignored('unknown_device');
            }

            if (event.eventType === 'device.state.reported') {
                if (!isSchema(deviceStateReportedEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                if (device.role !== 'led-output') {
                    return ignored('device_metric_mismatch');
                }

                return acceptObservationEvent(event as DeviceStateReportedEvent, (acceptedEvent) =>
                    roomProjector.applyDeviceStateReported(acceptedEvent, {
                        evaluatedAt: deduplicationCheck.checkedAt,
                    }),
                );
            }

            if (event.eventType === 'device.availability.changed') {
                if (!isSchema(deviceAvailabilityChangedEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                if (
                    isStaleTransition(
                        event.occurredAt,
                        event.deviceId,
                        'availabilityChangedAt',
                        !roomProjector.hasAvailabilityEvidence(event.deviceId),
                    )
                ) {
                    return ignored('stale_device_transition');
                }

                return acceptEvent(
                    event as DeviceAvailabilityChangedEvent,
                    (acceptedEvent) => roomProjector.applyDeviceAvailabilityChanged(acceptedEvent),
                );
            }

            if (event.eventType === 'device.health.changed') {
                if (!isSchema(deviceHealthChangedEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                if (
                    isStaleTransition(
                        event.occurredAt,
                        event.deviceId,
                        'healthChangedAt',
                        !roomProjector.hasHealthEvidence(event.deviceId),
                    )
                ) {
                    return ignored('stale_device_transition');
                }

                return acceptEvent(event as DeviceHealthChangedEvent, (acceptedEvent) =>
                    roomProjector.applyDeviceHealthChanged(acceptedEvent),
                );
            }

            if (event.eventType === 'telemetry.reading.recorded') {
                if (!isSchema(telemetryReadingRecordedEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                if (device.role !== 'temperature-sensor') {
                    return ignored('device_metric_mismatch');
                }

                return acceptObservationEvent(event as TelemetryReadingRecordedEvent, (acceptedEvent) =>
                    roomProjector.applyTelemetryReadingRecorded(acceptedEvent, {
                        evaluatedAt: deduplicationCheck.checkedAt,
                    }),
                );
            }

            if (event.eventType === 'command.requested') {
                if (!isSchema(commandRequestedEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                return acceptLifecycleEvent(event as CommandRequestedEvent, (acceptedEvent) =>
                    roomProjector.applyCommandRequested(acceptedEvent),
                );
            }

            if (event.eventType === 'command.dispatched') {
                if (!isSchema(commandDispatchedEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                return acceptLifecycleEvent(event as CommandDispatchedEvent, (acceptedEvent) =>
                    roomProjector.applyCommandDispatched(acceptedEvent),
                );
            }

            if (event.eventType === 'command.failed') {
                if (!isSchema(commandFailedEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                return acceptLifecycleEvent(event as CommandFailedEvent, (acceptedEvent) =>
                    roomProjector.applyCommandFailed(acceptedEvent),
                );
            }

            if (event.eventType === 'command.timed_out') {
                if (!isSchema(commandTimedOutEventSchema, event)) {
                    return ignored('invalid_payload');
                }

                return acceptLifecycleEvent(event as CommandTimedOutEvent, (acceptedEvent) =>
                    roomProjector.applyCommandTimedOut(acceptedEvent),
                );
            }

            return ignored('unsupported_event_type');

            function acceptObservationEvent<
                TEvent extends TelemetryReadingRecordedEvent | DeviceStateReportedEvent,
            >(
                acceptedEvent: TEvent,
                apply: (event: TEvent) => EventProcessorState,
            ): EventProcessingResult {
                if (
                    isFutureDatedBeyondTolerance(
                        acceptedEvent.occurredAt,
                        deduplicationCheck.checkedAt,
                        maxFutureReportSkewMs,
                    )
                ) {
                    return ignored('future_dated_report');
                }

                return acceptEvent(acceptedEvent, apply);
            }

            function isStaleTransition(
                occurredAt: string,
                deviceId: string,
                timestampField: 'availabilityChangedAt' | 'healthChangedAt',
                allowEqualBootstrap: boolean,
            ): boolean {
                const projectedDevice = roomProjector
                    .getProjection()
                    .devices.find((candidate) => candidate.deviceId === deviceId);

                return (
                    projectedDevice !== undefined &&
                    (allowEqualBootstrap
                        ? Date.parse(occurredAt) < Date.parse(projectedDevice[timestampField])
                        : Date.parse(occurredAt) <= Date.parse(projectedDevice[timestampField]))
                );
            }

            function acceptLifecycleEvent<
                TEvent extends
                    | CommandRequestedEvent
                    | CommandDispatchedEvent
                    | CommandFailedEvent
                    | CommandTimedOutEvent,
            >(
                acceptedEvent: TEvent,
                apply: (event: TEvent) => EventProcessorState,
            ): EventProcessingResult {
                try {
                    return acceptEvent(acceptedEvent, apply);
                } catch (error) {
                    if (error instanceof InvalidLifecycleTransitionError) {
                        return ignored('invalid_lifecycle_transition');
                    }

                    throw error;
                }
            }

            function acceptEvent<
                TEvent extends
                    | TelemetryReadingRecordedEvent
                    | DeviceStateReportedEvent
                    | DeviceAvailabilityChangedEvent
                    | DeviceHealthChangedEvent
                    | CommandRequestedEvent
                    | CommandDispatchedEvent
                    | CommandFailedEvent
                    | CommandTimedOutEvent,
            >(
                acceptedEvent: TEvent,
                apply: (event: TEvent) => EventProcessorState,
            ): EventProcessingResult {
                const state = apply(acceptedEvent);
                const deduplicationEvictedEventIds = deduplicator.remember(acceptedEvent.eventId);

                return {
                    status: 'accepted',
                    evaluatedAt: deduplicationCheck.checkedAt,
                    state,
                    ...(deduplicationEvictedEventIds.length > 0
                        ? { deduplicationEvictedEventIds }
                        : {}),
                };
            }
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
