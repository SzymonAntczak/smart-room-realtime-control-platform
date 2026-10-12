import type { CommandFailedEvent } from '@smart-room/contracts/events';
import type { RecentEventProjection } from '@smart-room/contracts/history';

import { inputFingerprint } from '../event-processing/event-identity';
import type { EventProcessingDiagnostics } from '../event-processing/event-processing-diagnostics';
import type { EventProcessor, PreparedRecord } from '../event-processing/event-processor';
import type {
    RoomProjection,
    RoomProjectionEvidence,
    RoomProjector,
} from '../read-model/room-projection';
import type { AcceptedInputIdentity } from '../storage/room-storage';

export interface PendingStartupVolatileCommandFailure {
    event: CommandFailedEvent;
    acceptedAt: string;
    processingEvidence: Extract<
        NonNullable<
            Extract<PreparedRecord, { kind: 'input_significant_fact' }>['processingEvidence']
        >,
        { kind: 'command_intent' }
    >;
}

export interface RoomState {
    readonly projector: RoomProjector;
    readonly processor: EventProcessor;
    readonly diagnostics: EventProcessingDiagnostics;
    recentEvents(): RecentEventProjection[];
    installRecentEvents(events: readonly RecentEventProjection[]): void;
    pendingStartupCommandFailures(): PendingStartupVolatileCommandFailure[];
    recordStartupCommandFailure(failure: PendingStartupVolatileCommandFailure): void;
    clearStartupCommandFailures(): void;
    captureRecoveryState(evaluatedAt: string): RoomRecoveryState;
    installRecoveredState(state: RecoveredRoomState): void;
}

export interface RoomRecoveryState {
    projection: RoomProjection;
    projectionEvidence: RoomProjectionEvidence;
    recentEvents: RecentEventProjection[];
    volatileGuards: AcceptedInputIdentity[];
    pendingStartupCommandFailures: PendingStartupVolatileCommandFailure[];
}

export interface RecoveredRoomState {
    projection: RoomProjection;
    evaluatedAt: string;
    projectionEvidence: RoomProjectionEvidence;
    recentEvents: readonly RecentEventProjection[];
    durableIdentities: readonly AcceptedInputIdentity[];
    startupCommandFailures: readonly PendingStartupVolatileCommandFailure[];
    volatileGuards: readonly AcceptedInputIdentity[];
    retiredIdentityEventIds: readonly string[];
}

/** Owns the mutable, cross-operation room history and startup recovery evidence. */
export function createRoomState({
    projector,
    processor,
    diagnostics,
    initialRecentEvents,
}: {
    projector: RoomProjector;
    processor: EventProcessor;
    diagnostics: EventProcessingDiagnostics;
    initialRecentEvents: readonly RecentEventProjection[];
}): RoomState {
    let currentRecentEvents = [...initialRecentEvents];
    const startupCommandFailures: PendingStartupVolatileCommandFailure[] = [];

    return {
        projector,
        processor,
        diagnostics,
        recentEvents() {
            return [...currentRecentEvents];
        },
        installRecentEvents(events) {
            currentRecentEvents = [...events];
        },
        pendingStartupCommandFailures() {
            return [...startupCommandFailures];
        },
        recordStartupCommandFailure(failure) {
            startupCommandFailures.push(failure);
        },
        clearStartupCommandFailures() {
            startupCommandFailures.length = 0;
        },
        captureRecoveryState(evaluatedAt) {
            return {
                projection: projector.getProjection({ evaluatedAt }),
                projectionEvidence: projector.getEvidence(),
                recentEvents: [...currentRecentEvents],
                volatileGuards: processor.listVolatileIdentities(),
                pendingStartupCommandFailures: [...startupCommandFailures],
            };
        },
        installRecoveredState(state) {
            projector.installProjection(
                state.projection,
                state.evaluatedAt,
                state.projectionEvidence,
            );

            for (const identity of state.durableIdentities) {
                processor.rememberDurableIdentity(
                    identity.eventId,
                    identity.fingerprint as `fp:v1:sha256:${string}`,
                    identity.acceptedAt,
                );
            }

            for (const failure of state.startupCommandFailures) {
                processor.rememberDurableIdentity(
                    failure.event.eventId,
                    inputFingerprint(failure.event),
                    failure.acceptedAt,
                );
            }

            for (const identity of state.volatileGuards) {
                processor.rememberVolatileIdentity(
                    identity.eventId,
                    identity.fingerprint as `fp:v1:sha256:${string}`,
                    identity.acceptedAt,
                    identity.processingEvidence,
                );
            }

            processor.forgetDurableIdentities(state.retiredIdentityEventIds);
            currentRecentEvents = [...state.recentEvents];
            startupCommandFailures.length = 0;
        },
    };
}
