import { randomBytes, randomUUID } from 'node:crypto';
import { clearInterval, setInterval, setTimeout } from 'node:timers';

import {
    type AcceptedCommandResponse,
    type PreAdmissionCommandErrorResponse,
    type RejectedCommandResponse,
    type SetPowerCommandRequest,
} from '@smart-room/contracts/commands';
import type { DurableDiagnosticsSnapshot } from '@smart-room/contracts/diagnostics';
import type { CommandFailedEvent, PlatformEvent } from '@smart-room/contracts/events';
import {
    type LiveTelemetrySampleProjection,
    type NormalizedRawTelemetryPageQuery,
    type NormalizedTrendQuery,
    type RawTelemetryPage,
    type RecentEventProjection,
    type SignificantFactPage,
    type SignificantFactPageQuery,
    type TrendResponse,
} from '@smart-room/contracts/history';
import type {
    PlatformStorageProjection,
    RoomSnapshotProjection,
} from '@smart-room/contracts/projections';

import {
    type CommandOutboxMutation,
    type CommandTimer,
    createSetPowerCommandController,
    type SetPowerCommandRoute,
} from '../command-processing/set-power-command-controller';
import { createSetPowerTimeoutEvent } from '../command-processing/set-power-command-policy';
import { createRoomDiagnosticsReader } from '../diagnostics/room-diagnostics-reader';
import {
    createEventProcessingDiagnostics,
    type EventProcessingDiagnosticsSnapshot,
} from '../event-processing/event-processing-diagnostics';
import {
    createEventProcessor,
    type DeviceDefinition,
    type EventIngress,
    type EventProcessingResult,
} from '../event-processing/event-processor';
import { createHistoryCursorCodec } from '../history/room-history-cursor';
import {
    createRoomHistoryReader,
    type PinnedSignificantFactSnapshot,
    type RoomHistoryReadResult,
} from '../history/room-history-reader';
import {
    liveTelemetrySampleForRecord,
    mergeRecentEvents,
    preserveOriginalProcessingEvidence,
    recentEventsForRecords,
} from '../history/room-live-history';
import { createRoomProjector, type RoomProjector } from '../read-model/room-projection';
import { withBootstrapDurability } from '../read-model/room-recovery-policy';
import type {
    AcceptedInputIdentity,
    PinnedHistoryBounds,
    RoomStorage,
    RoomStorageLifecycle,
    RuntimeSession,
    StorageMetadata,
} from '../storage/room-storage';
import { StorageError } from '../storage/storage-errors';

import { commitPreparedEvent } from './room-event-commit';
import { createRoomInputCoordinator } from './room-input-coordinator';
import {
    createRoomPublication,
    type RoomPublicationBatchListener,
    type RoomSnapshotListener,
} from './room-publication';
import { createRoomState } from './room-state';
import {
    attemptStorageRecovery as runStorageRecovery,
    initializeProjectionCheckpoint,
    type RoomStorageRecoveryContext,
} from './room-storage-recovery';
import {
    closeStorage,
    createRoomRuntimeSession,
    createRoomStorageSession,
    isDegradableStorageError,
    isFatalStorageError,
} from './room-storage-session';

export interface RoomEngineConfig {
    roomName?: string;
    snapshotBroadcastIntervalMs?: number;
    clock?: RoomClock;
    timer?: IntervalScheduler;
    generateEventId?: () => string;
    diagnosticEventLimit?: number;
    deduplicationRetentionMs?: number;
    deduplicationEntryLimit?: number;
    commandTimer?: CommandTimer;
    generateCommandId?: () => string;
    storage?: RoomStorage;
    storageLifecycle?: RoomStorageLifecycle;
    storageFactory?: () => RoomStorage;
    recoveryTimer?: IntervalScheduler;
    storageRecoveryProbeIntervalMs?: number;
    storageRecoveryQueueLimit?: number;
    historyCursorSecret?: Uint8Array;
    operationalLog?: (entry: Record<string, unknown>) => void;
    onFatalStorageError?: (error: unknown) => never;
    devices: readonly DeviceDefinition[];
    routes: readonly SetPowerCommandRoute[];
    sources: RoomSourceLifecycle;
}

export interface RoomClock {
    now(): string;
}

export interface IntervalScheduler {
    setInterval(callback: () => void, intervalMs: number): unknown;
    clearInterval(timerHandle: unknown): void;
}

export interface RoomSourceLifecycle {
    startCommandSources(): void;
    startObservationSources(): void;
    startPeriodicSources(): void;
    stopPeriodicSources(): void;
    stop(): void;
}

export interface RoomSourceReceiptFailure {
    commandId: string;
    deviceId: string;
    operation: string;
    outcome: 'inspection_unavailable' | 'confirmed_rolled_back' | 'indeterminate';
    error: unknown;
    source: string;
}

export interface RoomEngine {
    start(): void;
    stop(): void;
    assertHealthy(): void;
    isStarted(): boolean;
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    readDiagnosticsSnapshot(): RoomHistoryReadResult<DurableDiagnosticsSnapshot>;
    readPinnedSignificantFactSnapshot(
        bounds?: PinnedHistoryBounds,
    ): RoomHistoryReadResult<PinnedSignificantFactSnapshot>;
    readSignificantFactPage(
        query: SignificantFactPageQuery,
    ): RoomHistoryReadResult<SignificantFactPage>;
    readRawTelemetryPage(
        query: NormalizedRawTelemetryPageQuery,
    ): RoomHistoryReadResult<RawTelemetryPage>;
    readTrend(query: NormalizedTrendQuery): RoomHistoryReadResult<TrendResponse>;
    subscribeRoomSnapshot(listener: RoomSnapshotListener): () => void;
    subscribeRoomPublicationBatch(listener: RoomPublicationBatchListener): () => void;
    receiveSourceEvent(event: PlatformEvent): void;
    getAvailableStorage(): RoomStorage | undefined;
    reportSourceReceiptFailure(failure: RoomSourceReceiptFailure): void;
    requestCommand(
        request: SetPowerCommandRequest,
    ): AcceptedCommandResponse | RejectedCommandResponse | PreAdmissionCommandErrorResponse;
}

export type { RoomSnapshotListener } from './room-publication';
export type { RoomPublicationBatchListener } from './room-publication';

interface OperationalLogCorrelation {
    eventId?: string;
    commandId?: string;
    deviceId?: string;
    source?: string;
    reason?: string;
}

const volatileCommandLostOnRestartReason = 'volatile_command_lost_on_restart';
const volatileCommandLostOnRestartMessage =
    'The volatile command was lost when the backend restarted.';

export function createRoomEngine({
    roomName = 'Smart Room',
    snapshotBroadcastIntervalMs = 1000,
    clock = realClock,
    timer,
    generateEventId = randomUUID,
    diagnosticEventLimit,
    deduplicationRetentionMs,
    deduplicationEntryLimit,
    commandTimer = realCommandTimer,
    generateCommandId = randomUUID,
    storage,
    storageLifecycle,
    storageFactory,
    recoveryTimer = timer,
    storageRecoveryProbeIntervalMs = 5_000,
    storageRecoveryQueueLimit = 1_000,
    historyCursorSecret = randomBytes(32),
    operationalLog = () => {},
    onFatalStorageError = (error): never => {
        throw error;
    },
    devices,
    routes,
    sources,
}: RoomEngineConfig): RoomEngine {
    const historyCursorCodec = createHistoryCursorCodec({ secret: historyCursorSecret });
    const resolvedStorageFactory = storageFactory;
    let initialStorage = storage;
    let startupStorageFactoryError: unknown;
    let initialStorageMetadata: StorageMetadata | undefined;
    const runtimeSession = createRoomRuntimeSession({
        generateId: randomUUID,
        startedAt: clock.now(),
    });

    if (!initialStorage && storageLifecycle) {
        try {
            const startup = storageLifecycle.openAtStartup();

            if (startup.kind === 'available') {
                initialStorage = startup.storage;
                initialStorageMetadata = startup.metadata;
            } else {
                startupStorageFactoryError = startup.error;
            }
        } catch (error) {
            startupStorageFactoryError = error;
        }
    } else if (!initialStorage && resolvedStorageFactory) {
        try {
            initialStorage = resolvedStorageFactory();
        } catch (error) {
            startupStorageFactoryError = error;
        }
    }

    const roomProjector = createRoomProjector({
        devices: [...devices],
        initialUpdatedAt: runtimeSession.sessionStartedAt,
    });
    let fatalRuntimeError: Error | undefined;
    let initialUnclosedRuntimeSessions: RuntimeSession[] = [];
    let startupRuntimeSessionReadError: unknown;

    if (initialStorage) {
        try {
            initialUnclosedRuntimeSessions =
                typeof initialStorage.listUnclosedRuntimeSessions === 'function'
                    ? initialStorage.listUnclosedRuntimeSessions()
                    : [];
        } catch (error) {
            startupRuntimeSessionReadError = error;
        }
    }

    const initializedCheckpoint = initializeProjectionCheckpoint(
        startupRuntimeSessionReadError ? undefined : initialStorage,
        roomProjector,
        runtimeSession.sessionStartedAt,
        {
            runtimeSession,
            priorUnclosedRuntimeSessions: initialUnclosedRuntimeSessions,
            generateEventId,
        },
    );
    const initialStorageOutcome = initializedCheckpoint?.outcome;
    let startupStorageError =
        initializedCheckpoint?.readError ??
        startupRuntimeSessionReadError ??
        startupStorageFactoryError;

    if (initialStorageOutcome?.status === 'indeterminate') {
        terminateForStorageOutcome(initialStorageOutcome.error, 'unknown');
    }

    if (
        initialStorageOutcome?.status === 'confirmed_rolled_back' &&
        isFatalStorageError(initialStorageOutcome.error)
    ) {
        terminateForStorageOutcome(initialStorageOutcome.error, 'fatal');
    }

    if (initialStorageOutcome?.status === 'confirmed_rolled_back') {
        startupStorageError ??= initialStorageOutcome.error;
    }

    if (startupStorageError && !isDegradableStorageError(startupStorageError)) {
        logStorageFailure(startupStorageError, 'storage_fatal_error', {});

        throw startupStorageError;
    }

    let initialAcceptedInputIdentities: AcceptedInputIdentity[] = [];

    if (
        initialStorage &&
        !startupStorageError &&
        initialStorageOutcome?.status !== 'confirmed_rolled_back'
    ) {
        try {
            initialAcceptedInputIdentities = initialStorage.listAcceptedInputIdentities();
            initialStorageMetadata ??= initialStorage.getMetadata();
        } catch (error) {
            startupStorageError = error;
        }
    }

    if (startupStorageError && !isDegradableStorageError(startupStorageError)) {
        logStorageFailure(startupStorageError, 'storage_fatal_error', {});

        throw startupStorageError;
    }

    if (startupStorageError) {
        initialAcceptedInputIdentities = [];
    }

    const processor = createEventProcessor({
        devices: [...devices],
        roomProjector,
        clock,
        deduplicationRetentionMs,
        deduplicationEntryLimit,
        acceptedInputIdentities: [
            ...(initializedCheckpoint?.volatileGuards ?? []),
            ...initialAcceptedInputIdentities,
        ],
    });
    const diagnostics = createEventProcessingDiagnostics({
        clock,
        diagnosticEventLimit,
    });
    const roomState = createRoomState({
        projector: roomProjector,
        processor,
        diagnostics,
        initialRecentEvents: initializedCheckpoint?.recentEvents ?? [],
    });
    const startupStorageFailureReason =
        startupStorageError instanceof StorageError &&
        startupStorageError.kind === 'manual_intervention'
            ? 'storage_manual_intervention_required'
            : initialStorage || resolvedStorageFactory || storageLifecycle
              ? 'storage_write_failed'
              : 'storage_not_configured';

    const initialStorageState: PlatformStorageProjection =
        initialStorage &&
        !startupStorageError &&
        initialStorageOutcome?.status !== 'confirmed_rolled_back' &&
        initialStorageMetadata
            ? {
                  status: 'available',
                  changedAt: clock.now(),
                  historyGenerationId: initialStorageMetadata.historyGenerationId,
                  storedThroughSequence: initialStorageMetadata.lastStorageSequence,
              }
            : {
                  status: 'degraded',
                  changedAt: clock.now(),
                  reason: startupStorageFailureReason,
                  // A lifecycle may verify metadata before a later checkpoint
                  // read fails. Keep that generation as a recovery guard: a
                  // missing target must never become an automatic first init.
                  ...(initialStorageMetadata
                      ? {
                            historyGenerationId: initialStorageMetadata.historyGenerationId,
                            storedThroughSequence: initialStorageMetadata.lastStorageSequence,
                        }
                      : { historyGenerationId: null, storedThroughSequence: null }),
              };

    if (startupStorageError) {
        logStorageFailure(startupStorageError, startupStorageFailureReason, {});
    }

    const storageSession = createRoomStorageSession({
        runtimeSession,
        storage: initialStorage,
        status: initialStorageState,
        verifiedHistoryGenerationId: initialStorageMetadata?.historyGenerationId,
        outageState:
            initialStorageState.status === 'degraded'
                ? {
                      startedAt: initialStorageState.changedAt,
                      boundaryBasis: 'degraded_startup_at',
                      failureReason: initialStorageState.reason,
                  }
                : {},
    });
    let recoveryTimerHandle: unknown | undefined;
    const storageRecoveryTimer = recoveryTimer ?? realTimer;

    if (storageSession.status.status === 'degraded' && !initializedCheckpoint?.restored) {
        roomState.projector.installProjection(
            withBootstrapDurability(roomState.projector.getProjection(), 'volatile'),
            clock.now(),
            roomState.projector.getEvidence(),
        );
    }

    const snapshotBroadcastTimer = timer ?? realTimer;
    let bufferedAdapterEvents: Array<{ event: PlatformEvent; receivedAt: string }> | undefined;
    let hasStarted = false;
    let snapshotBroadcastTimerHandle: unknown | undefined;
    const publication = createRoomPublication({ snapshotAt, installedSnapshot });
    const inputCoordinator = createRoomInputCoordinator<
        EventProcessingResult,
        CommandOutboxMutation
    >({
        now: clock.now,
        dispatch(input) {
            return processPlatformEvent(input.event, input.ingress, input.context);
        },
    });
    const commandController = createSetPowerCommandController({
        routes,
        emitEvent(event, outboxMutation) {
            const result = inputCoordinator.receive(event, outboxMutation);

            return result;
        },
        commitOutboxMutation(mutation) {
            inputCoordinator.receiveTimer((ingress) => {
                persistOutboxMutation(mutation, ingress);
            });
        },
        listDurableOutboxIntents() {
            return storageSession.storage &&
                typeof storageSession.storage.listCommandDispatchOutboxIntents === 'function'
                ? storageSession.storage.listCommandDispatchOutboxIntents()
                : [];
        },
        createDispatchScope() {
            if (bufferedAdapterEvents) {
                throw new Error('A command dispatch scope is already active.');
            }

            const bufferedEvents: Array<{ event: PlatformEvent; receivedAt: string }> = [];

            return {
                run(operation) {
                    bufferedAdapterEvents = bufferedEvents;

                    try {
                        return operation();
                    } finally {
                        bufferedAdapterEvents = undefined;
                    }
                },
                flush() {
                    for (const bufferedEvent of bufferedEvents) {
                        inputCoordinator.receiveAt(bufferedEvent.event, bufferedEvent.receivedAt);
                    }

                    bufferedEvents.length = 0;
                },
            };
        },
        getRoomSnapshot: getCurrentRoomSnapshot,
        scheduleImmediate(callback) {
            queueMicrotask(() => {
                inputCoordinator.receiveTimer(() => callback());
            });
        },
        clock,
        commandTimer,
        generateCommandId,
        generateEventId,
    });
    const storageRecoveryContext: RoomStorageRecoveryContext = {
        resolvedStorageFactory,
        storageLifecycle,
        storageSession,
        roomState,
        inputCoordinator,
        storageRecoveryQueueLimit,
        generateEventId,
        deduplicationRetentionMs,
        deduplicationEntryLimit,
        notifySnapshotListeners(evaluatedAt, installedProjectionOnly) {
            publication.notify(evaluatedAt, installedProjectionOnly);
        },
        enterStorageDegraded,
        terminateForStorageOutcome,
        fatalRuntimeError: () => fatalRuntimeError,
        scheduleStorageRecovery,
        cancelStorageRecovery,
        commandController,
        publication,
    };

    closeRestoredVolatileCommands();

    return {
        start() {
            assertRuntimeIsHealthy();

            if (hasStarted) {
                return;
            }

            inputCoordinator.openIntake();
            hasStarted = true;
            sources.startCommandSources();
            commandController.reschedulePendingCommands();

            if (storageSession.status.status === 'available') {
                commandController.reconcileOutboxAfterRecovery();
            } else {
                scheduleStorageRecovery();
            }

            sources.startObservationSources();

            snapshotBroadcastTimerHandle = snapshotBroadcastTimer.setInterval(() => {
                inputCoordinator.receiveTimer((ingress) => {
                    notifyFreshnessChanges(ingress);
                });
            }, snapshotBroadcastIntervalMs);

            sources.startPeriodicSources();
        },
        stop() {
            sources.stopPeriodicSources();

            if (snapshotBroadcastTimerHandle !== undefined) {
                snapshotBroadcastTimer.clearInterval(snapshotBroadcastTimerHandle);
                snapshotBroadcastTimerHandle = undefined;
            }

            if (recoveryTimerHandle !== undefined) {
                storageRecoveryTimer.clearInterval(recoveryTimerHandle);
                recoveryTimerHandle = undefined;
            }

            sources.stop();

            commandController.stop();
            const inputShutdown = inputCoordinator.closeIntakeAndDrain();

            if (inputShutdown.status === 'drained') {
                closeRuntimeSession();
            }

            closeStorage(storageSession.storage);
            storageSession.installStorage(undefined);
            hasStarted = false;
        },
        getRoomSnapshot() {
            return snapshotAt(clock.now());
        },
        getDiagnosticsSnapshot() {
            return roomState.diagnostics.getSnapshot();
        },
        readDiagnosticsSnapshot() {
            if (!storageSession.storage || storageSession.status.status !== 'available') {
                return { status: 'unavailable' };
            }

            return handleHistoryRead(
                createRoomDiagnosticsReader({
                    storage: storageSession.storage,
                    now: clock.now,
                }).readDiagnosticsSnapshot(),
            );
        },
        readPinnedSignificantFactSnapshot(bounds) {
            const reader = availableHistoryReader();

            return reader
                ? handleHistoryRead(reader.readPinnedSignificantFactSnapshot(bounds))
                : { status: 'unavailable' };
        },
        readSignificantFactPage(query) {
            const reader = availableHistoryReader();

            return reader
                ? handleHistoryRead(reader.readSignificantFactPage(query))
                : { status: 'unavailable' };
        },
        readRawTelemetryPage(query) {
            const reader = availableHistoryReader();

            return reader
                ? handleHistoryRead(reader.readRawTelemetryPage(query))
                : { status: 'unavailable' };
        },
        readTrend(query) {
            const reader = availableHistoryReader();

            return reader ? handleHistoryRead(reader.readTrend(query)) : { status: 'unavailable' };
        },
        subscribeRoomSnapshot(listener) {
            return publication.subscribeRoomSnapshot(listener);
        },
        subscribeRoomPublicationBatch(listener) {
            return publication.subscribeRoomPublicationBatch(listener);
        },
        requestCommand(request) {
            assertRuntimeIsHealthy();

            return commandController.requestCommand(request);
        },
        assertHealthy() {
            assertRuntimeIsHealthy();
        },
        isStarted() {
            return hasStarted;
        },
        receiveSourceEvent(event) {
            receiveAdapterEvent(event);
        },
        getAvailableStorage() {
            return storageSession.storage && storageSession.status.status === 'available'
                ? storageSession.storage
                : undefined;
        },
        reportSourceReceiptFailure(failure) {
            handleSourceReceiptFailure(failure);
        },
    };

    function notifyFreshnessChanges(ingress: EventIngress): void {
        assertRuntimeIsHealthy();
        const evaluatedAt = ingress.receivedAt;
        const snapshot = snapshotAt(evaluatedAt);
        const previousSnapshot = publication.lastPublishedSnapshot();

        if (previousSnapshot && !hasObservationStatusChange(previousSnapshot, snapshot)) {
            return;
        }

        const prepared = roomState.processor.prepareFreshnessProjection(ingress);
        let platformBeforeOutcome = false;

        const activeStorage = storageSession.storage;

        if (activeStorage && storageSession.status.status === 'available') {
            const outcome = activeStorage.transact(
                (transaction) => {
                    transaction.saveLatestRoomProjection({
                        updatedAt: prepared.candidateState.updatedAt,
                        projection: prepared.candidateState,
                        projectionEvidence: prepared.candidateEvidence,
                        volatileGuards: roomState.processor.listVolatileIdentities(),
                        recentEvents: roomState.recentEvents(),
                    });
                    storageSession.activateRuntimeSession(transaction, evaluatedAt);
                },
                { retentionAsOf: evaluatedAt },
            );

            if (outcome.status === 'indeterminate') {
                return terminateForStorageOutcome(outcome.error, 'unknown');
            }

            if (outcome.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
                return terminateForStorageOutcome(outcome.error, 'fatal');
            }

            if (outcome.status === 'confirmed_rolled_back') {
                enterStorageDegraded(outcome.error, evaluatedAt, false);
                platformBeforeOutcome = true;
            } else {
                roomState.processor.forgetDurableIdentities(
                    outcome.retention.retiredIdentityEventIds,
                );
            }
        }

        roomState.processor.commitPreparedProjection(prepared);

        publication.notify(evaluatedAt, false, platformBeforeOutcome);
    }

    function processPlatformEvent(
        event: PlatformEvent,
        ingress: EventIngress,
        outboxMutation?: CommandOutboxMutation,
    ): EventProcessingResult {
        assertRuntimeIsHealthy();
        const receivedAt = ingress.receivedAt;
        closeExpiredCommandBeforeStateReport(event, ingress);
        const activeCommandIdBeforeEvent = event.deviceId
            ? roomProjector
                  .getProjection()
                  .activeCommands.find((command) => command.deviceId === event.deviceId)?.commandId
            : undefined;
        reconcileExpiredDurableIdentity(event, receivedAt);
        const prepared = preserveOriginalProcessingEvidence(
            roomState.processor.prepareEvent(
                event,
                ingress,
                storageSession.status.status === 'available' ? 'available' : 'degraded',
            ),
            roomState.recentEvents(),
        );
        const durablePreparedState = roomState.processor.materializePreparedState(
            prepared,
            'durable',
        );
        let result: EventProcessingResult;
        let platformBeforeOutcome = false;
        let publicationRecentEvents: RecentEventProjection[];
        let publicationTelemetrySample: LiveTelemetrySampleProjection | undefined;
        const activeStorage = storageSession.storage;

        if (activeStorage && storageSession.status.status === 'available') {
            const outcome = commitPreparedEvent({
                storage: activeStorage,
                event,
                ingress,
                prepared,
                durablePreparedState,
                projectionEvidence: prepared.candidateEvidence ?? roomState.projector.getEvidence(),
                recentEvents: roomState.recentEvents(),
                volatileGuards: volatileGuardsForCheckpoint(prepared),
                outboxMutation,
                storageSession,
            });

            if (outcome.status === 'indeterminate') {
                return terminateForStorageOutcome(
                    outcome.error,
                    'unknown',
                    correlationForEvent(event),
                );
            }

            if (outcome.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
                return terminateForStorageOutcome(
                    outcome.error,
                    'fatal',
                    correlationForEvent(event),
                );
            }

            if (outcome.status === 'confirmed_rolled_back') {
                enterStorageDegraded(outcome.error, receivedAt, false, correlationForEvent(event));
                platformBeforeOutcome = true;
                result = roomState.processor.commitPrepared(prepared, 'volatile');
                rememberVolatileIdentity(prepared, receivedAt);
                roomState.installRecentEvents(
                    mergeRecentEvents(
                        roomState.recentEvents(),
                        recentEventsForRecords(prepared.feedRecords, 'volatile'),
                    ),
                );
                publicationRecentEvents = recentEventsForRecords(prepared.feedRecords, 'volatile');
                publicationTelemetrySample = prepared.records
                    .map((record) => liveTelemetrySampleForRecord(record, 'volatile'))
                    .find((sample) => sample !== undefined);
            } else {
                result = roomState.processor.commitPrepared(prepared);
                roomState.installRecentEvents(
                    mergeRecentEvents(roomState.recentEvents(), outcome.value.storedRecentEvents),
                );
                publicationRecentEvents = outcome.value.storedRecentEvents;
                publicationTelemetrySample = outcome.value.storedTelemetrySample;
                roomState.processor.forgetDurableIdentities(
                    outcome.retention.retiredIdentityEventIds,
                );

                if (
                    prepared.eventId &&
                    prepared.fingerprint &&
                    !outcome.retention.retiredIdentityEventIds.includes(prepared.eventId)
                ) {
                    roomState.processor.rememberDurableIdentity(
                        prepared.eventId,
                        prepared.fingerprint,
                        receivedAt,
                    );
                }

                storageSession.installStatus({
                    status: 'available',
                    changedAt: storageSession.status.changedAt,
                    historyGenerationId: storageSession.status.historyGenerationId,
                    storedThroughSequence:
                        outcome.value.storedThroughSequence ??
                        storageSession.status.storedThroughSequence,
                });
            }
        } else {
            result = roomState.processor.commitPrepared(prepared, 'volatile');
            rememberVolatileIdentity(prepared, receivedAt);
            roomState.installRecentEvents(
                mergeRecentEvents(
                    roomState.recentEvents(),
                    recentEventsForRecords(prepared.feedRecords, 'volatile'),
                ),
            );
            publicationRecentEvents = recentEventsForRecords(prepared.feedRecords, 'volatile');
            publicationTelemetrySample = prepared.records
                .map((record) => liveTelemetrySampleForRecord(record, 'volatile'))
                .find((sample) => sample !== undefined);
        }

        roomState.diagnostics.recordProcessingResult(event, result);
        logEventProcessingOutcome(event, prepared, result);
        commandController.onEventProcessed(activeCommandIdBeforeEvent, event, result);

        if (result.status === 'accepted' || prepared.kind === 'accepted_non_applying') {
            publication.notify(
                result.status === 'accepted' ? result.evaluatedAt : receivedAt,
                false,
                platformBeforeOutcome,
                publicationRecentEvents,
                publicationTelemetrySample,
            );
        }

        return result;
    }

    function logEventProcessingOutcome(
        event: PlatformEvent,
        prepared: ReturnType<typeof roomState.processor.prepareEvent>,
        result: EventProcessingResult,
    ): void {
        const reason = result.status === 'ignored' ? result.reason : reasonForEvent(event);

        if (result.status === 'ignored') {
            operationalLog({
                event: 'platform_event_rejected',
                ...correlationForEvent(event, reason),
            });
        }

        if (isCommandLifecycleEvent(event)) {
            operationalLog({
                event: 'command_handled',
                eventType: event.eventType,
                ...correlationForEvent(event, reason),
            });
        }

        for (const record of prepared.records) {
            if (record.kind !== 'derived_command_confirmed') {
                continue;
            }

            operationalLog({
                event: 'command_handled',
                eventType: 'command.confirmed',
                eventId: record.eventId,
                commandId: record.commandId,
                deviceId: record.deviceId,
                source: 'backend',
            });
        }
    }

    function correlationForEvent(event: PlatformEvent, reason?: string): OperationalLogCorrelation {
        return {
            eventId: event.eventId,
            ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
            ...(event.deviceId === undefined ? {} : { deviceId: event.deviceId }),
            source: event.source,
            ...(reason === undefined ? {} : { reason }),
        };
    }

    function correlationForOutboxMutation(
        mutation: CommandOutboxMutation,
    ): OperationalLogCorrelation {
        return mutation.kind === 'upsert'
            ? {
                  commandId: mutation.intent.commandId,
                  deviceId: mutation.intent.deviceId,
                  source: 'backend',
              }
            : { commandId: mutation.commandId, source: 'backend' };
    }

    function logStorageFailure(
        error: unknown,
        reason: string,
        correlation: OperationalLogCorrelation,
    ): void {
        operationalLog({
            event: 'storage_failure',
            ...correlation,
            source: correlation.source ?? 'backend',
            reason,
            storageFailureKind: error instanceof StorageError ? error.kind : 'unknown',
        });
    }

    function persistOutboxMutation(mutation: CommandOutboxMutation, ingress: EventIngress): void {
        if (!storageSession.storage || storageSession.status.status !== 'available') {
            return;
        }

        const projection = roomState.projector.getProjection({ evaluatedAt: ingress.receivedAt });
        const outcome = storageSession.storage.transact(
            (transaction) => {
                if (mutation.kind === 'upsert') {
                    transaction.upsertCommandDispatchOutboxIntent(mutation.intent);
                } else {
                    transaction.closeCommandDispatchOutboxIntent(mutation);
                }

                transaction.saveLatestRoomProjection({
                    updatedAt: projection.updatedAt,
                    projection,
                    projectionEvidence: roomState.projector.getEvidence(),
                    volatileGuards: roomState.processor.listVolatileIdentities(),
                    recentEvents: roomState.recentEvents(),
                });
                storageSession.activateRuntimeSession(transaction, ingress.receivedAt);
            },
            { retentionAsOf: ingress.receivedAt },
        );

        if (outcome.status === 'indeterminate') {
            terminateForStorageOutcome(
                outcome.error,
                'unknown',
                correlationForOutboxMutation(mutation),
            );
        }

        if (outcome.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
            terminateForStorageOutcome(
                outcome.error,
                'fatal',
                correlationForOutboxMutation(mutation),
            );
        }

        if (outcome.status === 'confirmed_rolled_back') {
            enterStorageDegraded(
                outcome.error,
                ingress.receivedAt,
                true,
                correlationForOutboxMutation(mutation),
            );
        }
    }

    function scheduleStorageRecovery(): void {
        if (
            (!resolvedStorageFactory && !storageLifecycle) ||
            (storageSession.status.status !== 'degraded' &&
                storageSession.status.status !== 'recovering') ||
            storageSession.status.reason === 'storage_manual_intervention_required' ||
            storageSession.status.reason === 'storage_not_configured' ||
            recoveryTimerHandle !== undefined
        ) {
            return;
        }

        recoveryTimerHandle = storageRecoveryTimer.setInterval(() => {
            inputCoordinator.receiveTimer((ingress) => {
                attemptStorageRecovery(ingress);
            });
        }, storageRecoveryProbeIntervalMs);
    }

    function cancelStorageRecovery(): void {
        if (recoveryTimerHandle === undefined) {
            return;
        }

        storageRecoveryTimer.clearInterval(recoveryTimerHandle);
        recoveryTimerHandle = undefined;
    }

    function attemptStorageRecovery(ingress: EventIngress): void {
        runStorageRecovery(storageRecoveryContext, ingress);
    }

    function enterStorageDegraded(
        error: unknown,
        changedAt: string,
        publish = true,
        correlation: OperationalLogCorrelation = {},
    ): void {
        if (!(error instanceof StorageError) || isFatalStorageError(error)) {
            terminateForStorageOutcome(error, 'fatal', correlation);
        }

        const manual = error instanceof StorageError && error.kind === 'manual_intervention';

        if (manual) {
            cancelStorageRecovery();
        }

        closeStorage(storageSession.storage);
        storageSession.installStorage(undefined);

        const reason = manual ? 'storage_manual_intervention_required' : 'storage_write_failed';
        storageSession.recordStorageFailure(changedAt, reason);
        logStorageFailure(error, reason, correlation);
        const unchanged =
            storageSession.status.status === 'degraded' && storageSession.status.reason === reason;
        storageSession.installStatus(
            storageSession.status.historyGenerationId === null
                ? {
                      status: 'degraded',
                      changedAt: unchanged ? storageSession.status.changedAt : changedAt,
                      reason,
                      historyGenerationId: null,
                      storedThroughSequence: null,
                  }
                : {
                      status: 'degraded',
                      changedAt: unchanged ? storageSession.status.changedAt : changedAt,
                      reason,
                      historyGenerationId: storageSession.status.historyGenerationId,
                      storedThroughSequence: storageSession.status.storedThroughSequence,
                  },
        );

        if (publish && !unchanged) {
            publication.notify(changedAt, true);
        }

        if (!manual) {
            scheduleStorageRecovery();
        }
    }

    function closeRuntimeSession(): void {
        const outcome = storageSession.closeRuntimeSession(clock.now());

        if (outcome?.status === 'indeterminate') {
            terminateForStorageOutcome(outcome.error, 'unknown');
        }

        if (outcome?.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
            terminateForStorageOutcome(outcome.error, 'fatal');
        }
    }

    function closeExpiredCommandBeforeStateReport(
        event: PlatformEvent,
        ingress: EventIngress,
    ): void {
        if (event.eventType !== 'device.state.reported' || !event.deviceId) {
            return;
        }

        const active = roomProjector
            .getProjection()
            .activeCommands.find(
                (command) => command.deviceId === event.deviceId && command.status === 'pending',
            );

        if (!active || active.status !== 'pending') {
            return;
        }

        if (Date.parse(ingress.receivedAt) < Date.parse(active.delivery.deadlineAt)) {
            return;
        }

        processPlatformEvent(
            createSetPowerTimeoutEvent({
                generateEventId,
                deadlineAt: active.delivery.deadlineAt,
                deviceId: active.deviceId,
                commandId: active.commandId,
            }),
            ingress,
        );
    }

    function volatileGuardsForCheckpoint(
        prepared: ReturnType<typeof roomState.processor.prepareEvent>,
    ) {
        return processor
            .listVolatileIdentities()
            .filter(
                (identity) =>
                    !(
                        prepared.identityDisposition === 'volatile_reconciliation' &&
                        identity.eventId === prepared.eventId
                    ),
            );
    }

    function rememberVolatileIdentity(
        prepared: ReturnType<typeof roomState.processor.prepareEvent>,
        acceptedAt: string,
    ): void {
        if (prepared.eventId && prepared.fingerprint && prepared.kind !== 'quarantined') {
            const input = prepared.records.find(
                (record) => record.kind === 'input_significant_fact',
            );
            roomState.processor.rememberVolatileIdentity(
                prepared.eventId,
                prepared.fingerprint,
                acceptedAt,
                input?.processingEvidence,
            );
        }
    }

    function receiveAdapterEvent(event: PlatformEvent): void {
        assertRuntimeIsHealthy();

        if (bufferedAdapterEvents) {
            bufferedAdapterEvents.push({ event, receivedAt: clock.now() });

            return;
        }

        inputCoordinator.receive(event);
    }

    function getCurrentRoomSnapshot(): RoomSnapshotProjection {
        return snapshotAt(clock.now());
    }

    function availableHistoryReader() {
        if (!storageSession.storage || storageSession.status.status !== 'available') {
            return undefined;
        }

        return createRoomHistoryReader({
            storage: storageSession.storage,
            cursorCodec: historyCursorCodec,
            now: clock.now,
        });
    }

    function handleHistoryRead<Value>(
        result: RoomHistoryReadResult<Value>,
    ): RoomHistoryReadResult<Value> {
        if (result.status !== 'unavailable' || result.error === undefined) {
            return result;
        }

        if (result.failure === 'indeterminate') {
            return terminateForStorageOutcome(result.error, 'unknown');
        }

        if (!isDegradableStorageError(result.error)) {
            return terminateForStorageOutcome(result.error, 'fatal');
        }

        enterStorageDegraded(result.error, clock.now());

        return { status: 'unavailable' };
    }

    function closeRestoredVolatileCommands(): void {
        const restoredVolatileCommands = roomProjector
            .getProjection()
            .activeCommands.filter((command) => command.durability === 'volatile');

        for (const command of restoredVolatileCommands) {
            const occurredAt = clock.now();
            const event = {
                eventId: generateEventId(),
                eventType: 'command.failed',
                occurredAt,
                source: 'backend',
                deviceId: command.deviceId,
                commandId: command.commandId,
                payload: {
                    reason: volatileCommandLostOnRestartReason,
                    message: volatileCommandLostOnRestartMessage,
                },
            } satisfies CommandFailedEvent;
            const result = inputCoordinator.receive(event);

            if (result?.status !== 'accepted') {
                throw new Error(
                    `Could not close restored volatile command ${command.commandId} during startup.`,
                );
            }

            if (storageSession.status.status !== 'available') {
                roomState.recordStartupCommandFailure({
                    event,
                    acceptedAt: occurredAt,
                    processingEvidence: {
                        version: 1,
                        kind: 'command_intent',
                        intent: {
                            commandType: 'set.power',
                            requestedState: { ...command.requestedState },
                        },
                    },
                });
            }
        }
    }

    function snapshotAt(evaluatedAt: string): RoomSnapshotProjection {
        return toRoomSnapshot(
            roomName,
            roomProjector,
            evaluatedAt,
            storageSession.status,
            roomState.recentEvents(),
        );
    }

    function installedSnapshot(): RoomSnapshotProjection {
        return toRoomSnapshot(
            roomName,
            roomProjector,
            undefined,
            storageSession.status,
            roomState.recentEvents(),
        );
    }

    function assertRuntimeIsHealthy(): void {
        if (fatalRuntimeError) {
            throw fatalRuntimeError;
        }
    }

    function reconcileExpiredDurableIdentity(event: PlatformEvent, receivedAt: string): void {
        if (
            !storageSession.storage ||
            storageSession.status.status !== 'available' ||
            !roomState.processor.hasDurableIdentity(event.eventId)
        ) {
            return;
        }

        try {
            if (!storageSession.storage.isAcceptedInputIdentityActive(event.eventId, receivedAt)) {
                roomState.processor.forgetDurableIdentities([event.eventId]);
            }
        } catch (error) {
            if (!isDegradableStorageError(error)) {
                terminateForStorageOutcome(error, 'fatal', correlationForEvent(event));
            }

            enterStorageDegraded(error, receivedAt, true, correlationForEvent(event));
        }
    }

    function handleSourceReceiptFailure(failure: RoomSourceReceiptFailure): void {
        const correlation = {
            source: failure.source,
            commandId: failure.commandId,
            deviceId: failure.deviceId,
            operation: failure.operation,
            reason:
                failure.outcome === 'inspection_unavailable'
                    ? 'receipt_prior_acceptance_unknown'
                    : failure.outcome === 'confirmed_rolled_back'
                      ? 'receipt_write_rolled_back'
                      : 'storage_commit_outcome_unknown',
            storageFailureKind:
                failure.error instanceof StorageError ? failure.error.kind : 'unknown',
        } satisfies OperationalLogCorrelation & Record<string, unknown>;

        if (failure.outcome === 'indeterminate') {
            terminateForStorageOutcome(failure.error, 'unknown', correlation);
        }

        if (failure.error instanceof StorageError && failure.error.kind === 'fatal') {
            terminateForStorageOutcome(failure.error, 'fatal', correlation);
        }

        if (storageSession.status.status === 'available') {
            enterStorageDegraded(failure.error, clock.now(), true, correlation);
        }
    }

    function terminateForStorageOutcome(
        cause: unknown,
        kind: 'unknown' | 'fatal',
        correlation: OperationalLogCorrelation = {},
    ): never {
        logStorageFailure(
            cause,
            kind === 'unknown' ? 'storage_commit_outcome_unknown' : 'storage_fatal_error',
            correlation,
        );
        fatalRuntimeError ??= new Error(
            kind === 'unknown' ? 'storage_commit_outcome_unknown' : 'storage_fatal_error',
            { cause },
        );

        return onFatalStorageError(fatalRuntimeError);
    }
}

const realTimer: IntervalScheduler = {
    setInterval(callback, intervalMs) {
        return setInterval(callback, intervalMs);
    },
    clearInterval(timerHandle) {
        clearInterval(timerHandle as ReturnType<typeof setInterval>);
    },
};

const realCommandTimer: CommandTimer = {
    setTimeout(callback, delayMs) {
        return setTimeout(callback, delayMs);
    },
    clearTimeout(timerHandle) {
        clearTimeout(timerHandle as ReturnType<typeof setTimeout>);
    },
};

const realClock: RoomClock = {
    now() {
        return new Date().toISOString();
    },
};

function isCommandLifecycleEvent(event: PlatformEvent): boolean {
    return event.eventType.startsWith('command.');
}

function reasonForEvent(event: PlatformEvent): string | undefined {
    if (
        typeof event.payload !== 'object' ||
        event.payload === null ||
        !('reason' in event.payload) ||
        typeof event.payload.reason !== 'string'
    ) {
        return undefined;
    }

    return event.payload.reason;
}

function toRoomSnapshot(
    roomName: string,
    roomProjector: RoomProjector,
    evaluatedAt: string | undefined,
    storage: PlatformStorageProjection,
    recentEvents: RecentEventProjection[],
): RoomSnapshotProjection {
    const projection =
        evaluatedAt === undefined
            ? roomProjector.getProjection()
            : roomProjector.getProjection({ evaluatedAt });

    return {
        roomName,
        updatedAt: projection.updatedAt,
        devices: projection.devices,
        activeCommands: projection.activeCommands,
        recentCommands: projection.recentCommands,
        recentEvents,
        platform: { storage },
    };
}

function hasObservationStatusChange(
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
): boolean {
    const previousByDeviceId = new Map(
        previous.devices.map((device) => [device.deviceId, device.observationStatus]),
    );

    return next.devices.some((device) => {
        const previousStatus = previousByDeviceId.get(device.deviceId);
        const nextEntries = Object.entries(device.observationStatus);

        if (!previousStatus || Object.keys(previousStatus).length !== nextEntries.length) {
            return true;
        }

        return nextEntries.some(([capability, status]) => {
            const previousCapability = previousStatus[capability];

            return (
                !previousCapability ||
                previousCapability.freshness !== status.freshness ||
                previousCapability.lastObservedAt !== status.lastObservedAt
            );
        });
    });
}
