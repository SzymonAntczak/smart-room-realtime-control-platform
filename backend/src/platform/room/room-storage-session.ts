import type { PlatformStorageProjection } from '@smart-room/contracts/projections';
import { isRoomSnapshotProjection } from '@smart-room/contracts/realtime';

import type { RoomProjection } from '../read-model/room-projection';
import type {
    RoomStorage,
    RoomStorageTransaction,
    StorageCutoverOutcome,
    StorageTransactionOutcome,
} from '../storage/room-storage';
import { StorageError } from '../storage/storage-errors';

export interface RoomStorageSession {
    readonly runtimeSession: RoomRuntimeSession;
    readonly storage: RoomStorage | undefined;
    readonly status: PlatformStorageProjection;
    readonly verifiedHistoryGenerationId: string | undefined;
    outageState(): StorageOutageState;
    installStorage(storage: RoomStorage | undefined): void;
    installStatus(status: PlatformStorageProjection): void;
    installVerifiedHistoryGenerationId(generationId: string | undefined): void;
    recordStorageFailure(changedAt: string, failureReason: string): void;
    clearOutageState(): void;
    activateRuntimeSession(transaction: RoomStorageTransaction, now: string): void;
    closeRuntimeSession(closedAt: string): StorageTransactionOutcome<void> | undefined;
}

export interface RoomRuntimeSession {
    readonly sessionId: string;
    readonly sessionStartedAt: string;
    activate(transaction: RoomStorageTransaction, now: string): void;
}

export function createRoomRuntimeSession({
    generateId,
    startedAt,
}: {
    generateId(): string;
    startedAt: string;
}): RoomRuntimeSession {
    const sessionId = generateId();

    return {
        sessionId,
        sessionStartedAt: startedAt,
        activate(transaction, now) {
            if (typeof transaction.activateRuntimeSession === 'function') {
                transaction.activateRuntimeSession({
                    sessionId,
                    sessionStartedAt: startedAt,
                    lastDurableCommitAt: now,
                });
            }
        },
    };
}

export interface StorageOutageState {
    startedAt?: string;
    boundaryBasis?: 'same_process_first_degraded_at' | 'degraded_startup_at';
    failureReason?: string;
}

/** Owns process-session identity, replaceable storage and its published state. */
export function createRoomStorageSession({
    runtimeSession,
    storage,
    status,
    verifiedHistoryGenerationId,
    outageState: initialOutageState = {},
}: {
    runtimeSession: RoomRuntimeSession;
    storage: RoomStorage | undefined;
    status: PlatformStorageProjection;
    verifiedHistoryGenerationId: string | undefined;
    outageState?: StorageOutageState;
}): RoomStorageSession {
    let activeStorage = storage;
    let currentStatus = status;
    let currentVerifiedHistoryGenerationId = verifiedHistoryGenerationId;
    let currentOutageState = { ...initialOutageState };

    return {
        runtimeSession,
        get storage() {
            return activeStorage;
        },
        get status() {
            return currentStatus;
        },
        get verifiedHistoryGenerationId() {
            return currentVerifiedHistoryGenerationId;
        },
        outageState() {
            return { ...currentOutageState };
        },
        installStorage(nextStorage) {
            activeStorage = nextStorage;
        },
        installStatus(nextStatus) {
            currentStatus = nextStatus;
        },
        installVerifiedHistoryGenerationId(generationId) {
            currentVerifiedHistoryGenerationId = generationId;
        },
        recordStorageFailure(changedAt, failureReason) {
            currentOutageState.startedAt ??= changedAt;
            currentOutageState.boundaryBasis ??= 'same_process_first_degraded_at';
            currentOutageState.failureReason ??= failureReason;
        },
        clearOutageState() {
            currentOutageState = {};
        },
        activateRuntimeSession(transaction, now) {
            runtimeSession.activate(transaction, now);
        },
        closeRuntimeSession(closedAt) {
            if (!activeStorage || currentStatus.status !== 'available') {
                return undefined;
            }

            return activeStorage.transact(
                (transaction) => {
                    if (typeof transaction.closeRuntimeSession === 'function') {
                        transaction.closeRuntimeSession({
                            sessionId: runtimeSession.sessionId,
                            closedAt,
                        });
                    }
                },
                { retentionAsOf: closedAt },
            );
        },
    };
}

export function closeStorage(storage: RoomStorage | undefined): void {
    if (storage && typeof storage.close === 'function') {
        storage.close();
    }
}

export function isLifecycleCutoverCommit<Value>(
    outcome: { status: 'committed'; value: Value } | StorageCutoverOutcome<Value>,
): outcome is Extract<StorageCutoverOutcome<Value>, { status: 'committed' }> {
    return outcome.status === 'committed' && 'storage' in outcome && 'metadata' in outcome;
}

export function isFatalStorageError(error: unknown): boolean {
    return error instanceof StorageError && error.kind === 'fatal';
}

export function isDegradableStorageError(error: unknown): boolean {
    return error instanceof StorageError && error.kind !== 'fatal';
}

export function isRoomProjection(value: unknown): value is RoomProjection {
    if (
        typeof value !== 'object' ||
        value === null ||
        !('updatedAt' in value) ||
        !('devices' in value) ||
        !('activeCommands' in value) ||
        !('recentCommands' in value)
    ) {
        return false;
    }

    return isRoomSnapshotProjection({
        roomName: 'Checkpoint validation',
        updatedAt: value.updatedAt,
        devices: value.devices,
        activeCommands: value.activeCommands,
        recentCommands: value.recentCommands,
        recentEvents: [],
        platform: {
            storage: {
                status: 'available',
                changedAt: value.updatedAt,
                historyGenerationId: 'checkpoint-validation',
                storedThroughSequence: 0,
            },
        },
    });
}
