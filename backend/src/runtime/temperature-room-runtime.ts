import { randomBytes, randomUUID } from 'node:crypto';
import { clearTimeout, setTimeout } from 'node:timers';

import type {
    AcceptedCommandResponse,
    PreAdmissionCommandErrorResponse,
    RejectedCommandResponse,
    SetPowerCommandRequest,
} from '@smart-room/contracts/commands';
import type {
    DeviceScenarioAction,
    DeviceScenarioList,
    DeviceScenarioResult,
} from '@smart-room/contracts/development';
import type {
    NormalizedRawTelemetryPageQuery,
    NormalizedTrendQuery,
    RawTelemetryPage,
    SignificantFactPage,
    SignificantFactPageQuery,
    TrendResponse,
} from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomPublicationBatch } from '@smart-room/contracts/realtime';
import type {
    Clock,
    LedReceiptFailure,
    LedScenarioName,
    LedScenarioScheduler,
    TimerScheduler,
} from '@smart-room/simulator';

import type { CommandTimer } from '../platform/command-processing/set-power-command-controller';
import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import type { RoomHistoryReadResult } from '../platform/history/room-history-reader';
import {
    createRoomEngine,
    type RoomClock,
    type RoomEngine,
    type RoomSourceReceiptFailure,
} from '../platform/room/room-engine';
import type { RoomStorage, RoomStorageLifecycle } from '../platform/storage/room-storage';
import { StorageError } from '../platform/storage/storage-errors';

import { createTemperatureRoomSources } from './simulator/temperature-room-sources';

export interface TemperatureRoomRuntimeConfig {
    roomName?: string;
    intervalMs?: number;
    snapshotBroadcastIntervalMs?: number;
    clock?: Clock;
    timer?: TimerScheduler;
    sourceTimer?: TimerScheduler;
    generateEventId?: () => string;
    generateNativeMessageId?: () => string;
    diagnosticEventLimit?: number;
    deduplicationRetentionMs?: number;
    deduplicationEntryLimit?: number;
    ledScenario?: LedScenarioName;
    ledScenarioScheduler?: LedScenarioScheduler;
    commandTimer?: CommandTimer;
    generateCommandId?: () => string;
    storage?: RoomStorage;
    storageLifecycle?: RoomStorageLifecycle;
    storageFactory?: () => RoomStorage;
    recoveryTimer?: TimerScheduler;
    storageRecoveryProbeIntervalMs?: number;
    storageRecoveryQueueLimit?: number;
    historyCursorSecret?: Uint8Array;
    operationalLog?: (entry: Record<string, unknown>) => void;
    onFatalStorageError?: (error: unknown) => never;
}

export interface TemperatureRoomRuntime {
    start(): void;
    stop(): void;
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
    readSignificantFactPage(
        query: SignificantFactPageQuery,
    ): RoomHistoryReadResult<SignificantFactPage>;
    readRawTelemetryPage(
        query: NormalizedRawTelemetryPageQuery,
    ): RoomHistoryReadResult<RawTelemetryPage>;
    readTrend(query: NormalizedTrendQuery): RoomHistoryReadResult<TrendResponse>;
    subscribeRoomSnapshot(listener: RoomSnapshotListener): () => void;
    subscribeRoomPublicationBatch(listener: RoomPublicationBatchListener): () => void;
    getDeviceScenarios(deviceId: string): DeviceScenarioList | undefined;
    runDeviceScenario(deviceId: string, action: DeviceScenarioAction): DeviceScenarioResult;
    requestCommand(
        request: SetPowerCommandRequest,
    ): AcceptedCommandResponse | RejectedCommandResponse | PreAdmissionCommandErrorResponse;
}

export type RoomSnapshotListener = (snapshot: RoomSnapshotProjection) => void;
export type RoomPublicationBatchListener = (batch: RoomPublicationBatch) => void;

export function createTemperatureRoomRuntime({
    roomName,
    intervalMs = 10_000,
    snapshotBroadcastIntervalMs,
    clock = realClock,
    timer,
    sourceTimer,
    generateEventId,
    generateNativeMessageId = randomUUID,
    diagnosticEventLimit,
    deduplicationRetentionMs,
    deduplicationEntryLimit,
    ledScenario = 'confirm_immediately',
    ledScenarioScheduler = realLedScenarioScheduler,
    commandTimer,
    generateCommandId,
    storage,
    storageLifecycle,
    storageFactory,
    recoveryTimer,
    storageRecoveryProbeIntervalMs,
    storageRecoveryQueueLimit,
    historyCursorSecret = randomBytes(32),
    operationalLog,
    onFatalStorageError,
}: TemperatureRoomRuntimeConfig = {}): TemperatureRoomRuntime {
    const sources = createTemperatureRoomSources({
        intervalMs,
        clock,
        timer: sourceTimer ?? timer,
        generateNativeMessageId,
        ledScenario,
        ledScenarioScheduler,
        emitEvent(event) {
            requireEngine().receiveSourceEvent(event);
        },
        getRoomSnapshot() {
            return requireEngine().getRoomSnapshot();
        },
        getActiveStorage() {
            return requireEngine().getAvailableStorage();
        },
        onReceiptFailure(failure) {
            const mappedFailure = mapReceiptFailure(failure);
            operationalLog?.({
                event: 'simulator_command_receipt_failure',
                source: mappedFailure.source,
                commandId: mappedFailure.commandId,
                deviceId: mappedFailure.deviceId,
                operation: mappedFailure.operation,
                reason:
                    mappedFailure.outcome === 'inspection_unavailable'
                        ? 'receipt_prior_acceptance_unknown'
                        : mappedFailure.outcome === 'confirmed_rolled_back'
                          ? 'receipt_write_rolled_back'
                          : 'storage_commit_outcome_unknown',
                storageFailureKind:
                    mappedFailure.error instanceof StorageError
                        ? mappedFailure.error.kind
                        : 'unknown',
            });
            requireEngine().reportSourceReceiptFailure(mappedFailure);
        },
    });
    const engine = createRoomEngine({
        roomName,
        snapshotBroadcastIntervalMs,
        clock,
        timer,
        generateEventId,
        diagnosticEventLimit,
        deduplicationRetentionMs,
        deduplicationEntryLimit,
        commandTimer,
        generateCommandId,
        storage,
        storageLifecycle,
        storageFactory,
        recoveryTimer,
        storageRecoveryProbeIntervalMs,
        storageRecoveryQueueLimit,
        historyCursorSecret,
        operationalLog,
        onFatalStorageError,
        devices: sources.devices,
        routes: [
            {
                deviceId: 'led-main',
                target: 'simulator-adapter',
                automaticRetry: 'durable_source_receipt',
                dispatcher: sources.commandDispatcher,
            },
        ],
        sources,
    });

    return {
        start: () => requireEngine().start(),
        stop: () => requireEngine().stop(),
        getRoomSnapshot: () => requireEngine().getRoomSnapshot(),
        getDiagnosticsSnapshot: () => requireEngine().getDiagnosticsSnapshot(),
        readSignificantFactPage: (query) => requireEngine().readSignificantFactPage(query),
        readRawTelemetryPage: (query) => requireEngine().readRawTelemetryPage(query),
        readTrend: (query) => requireEngine().readTrend(query),
        subscribeRoomSnapshot: (listener) => requireEngine().subscribeRoomSnapshot(listener),
        subscribeRoomPublicationBatch: (listener) =>
            requireEngine().subscribeRoomPublicationBatch(listener),
        getDeviceScenarios: (deviceId) => sources.getDeviceScenarios(deviceId),
        runDeviceScenario(deviceId, action) {
            requireEngine().assertHealthy();

            if (!requireEngine().isStarted()) {
                throw new Error(
                    'Temperature room runtime must be started before running a scenario.',
                );
            }

            return sources.runDeviceScenario(deviceId, action);
        },
        requestCommand: (request) => requireEngine().requestCommand(request),
    };

    function requireEngine(): RoomEngine {
        return engine;
    }
}

function mapReceiptFailure(failure: LedReceiptFailure): RoomSourceReceiptFailure {
    return {
        source: 'simulator-led',
        commandId: failure.commandId,
        deviceId: 'led-main',
        operation: failure.operation,
        outcome:
            failure.outcome === 'indeterminate'
                ? 'indeterminate'
                : failure.outcome === 'confirmed_rolled_back'
                  ? 'confirmed_rolled_back'
                  : 'inspection_unavailable',
        error: failure.error,
    };
}

const realClock: RoomClock = {
    now() {
        return new Date().toISOString();
    },
};

const realLedScenarioScheduler: LedScenarioScheduler = {
    setTimeout(callback, delayMs) {
        return setTimeout(callback, delayMs);
    },
    clearTimeout(timerHandle) {
        clearTimeout(timerHandle as ReturnType<typeof setTimeout>);
    },
};
