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
    type PlatformEvent,
    platformEventCandidateSchema,
    type TelemetryReadingRecordedEvent,
    telemetryReadingRecordedEventSchema,
} from '@smart-room/contracts/events';
import { isSchema, normalizeIsoTimestamp } from '@smart-room/contracts/validation';

import {
    type DeviceDefinition,
    InvalidLifecycleTransitionError,
    materializePreparedTransition,
    type RoomProjection,
    type RoomProjectionEvidence,
    type RoomProjector,
} from '../read-model/room-projection';
import type { AcceptedInputIdentity } from '../storage/room-storage';

import {
    createEventDeduplicator,
    defaultDeduplicationEntryLimit,
    defaultDeduplicationRetentionMs,
    type EventDeduplicationClock,
} from './event-deduplicator';
import { type InputFingerprint, inputFingerprint } from './event-identity';

export type { DeviceDefinition } from '../read-model/room-projection';

export interface EventProcessorConfig {
    devices: DeviceDefinition[];
    roomProjector: RoomProjector;
    clock?: EventDeduplicationClock;
    deduplicationRetentionMs?: number;
    deduplicationEntryLimit?: number;
    maxFutureReportSkewMs?: number;
    acceptedInputIdentities?: readonly AcceptedInputIdentity[];
}

export type EventProcessorState = RoomProjection;

export interface EventIngress {
    receivedAt: string;
    ingestSequence: number;
}

export type PreparedRecord =
    | { kind: 'telemetry'; event: TelemetryReadingRecordedEvent }
    | {
          kind: 'input_significant_fact';
          event: Exclude<PlatformEvent, TelemetryReadingRecordedEvent>;
      }
    | {
          kind: 'derived_command_confirmed';
          eventId: string;
          commandId: string;
          deviceId: string;
          occurredAt: string;
          payload: { sourceEventId: string; confirmedAt: string };
      };

export type PreparedProcessingResult = {
    kind: 'accepted_applied' | 'accepted_non_applying' | 'derived_projection' | 'quarantined';
    result: EventProcessingResult;
    eventId?: string;
    event?: PlatformEvent;
    fingerprint?: InputFingerprint;
    identityDisposition?: 'new' | 'durable_duplicate' | 'volatile_reconciliation';
    candidateState?: EventProcessorState;
    candidateEvidence?: RoomProjectionEvidence;
    reconciledCommandIds?: readonly string[];
    records: readonly PreparedRecord[];
    ingress: EventIngress;
};

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
              | 'stale_device_transition'
              | 'event_identity_conflict';
          state: EventProcessorState;
      };
export type { IgnoredEventReason } from '@smart-room/contracts/development';

export interface EventProcessor {
    processEvent(event: unknown): EventProcessingResult;
    prepareEvent(
        event: unknown,
        ingress: EventIngress,
        storageMode?: 'available' | 'degraded',
    ): PreparedProcessingResult;
    commitPrepared(
        prepared: PreparedProcessingResult,
        durability?: 'durable' | 'volatile',
    ): EventProcessingResult;
    materializePreparedState(
        prepared: PreparedProcessingResult,
        durability: 'durable' | 'volatile',
    ): EventProcessorState;
    rememberDurableIdentity(
        eventId: string,
        fingerprint: InputFingerprint,
        acceptedAt: string,
    ): void;
    rememberVolatileIdentity(
        eventId: string,
        fingerprint: InputFingerprint,
        acceptedAt: string,
    ): void;
    hasDurableIdentity(eventId: string): boolean;
    forgetDurableIdentities(eventIds: readonly string[]): void;
    listVolatileIdentities(): AcceptedInputIdentity[];
}

export function createEventProcessor({
    devices,
    roomProjector,
    clock = realClock,
    deduplicationRetentionMs,
    deduplicationEntryLimit,
    maxFutureReportSkewMs = defaultMaxFutureReportSkewMs,
    acceptedInputIdentities = [],
}: EventProcessorConfig): EventProcessor {
    const deviceDefinitions = new Map(devices.map((device) => [device.deviceId, device]));
    const deduplicator = createEventDeduplicator({
        clock,
        retentionMs: deduplicationRetentionMs,
        entryLimit: deduplicationEntryLimit,
    });
    let activeProjector = roomProjector;
    let activeDeduplicator = deduplicator;
    const identities = new Map(
        acceptedInputIdentities.map((identity) => [identity.eventId, identity]),
    );
    const volatileGuardRetentionMs = deduplicationRetentionMs ?? defaultDeduplicationRetentionMs;
    const volatileGuardEntryLimit = deduplicationEntryLimit ?? defaultDeduplicationEntryLimit;

    function processImmediately(candidateEvent: unknown): EventProcessingResult {
        const ignored = (reason: IgnoredEventReason): EventProcessingResult => ({
            status: 'ignored',
            reason,
            state: activeProjector.getProjection(),
        });

        const event = normalizeEventTimestamps(candidateEvent);

        if (!isSchema(platformEventCandidateSchema, event)) {
            return ignored('malformed_event');
        }

        const deduplicationCheck = activeDeduplicator.check(event.eventId);

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
                activeProjector.applyDeviceStateReported(acceptedEvent, {
                    evaluatedAt: deduplicationCheck.checkedAt,
                    receivedAt: deduplicationCheck.checkedAt,
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
                    !activeProjector.hasAvailabilityEvidence(event.deviceId),
                )
            ) {
                return ignored('stale_device_transition');
            }

            return acceptEvent(event as DeviceAvailabilityChangedEvent, (acceptedEvent) =>
                activeProjector.applyDeviceAvailabilityChanged(acceptedEvent),
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
                    !activeProjector.hasHealthEvidence(event.deviceId),
                )
            ) {
                return ignored('stale_device_transition');
            }

            return acceptEvent(event as DeviceHealthChangedEvent, (acceptedEvent) =>
                activeProjector.applyDeviceHealthChanged(acceptedEvent),
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
                activeProjector.applyTelemetryReadingRecorded(acceptedEvent, {
                    evaluatedAt: deduplicationCheck.checkedAt,
                    receivedAt: deduplicationCheck.checkedAt,
                }),
            );
        }

        if (event.eventType === 'command.requested') {
            if (!isSchema(commandRequestedEventSchema, event)) {
                return ignored('invalid_payload');
            }

            return acceptLifecycleEvent(event as CommandRequestedEvent, (acceptedEvent) =>
                activeProjector.applyCommandRequested(acceptedEvent),
            );
        }

        if (event.eventType === 'command.dispatched') {
            if (!isSchema(commandDispatchedEventSchema, event)) {
                return ignored('invalid_payload');
            }

            return acceptLifecycleEvent(event as CommandDispatchedEvent, (acceptedEvent) =>
                activeProjector.applyCommandDispatched(acceptedEvent),
            );
        }

        if (event.eventType === 'command.failed') {
            if (!isSchema(commandFailedEventSchema, event)) {
                return ignored('invalid_payload');
            }

            return acceptLifecycleEvent(event as CommandFailedEvent, (acceptedEvent) =>
                activeProjector.applyCommandFailed(acceptedEvent),
            );
        }

        if (event.eventType === 'command.timed_out') {
            if (!isSchema(commandTimedOutEventSchema, event)) {
                return ignored('invalid_payload');
            }

            return acceptLifecycleEvent(event as CommandTimedOutEvent, (acceptedEvent) =>
                activeProjector.applyCommandTimedOut(acceptedEvent),
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
            const projectedDevice = activeProjector
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
            const deduplicationEvictedEventIds = activeDeduplicator.remember(acceptedEvent.eventId);

            return {
                status: 'accepted',
                evaluatedAt: deduplicationCheck.checkedAt,
                state,
                ...(deduplicationEvictedEventIds.length > 0
                    ? { deduplicationEvictedEventIds }
                    : {}),
            };
        }
    }

    return {
        processEvent(candidateEvent) {
            const prepared = this.prepareEvent(candidateEvent, {
                receivedAt: normalizeClockTimestamp(clock.now()),
                ingestSequence: 0,
            });

            return this.commitPrepared(prepared);
        },
        prepareEvent(candidateEvent, ingress, storageMode = 'degraded') {
            const originalProjector = activeProjector;
            const originalDeduplicator = activeDeduplicator;
            const candidateProjector = roomProjector.fork();
            activeProjector = candidateProjector;
            activeDeduplicator = createEventDeduplicator({
                clock: { now: () => ingress.receivedAt },
                retentionMs: deduplicationRetentionMs,
                entryLimit: deduplicationEntryLimit,
            });

            let result: EventProcessingResult;
            let existingIdentity: AcceptedInputIdentity | undefined;
            let fingerprint: InputFingerprint | undefined;

            try {
                const normalized = normalizeEventTimestamps(candidateEvent);

                if (isSchema(platformEventCandidateSchema, normalized)) {
                    fingerprint = inputFingerprint(normalized as PlatformEvent);
                    existingIdentity = identityAt(normalized.eventId, ingress.receivedAt);
                    const existing = originalDeduplicator.inspect(normalized.eventId);

                    if (existingIdentity && existingIdentity.fingerprint !== fingerprint) {
                        result = {
                            status: 'ignored',
                            reason: 'event_identity_conflict',
                            state: originalProjector.getProjection(),
                        };
                    } else if (existingIdentity?.durability === 'durable') {
                        result = {
                            status: 'ignored',
                            reason: 'duplicate_event',
                            state: originalProjector.getProjection(),
                        };
                    } else if (
                        storageMode !== 'available' &&
                        (existingIdentity?.durability === 'volatile' ||
                            (existing.isDuplicate && !existingIdentity))
                    ) {
                        result = {
                            status: 'ignored',
                            reason: 'duplicate_event',
                            state: originalProjector.getProjection(),
                        };
                    } else {
                        result = processImmediately(normalized);
                    }
                } else {
                    result = processImmediately(candidateEvent);
                }
            } finally {
                activeProjector = originalProjector;
                activeDeduplicator = originalDeduplicator;
            }

            if (result.status === 'accepted') {
                result = {
                    ...result,
                    state: candidateProjector.getProjection({ evaluatedAt: ingress.receivedAt }),
                };
            }

            const normalized = normalizeEventTimestamps(candidateEvent);
            const identityDisposition =
                existingIdentity?.durability === 'durable'
                    ? 'durable_duplicate'
                    : existingIdentity?.durability === 'volatile'
                      ? 'volatile_reconciliation'
                      : 'new';
            const eventId =
                isSchema(platformEventCandidateSchema, normalized) &&
                (result.status === 'accepted' || result.reason === 'stale_device_transition')
                    ? normalized.eventId
                    : undefined;
            const kind =
                result.status === 'accepted'
                    ? 'accepted_applied'
                    : result.reason === 'stale_device_transition'
                      ? 'accepted_non_applying'
                      : 'quarantined';
            const preparedEvent = isSchema(platformEventCandidateSchema, normalized)
                ? (normalized as PlatformEvent)
                : undefined;
            const candidateEvidence = eventId ? candidateProjector.getEvidence() : undefined;
            const reconciledCommandIds =
                eventId && preparedEvent
                    ? reconciledCommandIdsFor(
                          preparedEvent,
                          originalProjector.getProjection(),
                          candidateEvidence,
                          identityDisposition,
                      )
                    : [];
            const records =
                eventId && preparedEvent
                    ? prepareRecords(
                          preparedEvent,
                          result,
                          originalProjector.getProjection(),
                          reconciledCommandIds,
                      )
                    : [];

            return {
                kind,
                result,
                ...(eventId ? { eventId, candidateState: result.state } : {}),
                ...(candidateEvidence ? { candidateEvidence } : {}),
                ...(preparedEvent ? { event: preparedEvent } : {}),
                ...(fingerprint ? { fingerprint } : {}),
                ...(eventId ? { identityDisposition } : {}),
                ...(reconciledCommandIds.length > 0 ? { reconciledCommandIds } : {}),
                records,
                ingress,
            };
        },
        commitPrepared(prepared, durability = 'durable') {
            pruneVolatileIdentities(prepared.ingress.receivedAt);

            if (
                prepared.kind === 'accepted_applied' &&
                prepared.eventId &&
                prepared.candidateState
            ) {
                roomProjector.installProjection(
                    materializePreparedState(prepared, durability),
                    prepared.ingress.receivedAt,
                    prepared.candidateEvidence,
                );
                const deduplicationEvictedEventIds = deduplicator.remember(prepared.eventId);

                return {
                    ...prepared.result,
                    ...(deduplicationEvictedEventIds.length > 0
                        ? { deduplicationEvictedEventIds }
                        : {}),
                    state: roomProjector.getProjection({
                        evaluatedAt: prepared.ingress.receivedAt,
                    }),
                };
            }

            if (prepared.kind === 'accepted_non_applying' && prepared.eventId) {
                roomProjector.installProjection(
                    materializePreparedState(prepared, durability),
                    prepared.ingress.receivedAt,
                    prepared.candidateEvidence,
                );

                if (prepared.identityDisposition !== 'durable_duplicate') {
                    deduplicator.remember(prepared.eventId);
                }
            }

            return { ...prepared.result, state: roomProjector.getProjection() };
        },
        materializePreparedState,
        rememberDurableIdentity(eventId, fingerprint, acceptedAt) {
            identities.set(eventId, {
                eventId,
                fingerprint,
                durability: 'durable',
                acceptedAt,
            });
        },
        rememberVolatileIdentity(eventId, fingerprint, acceptedAt) {
            pruneVolatileIdentities(acceptedAt);
            identities.set(eventId, {
                eventId,
                fingerprint,
                durability: 'volatile',
                acceptedAt,
            });
            pruneVolatileIdentities(acceptedAt);
        },
        hasDurableIdentity(eventId) {
            return identities.get(eventId)?.durability === 'durable';
        },
        forgetDurableIdentities(eventIds) {
            for (const eventId of eventIds) {
                if (identities.get(eventId)?.durability === 'durable') {
                    identities.delete(eventId);
                }
            }
        },
        listVolatileIdentities() {
            return activeVolatileIdentities(normalizeClockTimestamp(clock.now()));
        },
    };

    function materializePreparedState(
        prepared: PreparedProcessingResult,
        durability: 'durable' | 'volatile',
    ): EventProcessorState {
        if (!prepared.candidateState) {
            return prepared.result.state;
        }

        return materializePreparedTransition(
            roomProjector.getProjection(),
            prepared.candidateState,
            durability,
            durability === 'durable' && prepared.identityDisposition === 'volatile_reconciliation'
                ? prepared.event
                : undefined,
            prepared.reconciledCommandIds,
        );
    }

    function pruneVolatileIdentities(referenceAt: string): void {
        const retained = new Set(
            activeVolatileIdentities(referenceAt).map((identity) => identity.eventId),
        );

        for (const identity of identities.values()) {
            if (identity.durability === 'volatile' && !retained.has(identity.eventId)) {
                identities.delete(identity.eventId);
            }
        }
    }

    function identityAt(eventId: string, referenceAt: string): AcceptedInputIdentity | undefined {
        const identity = identities.get(eventId);

        if (identity?.durability !== 'volatile') {
            return identity;
        }

        return activeVolatileIdentities(referenceAt).find(
            (candidate) => candidate.eventId === eventId,
        );
    }

    function activeVolatileIdentities(referenceAt: string): AcceptedInputIdentity[] {
        const cutoff = Date.parse(referenceAt) - volatileGuardRetentionMs;

        return [...identities.values()]
            .filter(
                (identity) =>
                    identity.durability === 'volatile' && Date.parse(identity.acceptedAt) > cutoff,
            )
            .sort(
                (left, right) =>
                    left.acceptedAt.localeCompare(right.acceptedAt) ||
                    left.eventId.localeCompare(right.eventId),
            )
            .slice(-volatileGuardEntryLimit);
    }
}

function prepareRecords(
    event: PlatformEvent,
    result: EventProcessingResult,
    previousState: EventProcessorState,
    reconciledCommandIds: readonly string[],
): readonly PreparedRecord[] {
    if (result.status !== 'accepted' && result.reason !== 'stale_device_transition') {
        return [];
    }

    const inputRecord: PreparedRecord =
        event.eventType === 'telemetry.reading.recorded'
            ? { kind: 'telemetry', event }
            : { kind: 'input_significant_fact', event };
    const priorTerminalCommandIds = new Set(
        previousState.recentCommands.map((command) => command.commandId),
    );
    const newlyConfirmedCommandIds = result.state.recentCommands
        .filter(
            (
                command,
            ): command is Extract<
                (typeof result.state.recentCommands)[number],
                { status: 'confirmed' }
            > => command.status === 'confirmed' && !priorTerminalCommandIds.has(command.commandId),
        )
        .map((command) => command.commandId);
    const confirmationCommandIds = new Set([...newlyConfirmedCommandIds, ...reconciledCommandIds]);
    const derivedConfirmations = result.state.recentCommands.flatMap((command) =>
        command.status === 'confirmed' && confirmationCommandIds.has(command.commandId)
            ? [
                  {
                      kind: 'derived_command_confirmed' as const,
                      eventId: event.eventId,
                      commandId: command.commandId,
                      deviceId: command.deviceId,
                      occurredAt: command.confirmedAt,
                      payload: { sourceEventId: event.eventId, confirmedAt: command.confirmedAt },
                  },
              ]
            : [],
    );

    return [inputRecord, ...derivedConfirmations];
}

function reconciledCommandIdsFor(
    event: PlatformEvent,
    previousState: EventProcessorState,
    evidence: RoomProjectionEvidence | undefined,
    identityDisposition: PreparedProcessingResult['identityDisposition'],
): string[] {
    if (identityDisposition !== 'volatile_reconciliation') {
        return [];
    }

    const confirmedCommandIds = new Set(
        previousState.recentCommands
            .filter(
                (command) =>
                    command.status === 'confirmed' && command.lifecycleDurability === 'volatile',
            )
            .map((command) => command.commandId),
    );

    return (evidence?.commandConfirmationSources ?? [])
        .filter(
            (source) =>
                source.eventId === event.eventId && confirmedCommandIds.has(source.commandId),
        )
        .map((source) => source.commandId);
}

function normalizeClockTimestamp(value: string): string {
    const normalized = normalizeIsoTimestamp(value);

    if (!normalized) {
        throw new Error('Event processor clock returned an invalid ISO timestamp.');
    }

    return normalized;
}

function normalizeEventTimestamps(event: unknown): unknown {
    if (!isRecord(event)) {
        return event;
    }

    const occurredAt = normalizeIsoTimestamp(event.occurredAt);

    const normalized: Record<string, unknown> = {
        ...event,
        ...(occurredAt ? { occurredAt } : {}),
    };

    const payload = normalized.payload;

    if (
        normalized.eventType !== 'command.failed' ||
        !isRecord(payload) ||
        typeof payload.requestedAt !== 'string'
    ) {
        return normalized;
    }

    const requestedAt = normalizeIsoTimestamp(payload.requestedAt);

    return {
        ...normalized,
        ...(requestedAt ? { payload: { ...payload, requestedAt } } : {}),
    };
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
