import type { RecentEventProjection } from '@smart-room/contracts/history';

import type {
    CommandOutboxMutation,
    SetPowerCommandController,
} from '../command-processing/set-power-command-controller';
import {
    defaultDeduplicationEntryLimit,
    defaultDeduplicationRetentionMs,
} from '../event-processing/event-deduplicator';
import { inputFingerprint, platformRecordId } from '../event-processing/event-identity';
import type {
    EventIngress,
    EventProcessingResult,
    PreparedRecord,
} from '../event-processing/event-processor';
import { mergeRecentEvents, recentEventForRecord } from '../history/room-live-history';
import type { RoomProjector } from '../read-model/room-projection';
import {
    conservativeSessionGapStart,
    hasConflictingActiveCommands,
    hasVolatileDurableActiveCommandConflict,
    mergeRecoveryEvidence,
    mergeRecoveryProjection,
    mergeVolatileGuards,
    promoteStartupVolatileCommandFailures,
} from '../read-model/room-recovery-policy';
import type {
    AcceptedInputIdentity,
    RoomStorage,
    RoomStorageLifecycle,
    RoomStorageTransaction,
    RuntimeSession,
} from '../storage/room-storage';
import { StorageError } from '../storage/storage-errors';

import { appendPreparedRecord } from './room-event-commit';
import type { RoomInputCoordinator } from './room-input-coordinator';
import type { RoomPublication } from './room-publication';
import type { RoomState } from './room-state';
import type { RoomRuntimeSession } from './room-storage-session';
import {
    closeStorage,
    isLifecycleCutoverCommit,
    isRoomProjection,
    type RoomStorageSession,
} from './room-storage-session';

export function initializeProjectionCheckpoint(
    storage: RoomStorage | undefined,
    projector: RoomProjector,
    evaluatedAt: string,
    {
        runtimeSession,
        priorUnclosedRuntimeSessions,
        generateEventId,
    }: {
        runtimeSession: RoomRuntimeSession;
        priorUnclosedRuntimeSessions: readonly RuntimeSession[];
        generateEventId(): string;
    },
) {
    if (!storage) {
        return undefined;
    }

    const startupMarkerOutcome = storage.transact(
        (transaction) => {
            runtimeSession.activate(transaction, evaluatedAt);
        },
        { retentionAsOf: evaluatedAt },
    );

    if (startupMarkerOutcome.status !== 'committed') {
        return {
            outcome: startupMarkerOutcome,
            restored: false,
            volatileGuards: [],
            recentEvents: [],
        };
    }

    let checkpoint;

    try {
        checkpoint = storage.getLatestRoomProjection();
    } catch (error) {
        return {
            readError: error,
            restored: false,
            volatileGuards: [],
            recentEvents: [],
        };
    }

    if (checkpoint) {
        if (!isRoomProjection(checkpoint.projection)) {
            throw new Error('Latest room projection checkpoint is invalid.');
        }

        projector.replaceProjection(checkpoint.projection, checkpoint.projectionEvidence);
    }

    const projection = projector.getProjection({ evaluatedAt });
    const projectionEvidence = projector.getEvidence();
    const projectionChanged =
        !checkpoint || JSON.stringify(checkpoint.projection) !== JSON.stringify(projection);
    const gapStartedAt = conservativeSessionGapStart(priorUnclosedRuntimeSessions);
    const gapRecordId = gapStartedAt
        ? platformRecordId('storage.gap.recorded', generateEventId())
        : undefined;
    const gapPayload = gapStartedAt
        ? {
              outageStartedAt: gapStartedAt,
              outageEndedAt: evaluatedAt,
              failureReason: 'runtime_session_interrupted',
              boundaryBasis: 'unclosed_session_later_bound' as const,
              observationsBackfilled: false as const,
          }
        : undefined;

    if (!projectionChanged && !gapRecordId) {
        projector.installProjection(projection, evaluatedAt, projectionEvidence);

        return {
            restored: true,
            volatileGuards: checkpoint?.volatileGuards ?? [],
            recentEvents: checkpoint?.recentEvents ?? [],
        };
    }

    const outcome = storage.transact(
        (transaction) => {
            let gapRecentEvent: RecentEventProjection | undefined;

            if (gapRecordId && gapPayload) {
                const storedGap = transaction.appendSignificantFact({
                    recordId: gapRecordId,
                    eventType: 'storage.gap.recorded',
                    source: 'backend',
                    occurredAt: evaluatedAt,
                    payload: gapPayload,
                });
                gapRecentEvent = {
                    recordId: gapRecordId,
                    eventType: 'storage.gap.recorded',
                    occurredAt: evaluatedAt,
                    durability: 'durable',
                    storageSequence: storedGap.storageSequence,
                    source: 'backend',
                    payload: gapPayload,
                };
            }

            if (projectionChanged || gapRecentEvent) {
                transaction.saveLatestRoomProjection({
                    updatedAt: projection.updatedAt,
                    projection,
                    projectionEvidence,
                    volatileGuards: checkpoint?.volatileGuards ?? [],
                    recentEvents: mergeRecentEvents(
                        checkpoint?.recentEvents ?? [],
                        gapRecentEvent ? [gapRecentEvent] : [],
                    ),
                });
            }

            runtimeSession.activate(transaction, evaluatedAt);

            for (const priorSession of priorUnclosedRuntimeSessions) {
                if (typeof transaction.closeRuntimeSession === 'function') {
                    transaction.closeRuntimeSession({
                        sessionId: priorSession.sessionId,
                        closedAt: evaluatedAt,
                    });
                }
            }

            return gapRecentEvent;
        },
        { retentionAsOf: evaluatedAt },
    );

    if (outcome.status !== 'indeterminate') {
        projector.installProjection(projection, evaluatedAt, projectionEvidence);
    }

    return {
        outcome,
        restored: checkpoint !== undefined,
        volatileGuards: checkpoint?.volatileGuards ?? [],
        recentEvents:
            outcome.status === 'committed' && outcome.value
                ? mergeRecentEvents(checkpoint?.recentEvents ?? [], [outcome.value])
                : (checkpoint?.recentEvents ?? []),
    };
}

export interface RoomStorageRecoveryContext {
    resolvedStorageFactory?: () => RoomStorage;
    storageLifecycle?: RoomStorageLifecycle;
    storageSession: RoomStorageSession;
    roomState: RoomState;
    inputCoordinator: Pick<
        RoomInputCoordinator<EventProcessingResult, CommandOutboxMutation>,
        'beginRecoveryCutover'
    >;
    storageRecoveryQueueLimit: number;
    generateEventId(): string;
    deduplicationRetentionMs?: number;
    deduplicationEntryLimit?: number;
    notifySnapshotListeners(evaluatedAt: string, installedProjectionOnly?: boolean): void;
    enterStorageDegraded(error: unknown, changedAt: string): void;
    terminateForStorageOutcome(cause: unknown, kind: 'unknown' | 'fatal'): never;
    fatalRuntimeError(): Error | undefined;
    scheduleStorageRecovery(): void;
    cancelStorageRecovery(): void;
    commandController: Pick<SetPowerCommandController, 'reconcileOutboxAfterRecovery'>;
    publication: Pick<RoomPublication, 'stageRecoveryGap' | 'publishRecoveryCommit'>;
}

export function attemptStorageRecovery(
    context: RoomStorageRecoveryContext,
    ingress: EventIngress,
): void {
    const {
        resolvedStorageFactory,
        storageLifecycle,
        storageSession,
        roomState,
        inputCoordinator,
        storageRecoveryQueueLimit,
        generateEventId,
        deduplicationRetentionMs,
        deduplicationEntryLimit,
        notifySnapshotListeners,
        enterStorageDegraded,
        terminateForStorageOutcome,
        fatalRuntimeError,
        scheduleStorageRecovery,
        cancelStorageRecovery,
        commandController,
        publication,
    } = context;

    if (
        (!resolvedStorageFactory && !storageLifecycle) ||
        (storageSession.status.status !== 'degraded' &&
            storageSession.status.status !== 'recovering') ||
        storageSession.status.reason === 'storage_manual_intervention_required' ||
        storageSession.status.reason === 'storage_not_configured'
    ) {
        return;
    }

    let candidate: RoomStorage | undefined;
    let lifecycleProbe: ReturnType<RoomStorageLifecycle['probe']> | undefined;
    let cutover: ReturnType<typeof inputCoordinator.beginRecoveryCutover> | undefined;

    try {
        if (storageLifecycle) {
            lifecycleProbe = storageLifecycle.probe({
                verifiedHistoryGenerationId:
                    storageSession.verifiedHistoryGenerationId ??
                    storageSession.status.historyGenerationId ??
                    undefined,
            });

            if (lifecycleProbe.kind === 'existing_generation') {
                storageSession.installVerifiedHistoryGenerationId(
                    lifecycleProbe.metadata.historyGenerationId,
                );
            }

            candidate =
                lifecycleProbe.kind === 'existing_generation' ? lifecycleProbe.storage : undefined;
        } else if (resolvedStorageFactory) {
            candidate = resolvedStorageFactory();
        }

        const metadata = candidate?.getMetadata();
        const interruptedRuntimeSessions =
            typeof candidate?.listUnclosedRuntimeSessions === 'function'
                ? candidate
                      .listUnclosedRuntimeSessions()
                      .filter(
                          (session) =>
                              session.sessionId !== storageSession.runtimeSession.sessionId,
                      )
                : [];
        const previousStorage = storageSession.status;
        const recoveringGeneration =
            metadata?.historyGenerationId ?? previousStorage.historyGenerationId;
        const recoveringSequence =
            metadata?.lastStorageSequence ?? previousStorage.storedThroughSequence;
        const enteringRecovery = storageSession.status.status !== 'recovering';

        if (enteringRecovery) {
            storageSession.installStatus(
                recoveringGeneration === null || recoveringSequence === null
                    ? {
                          status: 'recovering',
                          changedAt: ingress.receivedAt,
                          reason: 'storage_recovering',
                          historyGenerationId: null,
                          storedThroughSequence: null,
                      }
                    : {
                          status: 'recovering',
                          changedAt: ingress.receivedAt,
                          reason: 'storage_recovering',
                          historyGenerationId: recoveringGeneration,
                          storedThroughSequence: recoveringSequence,
                      },
            );
        }

        cutover = inputCoordinator.beginRecoveryCutover({
            queueLimit: storageRecoveryQueueLimit,
        });

        if (enteringRecovery) {
            notifySnapshotListeners(ingress.receivedAt, true);
        }

        if (cutover.overflowed) {
            closeStorage(candidate);
            candidate = undefined;
            storageSession.installStatus(
                previousStorage.historyGenerationId === null
                    ? {
                          status: 'degraded',
                          changedAt: ingress.receivedAt,
                          reason: 'storage_recovery_queue_overflow',
                          historyGenerationId: null,
                          storedThroughSequence: null,
                      }
                    : {
                          status: 'degraded',
                          changedAt: ingress.receivedAt,
                          reason: 'storage_recovery_queue_overflow',
                          historyGenerationId: previousStorage.historyGenerationId,
                          storedThroughSequence: previousStorage.storedThroughSequence,
                      },
            );
            notifySnapshotListeners(ingress.receivedAt, true);
            cutover.abort();
            scheduleStorageRecovery();

            return;
        }

        const capturedRecoveryState = roomState.captureRecoveryState(ingress.receivedAt);
        const volatileProjection = capturedRecoveryState.projection;
        const restoredCheckpoint = candidate?.getLatestRoomProjection();
        let finalProjection = volatileProjection;
        let finalProjectionEvidence = capturedRecoveryState.projectionEvidence;
        let finalRecentEvents = capturedRecoveryState.recentEvents;
        const restoredDurableIdentities: AcceptedInputIdentity[] = [];
        let recoveredVolatileGuards = capturedRecoveryState.volatileGuards;
        const startupFailuresToPersist = capturedRecoveryState.pendingStartupCommandFailures;

        for (const identity of candidate?.listAcceptedInputIdentities() ?? []) {
            if (
                identity.durability === 'durable' &&
                identity.fingerprint.startsWith('fp:v1:sha256:')
            ) {
                restoredDurableIdentities.push(identity);
            }
        }

        if (restoredCheckpoint && isRoomProjection(restoredCheckpoint.projection)) {
            if (
                hasVolatileDurableActiveCommandConflict(
                    restoredCheckpoint.projection,
                    volatileProjection,
                )
            ) {
                closeStorage(candidate);
                candidate = undefined;
                cutover.abort();
                scheduleStorageRecovery();

                return;
            }

            finalProjection = mergeRecoveryProjection(
                restoredCheckpoint.projection,
                volatileProjection,
            );
            finalProjectionEvidence = mergeRecoveryEvidence(
                restoredCheckpoint.projectionEvidence,
                capturedRecoveryState.projectionEvidence,
                restoredCheckpoint.projection,
                volatileProjection,
            );
            finalRecentEvents = mergeRecentEvents(
                restoredCheckpoint.recentEvents,
                capturedRecoveryState.recentEvents,
            );
            recoveredVolatileGuards = mergeVolatileGuards(
                restoredCheckpoint.volatileGuards,
                recoveredVolatileGuards,
                {
                    asOf: ingress.receivedAt,
                    retentionMs: deduplicationRetentionMs ?? defaultDeduplicationRetentionMs,
                    entryLimit: deduplicationEntryLimit ?? defaultDeduplicationEntryLimit,
                },
            );
        }

        if (startupFailuresToPersist.length > 0) {
            finalProjection = promoteStartupVolatileCommandFailures(
                finalProjection,
                startupFailuresToPersist,
            );
        }

        const durableIdentityEventIds = new Set(
            restoredDurableIdentities.map((identity) => identity.eventId),
        );
        recoveredVolatileGuards = recoveredVolatileGuards.filter(
            (identity) =>
                !durableIdentityEventIds.has(identity.eventId) &&
                !roomState.processor.hasDurableIdentity(identity.eventId) &&
                !startupFailuresToPersist.some(
                    (failure) => failure.event.eventId === identity.eventId,
                ),
        );

        const projection = finalProjection;
        const unclosedSessionGapStartedAt = conservativeSessionGapStart(interruptedRuntimeSessions);
        const outageState = storageSession.outageState();
        const gapRecordId = platformRecordId('storage.gap.recorded', generateEventId());
        const gapPayload = {
            outageStartedAt:
                unclosedSessionGapStartedAt ?? outageState.startedAt ?? previousStorage.changedAt,
            outageEndedAt: ingress.receivedAt,
            failureReason: unclosedSessionGapStartedAt
                ? 'runtime_session_interrupted'
                : (outageState.failureReason ?? previousStorage.reason),
            boundaryBasis: unclosedSessionGapStartedAt
                ? ('unclosed_session_later_bound' as const)
                : (outageState.boundaryBasis ?? ('degraded_startup_at' as const)),
            observationsBackfilled: false as const,
        };

        const recoveryOperation = (transaction: RoomStorageTransaction) => {
            const gapRecentEvent: RecentEventProjection = {
                recordId: gapRecordId,
                eventType: 'storage.gap.recorded',
                occurredAt: ingress.receivedAt,
                durability: 'durable',
                storageSequence: 0,
                source: 'backend',
                payload: gapPayload,
            };
            const storedStartupFailureRecentEvents = startupFailuresToPersist.map((failure) => {
                const record: PreparedRecord = {
                    kind: 'input_significant_fact',
                    event: failure.event,
                    processingEvidence: failure.processingEvidence,
                };
                const storageSequence = appendPreparedRecord(transaction, record);
                const recentEvent = recentEventForRecord(record, 'durable', storageSequence);

                if (!recentEvent) {
                    throw new Error('Startup command failure must produce a recent event.');
                }

                transaction.upsertAcceptedInputIdentity({
                    eventId: failure.event.eventId,
                    fingerprint: inputFingerprint(failure.event),
                    durability: 'durable',
                    acceptedAt: failure.acceptedAt,
                });

                return recentEvent;
            });
            const storedGap = transaction.appendSignificantFact({
                recordId: gapRecordId,
                eventType: 'storage.gap.recorded',
                source: 'backend',
                occurredAt: ingress.receivedAt,
                payload: gapPayload,
            });
            transaction.saveLatestRoomProjection({
                updatedAt: projection.updatedAt,
                projection,
                projectionEvidence: finalProjectionEvidence,
                volatileGuards: recoveredVolatileGuards,
                recentEvents: mergeRecentEvents(finalRecentEvents, [
                    ...storedStartupFailureRecentEvents,
                    { ...gapRecentEvent, storageSequence: storedGap.storageSequence },
                ]),
            });
            storageSession.activateRuntimeSession(transaction, ingress.receivedAt);

            for (const interruptedSession of interruptedRuntimeSessions) {
                transaction.closeRuntimeSession({
                    sessionId: interruptedSession.sessionId,
                    closedAt: ingress.receivedAt,
                });
            }

            return {
                storageSequence: storedGap.storageSequence,
                storedStartupFailureRecentEvents,
            };
        };

        const outcome =
            storageLifecycle && lifecycleProbe
                ? (() => {
                      closeStorage(candidate);
                      candidate = undefined;

                      return storageLifecycle.cutover({
                          probe: lifecycleProbe,
                          shouldAbort: () => cutover?.shouldAbort() ?? false,
                          retentionAsOf: ingress.receivedAt,
                          operation: recoveryOperation,
                      });
                  })()
                : candidate?.transact(recoveryOperation, {
                      retentionAsOf: ingress.receivedAt,
                  });

        if (!outcome) {
            throw new StorageError(
                'No storage candidate was available for recovery.',
                'fatal',
                undefined,
            );
        }

        if (outcome.status === 'indeterminate') {
            closeStorage(candidate);
            terminateForStorageOutcome(outcome.error, 'unknown');
        }

        if (outcome.status === 'aborted') {
            if (cutover.shouldAbort()) {
                storageSession.installStatus(
                    previousStorage.historyGenerationId === null
                        ? {
                              status: 'degraded',
                              changedAt: ingress.receivedAt,
                              reason: 'storage_recovery_queue_overflow',
                              historyGenerationId: null,
                              storedThroughSequence: null,
                          }
                        : {
                              status: 'degraded',
                              changedAt: ingress.receivedAt,
                              reason: 'storage_recovery_queue_overflow',
                              historyGenerationId: previousStorage.historyGenerationId,
                              storedThroughSequence: previousStorage.storedThroughSequence,
                          },
                );
                notifySnapshotListeners(ingress.receivedAt, true);
            } else {
                storageSession.installStatus(previousStorage);
                notifySnapshotListeners(ingress.receivedAt, true);
            }

            cutover.abort();
            scheduleStorageRecovery();

            return;
        }

        if (outcome.status === 'confirmed_rolled_back') {
            closeStorage(candidate);
            candidate = undefined;
            enterStorageDegraded(outcome.error, ingress.receivedAt);
            cutover.abort();

            return;
        }

        if (outcome.status !== 'committed') {
            throw new StorageError(
                `Unexpected storage recovery outcome: ${outcome.status}.`,
                'fatal',
                outcome,
            );
        }

        const committedStorage = isLifecycleCutoverCommit(outcome) ? outcome.storage : candidate;
        const committedMetadata = isLifecycleCutoverCommit(outcome) ? outcome.metadata : metadata;

        if (!committedStorage || !committedMetadata) {
            throw new StorageError(
                'Recovery committed without an active storage generation.',
                'fatal',
                outcome,
            );
        }

        closeStorage(storageSession.storage);
        storageSession.installStorage(committedStorage);
        storageSession.installVerifiedHistoryGenerationId(committedMetadata.historyGenerationId);
        roomState.installRecoveredState({
            projection: finalProjection,
            evaluatedAt: ingress.receivedAt,
            projectionEvidence: finalProjectionEvidence,
            durableIdentities: restoredDurableIdentities,
            startupCommandFailures: startupFailuresToPersist,
            volatileGuards: recoveredVolatileGuards,
            retiredIdentityEventIds: outcome.retention.retiredIdentityEventIds,
            recentEvents: mergeRecentEvents(finalRecentEvents, [
                ...outcome.value.storedStartupFailureRecentEvents,
                {
                    recordId: gapRecordId,
                    eventType: 'storage.gap.recorded',
                    occurredAt: ingress.receivedAt,
                    durability: 'durable',
                    storageSequence: outcome.value.storageSequence,
                    source: 'backend',
                    payload: gapPayload,
                },
            ]),
        });

        storageSession.installStatus({
            status: 'available',
            changedAt: ingress.receivedAt,
            historyGenerationId: committedMetadata.historyGenerationId,
            storedThroughSequence: outcome.value.storageSequence,
        });
        publication.stageRecoveryGap({
            recordId: gapRecordId,
            eventType: 'storage.gap.recorded',
            occurredAt: ingress.receivedAt,
            durability: 'durable',
            storageSequence: outcome.value.storageSequence,
            source: 'backend',
            payload: gapPayload,
        });
        storageSession.clearOutageState();
        cancelStorageRecovery();
        publication.publishRecoveryCommit();

        if (!hasConflictingActiveCommands(projection)) {
            commandController.reconcileOutboxAfterRecovery();
        }

        cutover.commit();
    } catch (error) {
        if (fatalRuntimeError()) {
            throw error;
        }

        closeStorage(candidate);
        enterStorageDegraded(error, ingress.receivedAt);
        cutover?.abort();
    }
}
