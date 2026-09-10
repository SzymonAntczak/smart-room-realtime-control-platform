import { randomUUID } from 'node:crypto';
import { clearInterval, setInterval, setTimeout } from 'node:timers';

import {
    type AcceptedCommandResponse,
    type PreAdmissionCommandErrorResponse,
    type RejectedCommandResponse,
    selectRecentCommands,
    type SetPowerCommandRequest,
} from '@smart-room/contracts/commands';
import {
    deviceConnectionScenarioActions,
    deviceHealthScenarioActions,
    type DeviceScenarioAction,
    type DeviceScenarioList,
    type DeviceScenarioResult,
    ledScenarioActions,
    temperatureScenarioActions,
} from '@smart-room/contracts/development';
import type { CommandFailedEvent, PlatformEvent } from '@smart-room/contracts/events';
import {
    compareRecentEventsDescending,
    type RecentEventProjection,
} from '@smart-room/contracts/history';
import type {
    PlatformStorageProjection,
    RoomSnapshotProjection,
} from '@smart-room/contracts/projections';
import {
    isRoomSnapshotProjection,
    type RoomPublicationBatch,
    type RoomPublicationDelta,
} from '@smart-room/contracts/realtime';
import {
    type Clock,
    createLedScenario,
    createTemperatureSensorRuntime,
    createTemperatureSensorScenario,
    type LedCommandReceiptPort,
    type LedReceiptFailure,
    type LedScenarioName,
    type LedScenarioScheduler,
    type TemperatureSensorRuntime,
    type TimerScheduler,
} from '@smart-room/simulator';

import {
    createSimulatorLedAdapter,
    type SimulatorLedAdapter,
} from '../adapters/simulator/led/led-adapter';
import { createSqliteLedCommandReceiptPort } from '../adapters/simulator/led/sqlite-led-command-receipt-port';
import {
    createSimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapter,
} from '../adapters/simulator/temperature/temperature-adapter';
import {
    type CommandOutboxMutation,
    type CommandTimer,
    createSetPowerCommandController,
} from '../platform/command-processing/set-power-command-controller';
import {
    defaultDeduplicationEntryLimit,
    defaultDeduplicationRetentionMs,
} from '../platform/event-processing/event-deduplicator';
import {
    derivedCommandRecordId,
    inputFingerprint,
    logicalRecordId,
    platformRecordId,
} from '../platform/event-processing/event-identity';
import {
    createEventProcessingDiagnostics,
    type EventProcessingDiagnosticsSnapshot,
} from '../platform/event-processing/event-processing-diagnostics';
import {
    createEventProcessor,
    type DeviceDefinition,
    type EventIngress,
    type EventProcessingResult,
    type PreparedRecord,
} from '../platform/event-processing/event-processor';
import { commandAvailabilityFor } from '../platform/read-model/command-availability';
import {
    createRoomProjector,
    type RoomProjection,
    type RoomProjectionEvidence,
    type RoomProjector,
} from '../platform/read-model/room-projection';
import type {
    AcceptedInputIdentity,
    RoomStorage,
    RoomStorageLifecycle,
    RoomStorageTransaction,
    RuntimeSession,
    StorageCutoverOutcome,
    StorageMetadata,
} from '../platform/storage/room-storage';
import { StorageAvailabilityError, StorageError } from '../platform/storage/storage-errors';

import { createRoomInputCoordinator } from './room-input-coordinator';

export interface TemperatureRoomRuntimeConfig {
    roomName?: string;
    intervalMs?: number;
    snapshotBroadcastIntervalMs?: number;
    clock?: Clock;
    timer?: TimerScheduler;
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
    operationalLog?: (entry: Record<string, unknown>) => void;
    onFatalStorageError?: (error: unknown) => never;
}

interface TemperatureSensorDefinition extends DeviceDefinition {
    nativeSensorId: string;
    baseTemperature: number;
    intervalMsMultiplier: number;
}

export interface TemperatureRoomRuntime {
    start(): void;
    stop(): void;
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
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

interface OperationalLogCorrelation {
    eventId?: string;
    commandId?: string;
    deviceId?: string;
    source?: string;
    reason?: string;
}

const defaultSensors: readonly TemperatureSensorDefinition[] = [
    {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
        nativeSensorId: 'temp-desk-native',
        baseTemperature: 22,
        intervalMsMultiplier: 1,
    },
    {
        deviceId: 'temp-window',
        name: 'Window Temperature',
        role: 'temperature-sensor',
        nativeSensorId: 'temp-window-native',
        baseTemperature: 20,
        intervalMsMultiplier: 2,
    },
];

const readingPattern = [0, 0.2, 0.4, 0.1, -0.1, -0.3] as const;
const volatileCommandLostOnRestartReason = 'volatile_command_lost_on_restart';
const volatileCommandLostOnRestartMessage =
    'The volatile command was lost when the backend restarted.';

interface PendingStartupVolatileCommandFailure {
    event: CommandFailedEvent;
    acceptedAt: string;
}

function isTemperatureScenarioAction(
    action: DeviceScenarioAction,
): action is (typeof temperatureScenarioActions)[number] {
    return temperatureScenarioActions.some((candidate) => candidate === action);
}

function isLedScenarioAction(
    action: DeviceScenarioAction,
): action is (typeof ledScenarioActions)[number] {
    return ledScenarioActions.some((candidate) => candidate === action);
}

function isLedDeviceStateScenarioAction(
    action: (typeof ledScenarioActions)[number],
): action is
    | (typeof deviceConnectionScenarioActions)[number]
    | (typeof deviceHealthScenarioActions)[number] {
    return (
        deviceConnectionScenarioActions.some((candidate) => candidate === action) ||
        deviceHealthScenarioActions.some((candidate) => candidate === action)
    );
}

export function createTemperatureRoomRuntime({
    roomName = 'Smart Room',
    intervalMs = 1000,
    snapshotBroadcastIntervalMs = 1000,
    clock = realClock,
    timer,
    generateEventId = randomUUID,
    generateNativeMessageId = randomUUID,
    diagnosticEventLimit,
    deduplicationRetentionMs,
    deduplicationEntryLimit,
    ledScenario = 'confirm_immediately',
    ledScenarioScheduler = realLedScenarioScheduler,
    commandTimer = realCommandTimer,
    generateCommandId = randomUUID,
    storage,
    storageLifecycle,
    storageFactory,
    recoveryTimer = timer,
    storageRecoveryProbeIntervalMs = 5_000,
    storageRecoveryQueueLimit = 1_000,
    operationalLog = () => {},
    onFatalStorageError = (error): never => {
        throw error;
    },
}: TemperatureRoomRuntimeConfig = {}): TemperatureRoomRuntime {
    const sensors = defaultSensors.map((definition) => ({
        definition,
        sensor: createTemperatureSensorScenario({
            sensorId: definition.nativeSensorId,
            baseTemperature: definition.baseTemperature,
            readingPattern,
            generateMessageId: generateNativeMessageId,
        }),
        runtime: undefined as TemperatureSensorRuntime | undefined,
        adapter: undefined as SimulatorTemperatureAdapter | undefined,
    }));
    const devices: DeviceDefinition[] = defaultSensors.map(({ deviceId, name, role }) => ({
        deviceId,
        name,
        role,
    }));
    devices.push({ deviceId: 'led-main', name: 'Main LED', role: 'led-output' });
    let led: ReturnType<typeof createLedScenario> | undefined;
    let ledAdapter: SimulatorLedAdapter | undefined;
    const resolvedStorageFactory = storageFactory;
    let initialStorage = storage;
    let startupStorageFactoryError: unknown;
    let initialStorageMetadata: StorageMetadata | undefined;
    const runtimeSessionId = randomUUID();
    const runtimeSessionStartedAt = clock.now();

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
        devices,
        initialUpdatedAt: runtimeSessionStartedAt,
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
        runtimeSessionStartedAt,
        {
            runtimeSessionId,
            sessionStartedAt: runtimeSessionStartedAt,
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
        devices,
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
    const startupStorageFailureReason =
        startupStorageError instanceof StorageError &&
        startupStorageError.kind === 'manual_intervention'
            ? 'storage_manual_intervention_required'
            : initialStorage || resolvedStorageFactory || storageLifecycle
              ? 'storage_write_failed'
              : 'storage_not_configured';

    let storageState: PlatformStorageProjection =
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

    let recentEvents: RecentEventProjection[] = initializedCheckpoint?.recentEvents ?? [];
    let pendingStartupVolatileCommandFailures: PendingStartupVolatileCommandFailure[] = [];
    let recoveryGapForPublication: RecentEventProjection | undefined;
    let activeStorage = initialStorage;
    let verifiedHistoryGenerationId = initialStorageMetadata?.historyGenerationId;
    let recoveryTimerHandle: unknown | undefined;
    let outageStartedAt = storageState.status === 'degraded' ? storageState.changedAt : undefined;
    let outageBoundaryBasis: 'same_process_first_degraded_at' | 'degraded_startup_at' | undefined =
        storageState.status === 'degraded' ? 'degraded_startup_at' : undefined;
    let outageFailureReason = storageState.status === 'degraded' ? storageState.reason : undefined;
    const storageRecoveryTimer = recoveryTimer ?? realTimer;

    if (storageState.status === 'degraded' && !initializedCheckpoint?.restored) {
        roomProjector.installProjection(
            withBootstrapDurability(roomProjector.getProjection(), 'volatile'),
            clock.now(),
            roomProjector.getEvidence(),
        );
    }

    for (const sensorEntry of sensors) {
        sensorEntry.runtime = createTemperatureSensorRuntime({
            sensor: sensorEntry.sensor,
            intervalMs: intervalMs * sensorEntry.definition.intervalMsMultiplier,
            clock,
            timer,
        });
    }

    const snapshotBroadcastTimer = timer ?? (realTimer as TimerScheduler);
    const snapshotListeners = new Set<RoomSnapshotListener>();
    const publicationBatchListeners = new Set<RoomPublicationBatchListener>();
    let bufferedAdapterEvents: Array<{ event: PlatformEvent; receivedAt: string }> | undefined;
    let hasStarted = false;
    let snapshotBroadcastTimerHandle: unknown | undefined;
    let lastPublishedSnapshot: RoomSnapshotProjection | undefined;
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
        routes: [
            {
                deviceId: 'led-main',
                target: 'simulator-adapter',
                automaticRetry: 'durable_source_receipt',
                dispatcher: {
                    dispatch(command, context) {
                        if (!hasStarted || !ledAdapter) {
                            throw new Error('The LED adapter is not available.');
                        }

                        return ledAdapter.dispatch(command, context);
                    },
                },
            },
        ],
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
            return activeStorage &&
                typeof activeStorage.listCommandDispatchOutboxIntents === 'function'
                ? activeStorage.listCommandDispatchOutboxIntents()
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

    closeRestoredVolatileCommands();

    return {
        start() {
            assertRuntimeIsHealthy();

            if (hasStarted) {
                return;
            }

            inputCoordinator.openIntake();
            hasStarted = true;
            const startedLed = attachLedScenario('off');
            startedLed.restoreDurablePlans();
            startedLed.reportAvailability('online', clock.now());
            startedLed.reportCurrentState(clock.now());
            commandController.reschedulePendingCommands();

            if (storageState.status === 'available') {
                commandController.reconcileOutboxAfterRecovery();
            } else {
                scheduleStorageRecovery();
            }

            for (const sensorEntry of sensors) {
                sensorEntry.adapter = createAdapter(sensorEntry);
                sensorEntry.sensor.reportAvailability('online', clock.now());
                sensorEntry.sensor.tick(clock.now());
            }

            snapshotBroadcastTimerHandle = snapshotBroadcastTimer.setInterval(() => {
                inputCoordinator.receiveTimer((ingress) => {
                    notifyFreshnessChanges(ingress);
                });
            }, snapshotBroadcastIntervalMs);

            for (const sensorEntry of sensors) {
                sensorEntry.runtime?.start();
            }
        },
        stop() {
            for (const sensorEntry of sensors) {
                sensorEntry.runtime?.stop();
            }

            if (snapshotBroadcastTimerHandle !== undefined) {
                snapshotBroadcastTimer.clearInterval(snapshotBroadcastTimerHandle);
                snapshotBroadcastTimerHandle = undefined;
            }

            if (recoveryTimerHandle !== undefined) {
                storageRecoveryTimer.clearInterval(recoveryTimerHandle);
                recoveryTimerHandle = undefined;
            }

            for (const sensorEntry of sensors) {
                sensorEntry.adapter?.stop();
                sensorEntry.adapter = undefined;
            }

            ledAdapter?.stop();
            ledAdapter = undefined;
            led?.stop();
            led = undefined;

            commandController.stop();
            const inputShutdown = inputCoordinator.closeIntakeAndDrain();

            if (inputShutdown.status === 'drained') {
                closeRuntimeSession();
            }

            closeStorage(activeStorage);
            activeStorage = undefined;
            hasStarted = false;
        },
        getRoomSnapshot() {
            return snapshotAt(clock.now());
        },
        getDiagnosticsSnapshot() {
            return diagnostics.getSnapshot();
        },
        subscribeRoomSnapshot(listener) {
            snapshotListeners.add(listener);

            return () => {
                snapshotListeners.delete(listener);
            };
        },
        subscribeRoomPublicationBatch(listener) {
            publicationBatchListeners.add(listener);

            return () => {
                publicationBatchListeners.delete(listener);
            };
        },
        getDeviceScenarios(deviceId) {
            if (deviceId === 'led-main') {
                return { deviceId, scenarios: ledScenarioActions.map((action) => ({ action })) };
            }

            if (!findSensor(deviceId)) {
                return undefined;
            }

            return {
                deviceId,
                scenarios: temperatureScenarioActions.map((action) => ({ action })),
            };
        },
        runDeviceScenario(deviceId, action) {
            assertRuntimeIsHealthy();

            if (!hasStarted) {
                throw new Error(
                    'Temperature room runtime must be started before running a scenario.',
                );
            }

            if (deviceId === 'led-main') {
                if (!isLedScenarioAction(action)) {
                    throw new Error(`No development scenarios are configured for ${deviceId}.`);
                }

                if (
                    !isLedDeviceStateScenarioAction(action) &&
                    getCurrentRoomSnapshot().activeCommands.some(
                        (command) => command.deviceId === deviceId,
                    )
                ) {
                    throw Object.assign(
                        new Error(
                            'Wait for the active LED command before selecting another scenario.',
                        ),
                        { code: 'scenario_conflict' },
                    );
                }

                if (action === 'degrade_device') {
                    led?.reportHealth('degraded', 'command_blocked', clock.now());
                } else if (action === 'recover_device') {
                    led?.reportHealth('healthy', 'recovered', clock.now());
                } else if (action === 'disconnect_device') {
                    led?.reportAvailability('offline', clock.now());
                } else if (action === 'reconnect_device') {
                    led?.reportAvailability('online', clock.now());
                } else {
                    led?.setNextCommandScenario(action as LedScenarioName);
                }

                return { action, status: 'completed' };
            }

            const sensorEntry = findSensor(deviceId);

            if (!sensorEntry || !isTemperatureScenarioAction(action)) {
                throw new Error(`No development scenarios are configured for ${deviceId}.`);
            }

            if (action === 'disconnect_device') {
                sensorEntry.sensor.disconnect(clock.now());
            } else if (action === 'reconnect_device') {
                sensorEntry.sensor.reconnect(clock.now());
            } else if (action === 'degrade_device') {
                sensorEntry.sensor.reportHealth('degraded', 'partial_data', clock.now());
            } else if (action === 'recover_device') {
                sensorEntry.sensor.reportHealth('healthy', 'recovered', clock.now());
            } else {
                if (sensorEntry.sensor.isOffline()) {
                    throw Object.assign(
                        new Error('Reconnect the device before running telemetry scenarios.'),
                        { code: 'device_offline' },
                    );
                }

                runScenarioAction(sensorEntry, action, clock.now());
            }

            return {
                action,
                status: 'completed',
            };
        },
        requestCommand(request) {
            assertRuntimeIsHealthy();

            return commandController.requestCommand(request);
        },
    };

    function runScenarioAction(
        sensorEntry: (typeof sensors)[number],
        action: Exclude<
            (typeof temperatureScenarioActions)[number],
            | (typeof deviceConnectionScenarioActions)[number]
            | (typeof deviceHealthScenarioActions)[number]
        >,
        observedAt: string,
    ): void {
        const scenarioHandlers = {
            pause_telemetry() {
                sensorEntry.runtime?.stop();
            },
            resume_telemetry() {
                sensorEntry.runtime?.start();
            },
            replay_last_reading() {
                sensorEntry.sensor.replayLastReading();
            },
            emit_invalid_reading(observedAt: string) {
                sensorEntry.sensor.emitInvalidReading(observedAt);
            },
            emit_next_reading(observedAt: string) {
                sensorEntry.sensor.tick(observedAt);
            },
            emit_future_dated_reading(observedAt: string) {
                sensorEntry.sensor.emitFutureDatedReading(
                    new Date(Date.parse(observedAt) + 2_000).toISOString(),
                );
            },
            reset(observedAt: string) {
                sensorEntry.runtime?.stop();
                sensorEntry.adapter?.stop();
                sensorEntry.sensor.reset();
                sensorEntry.adapter = createAdapter(sensorEntry);
                sensorEntry.sensor.tick(observedAt);
                sensorEntry.runtime?.start();
            },
        } satisfies Record<
            Exclude<
                (typeof temperatureScenarioActions)[number],
                | (typeof deviceConnectionScenarioActions)[number]
                | (typeof deviceHealthScenarioActions)[number]
            >,
            (observedAt: string) => void
        >;

        scenarioHandlers[action](observedAt);
    }

    function createAdapter(sensorEntry: (typeof sensors)[number]): SimulatorTemperatureAdapter {
        return createSimulatorTemperatureAdapter({
            sensor: sensorEntry.sensor,
            nativeSensorId: sensorEntry.definition.nativeSensorId,
            platformDeviceId: sensorEntry.definition.deviceId,
            emitEvent(event) {
                receiveAdapterEvent(event);
            },
        });
    }

    function attachLedScenario(initialPower: 'on' | 'off'): ReturnType<typeof createLedScenario> {
        led = createLedScenario({
            deviceId: 'led-main-native',
            initialPower,
            scenario: ledScenario,
            clock,
            scheduler: ledScenarioScheduler,
            generateMessageId: generateNativeMessageId,
            receiptPort: createActiveStorageReceiptPort(),
            onReceiptFailure(failure) {
                handleLedReceiptFailure(failure);
            },
        });
        ledAdapter = createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            clock,
            emitEvent(event) {
                receiveAdapterEvent(event);
            },
        });

        return led;
    }

    function createActiveStorageReceiptPort(): LedCommandReceiptPort {
        const unavailable = () => ({
            status: 'inspection_unavailable' as const,
            error: new StorageAvailabilityError(
                'Storage is unavailable for LED receipt handling.',
                undefined,
            ),
        });

        const withActiveStorage = <Value>(
            operation: (port: LedCommandReceiptPort) => Value,
        ): Value | ReturnType<typeof unavailable> => {
            if (!activeStorage || storageState.status !== 'available') {
                return unavailable();
            }

            return operation(createSqliteLedCommandReceiptPort({ storage: activeStorage, clock }));
        };

        return {
            accept(candidate) {
                return withActiveStorage((port) => port.accept(candidate));
            },
            markTerminal(receipt) {
                return withActiveStorage((port) => port.markTerminal(receipt));
            },
            list() {
                return withActiveStorage((port) => port.list());
            },
        };
    }

    function findSensor(deviceId: string): (typeof sensors)[number] | undefined {
        return sensors.find((sensorEntry) => sensorEntry.definition.deviceId === deviceId);
    }

    function notifySnapshotListeners(
        evaluatedAt: string,
        installedProjectionOnly = false,
        platformBeforeOutcome = false,
    ): void {
        const snapshot = installedProjectionOnly ? installedSnapshot() : snapshotAt(evaluatedAt);
        publishSnapshot(
            snapshot,
            buildPublicationDeltas(lastPublishedSnapshot, snapshot, platformBeforeOutcome),
        );
    }

    function publishSnapshot(
        snapshot: RoomSnapshotProjection,
        deltas: RoomPublicationBatch['deltas'],
    ): void {
        lastPublishedSnapshot = snapshot;
        // Freeze both audiences before invoking either callback kind. A
        // reentrant snapshot subscriber must observe the installed baseline,
        // not receive deltas belonging to the batch that installed it.
        const snapshotAudience = [...snapshotListeners];
        const batchAudience = [...publicationBatchListeners];

        for (const listener of snapshotAudience) {
            try {
                listener(snapshot);
            } catch {
                // A failed realtime client must not block event ingestion or other clients.
            }
        }

        // Snapshot listeners installed while a batch is in progress observe
        // its already-installed snapshot, but must not receive its deltas.
        for (const listener of batchAudience) {
            try {
                listener({ snapshot, deltas });
            } catch {
                // A failed realtime client must not block event ingestion or other clients.
            }
        }
    }

    function notifyFreshnessChanges(ingress: EventIngress): void {
        assertRuntimeIsHealthy();
        const evaluatedAt = ingress.receivedAt;
        const snapshot = snapshotAt(evaluatedAt);
        const previousSnapshot = lastPublishedSnapshot;

        if (previousSnapshot && !hasObservationStatusChange(previousSnapshot, snapshot)) {
            return;
        }

        const prepared = processor.prepareFreshnessProjection(ingress);
        let platformBeforeOutcome = false;

        if (activeStorage && storageState.status === 'available') {
            const outcome = activeStorage.transact((transaction) => {
                const retiredIdentityEventIds =
                    transaction.retireExpiredRecords({ asOf: evaluatedAt }) ?? [];
                transaction.saveLatestRoomProjection({
                    updatedAt: prepared.candidateState.updatedAt,
                    projection: prepared.candidateState,
                    projectionEvidence: prepared.candidateEvidence,
                    volatileGuards: processor.listVolatileIdentities(),
                    recentEvents,
                });
                touchRuntimeSession(transaction, evaluatedAt);

                return { retiredIdentityEventIds };
            });

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
                processor.forgetDurableIdentities(outcome.value.retiredIdentityEventIds);
            }
        }

        processor.commitPreparedProjection(prepared);

        notifySnapshotListeners(evaluatedAt, false, platformBeforeOutcome);
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
        const prepared = processor.prepareEvent(
            event,
            ingress,
            storageState.status === 'available' ? 'available' : 'degraded',
        );
        const durablePreparedState = processor.materializePreparedState(prepared, 'durable');
        let result: EventProcessingResult;
        let platformBeforeOutcome = false;

        if (activeStorage && storageState.status === 'available') {
            const outcome = activeStorage.transact((transaction) => {
                let storedThroughSequence: number | undefined;
                const storedRecentEvents: RecentEventProjection[] = [];

                if (prepared.kind === 'quarantined') {
                    transaction.appendQuarantineEntry({
                        eventId: event.eventId,
                        reason:
                            prepared.result.status === 'ignored'
                                ? prepared.result.reason
                                : 'rejected',
                        recordedAt: receivedAt,
                        rawEvent: event,
                    });
                } else if (prepared.eventId) {
                    for (const record of prepared.records) {
                        storedThroughSequence = appendPreparedRecord(transaction, record);
                        const recentEvent = recentEventForRecord(
                            record,
                            'durable',
                            storedThroughSequence,
                        );

                        if (recentEvent) {
                            storedRecentEvents.push(recentEvent);
                        }
                    }

                    transaction.upsertAcceptedInputIdentity({
                        eventId: prepared.eventId,
                        fingerprint: prepared.fingerprint ?? inputFingerprint(event),
                        durability: 'durable',
                        acceptedAt: receivedAt,
                    });
                }

                const retiredIdentityEventIds =
                    transaction.retireExpiredRecords({ asOf: receivedAt }) ?? [];

                if (prepared.kind !== 'quarantined') {
                    if (outboxMutation?.kind === 'upsert') {
                        transaction.upsertCommandDispatchOutboxIntent(outboxMutation.intent);
                    } else if (outboxMutation?.kind === 'close') {
                        transaction.closeCommandDispatchOutboxIntent(outboxMutation);
                    } else {
                        const terminalClosure = terminalOutboxClosure(event, prepared.records);

                        if (terminalClosure) {
                            transaction.closeCommandDispatchOutboxIntent(terminalClosure);
                        }
                    }

                    transaction.saveLatestRoomProjection({
                        updatedAt: durablePreparedState.updatedAt,
                        projection: durablePreparedState,
                        projectionEvidence:
                            prepared.candidateEvidence ?? roomProjector.getEvidence(),
                        volatileGuards: volatileGuardsForCheckpoint(prepared),
                        recentEvents: mergeRecentEvents(recentEvents, storedRecentEvents),
                    });
                    touchRuntimeSession(transaction, receivedAt);
                }

                return { storedThroughSequence, retiredIdentityEventIds, storedRecentEvents };
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
                enterStorageDegraded(
                    outcome.error,
                    receivedAt,
                    false,
                    correlationForEvent(event),
                );
                platformBeforeOutcome = true;
                result = processor.commitPrepared(prepared, 'volatile');
                rememberVolatileIdentity(prepared, receivedAt);
                recentEvents = mergeRecentEvents(
                    recentEvents,
                    recentEventsForRecords(prepared.records, 'volatile'),
                );
            } else {
                result = processor.commitPrepared(prepared);
                recentEvents = mergeRecentEvents(recentEvents, outcome.value.storedRecentEvents);
                processor.forgetDurableIdentities(outcome.value.retiredIdentityEventIds);

                if (
                    prepared.eventId &&
                    prepared.fingerprint &&
                    !outcome.value.retiredIdentityEventIds.includes(prepared.eventId)
                ) {
                    processor.rememberDurableIdentity(
                        prepared.eventId,
                        prepared.fingerprint,
                        receivedAt,
                    );
                }

                storageState = {
                    status: 'available',
                    changedAt: storageState.changedAt,
                    historyGenerationId: storageState.historyGenerationId,
                    storedThroughSequence:
                        outcome.value.storedThroughSequence ?? storageState.storedThroughSequence,
                };
            }
        } else {
            result = processor.commitPrepared(prepared, 'volatile');
            rememberVolatileIdentity(prepared, receivedAt);
            recentEvents = mergeRecentEvents(
                recentEvents,
                recentEventsForRecords(prepared.records, 'volatile'),
            );
        }

        diagnostics.recordProcessingResult(event, result);
        logEventProcessingOutcome(event, prepared, result);
        commandController.onEventProcessed(activeCommandIdBeforeEvent, event, result);

        if (result.status === 'accepted' || prepared.kind === 'accepted_non_applying') {
            notifySnapshotListeners(
                result.status === 'accepted' ? result.evaluatedAt : receivedAt,
                false,
                platformBeforeOutcome,
            );
        }

        return result;
    }

    function logEventProcessingOutcome(
        event: PlatformEvent,
        prepared: ReturnType<typeof processor.prepareEvent>,
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

    function correlationForEvent(
        event: PlatformEvent,
        reason?: string,
    ): OperationalLogCorrelation {
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
        if (!activeStorage || storageState.status !== 'available') {
            return;
        }

        const projection = roomProjector.getProjection({ evaluatedAt: ingress.receivedAt });
        const outcome = activeStorage.transact((transaction) => {
            if (mutation.kind === 'upsert') {
                transaction.upsertCommandDispatchOutboxIntent(mutation.intent);
            } else {
                transaction.closeCommandDispatchOutboxIntent(mutation);
            }

            transaction.saveLatestRoomProjection({
                updatedAt: projection.updatedAt,
                projection,
                projectionEvidence: roomProjector.getEvidence(),
                volatileGuards: processor.listVolatileIdentities(),
                recentEvents,
            });
            touchRuntimeSession(transaction, ingress.receivedAt);
        });

        if (outcome.status === 'indeterminate') {
            terminateForStorageOutcome(outcome.error, 'unknown', correlationForOutboxMutation(mutation));
        }

        if (outcome.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
            terminateForStorageOutcome(outcome.error, 'fatal', correlationForOutboxMutation(mutation));
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
            (storageState.status !== 'degraded' && storageState.status !== 'recovering') ||
            storageState.reason === 'storage_manual_intervention_required' ||
            storageState.reason === 'storage_not_configured' ||
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
        if (
            (!resolvedStorageFactory && !storageLifecycle) ||
            (storageState.status !== 'degraded' && storageState.status !== 'recovering') ||
            storageState.reason === 'storage_manual_intervention_required' ||
            storageState.reason === 'storage_not_configured'
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
                        verifiedHistoryGenerationId ??
                        storageState.historyGenerationId ??
                        undefined,
                });

                if (lifecycleProbe.kind === 'existing_generation') {
                    verifiedHistoryGenerationId = lifecycleProbe.metadata.historyGenerationId;
                }

                candidate =
                    lifecycleProbe.kind === 'existing_generation'
                        ? lifecycleProbe.storage
                        : undefined;
            } else if (resolvedStorageFactory) {
                candidate = resolvedStorageFactory();
            }

            const metadata = candidate?.getMetadata();
            const interruptedRuntimeSessions =
                typeof candidate?.listUnclosedRuntimeSessions === 'function'
                    ? candidate
                          .listUnclosedRuntimeSessions()
                          .filter((session) => session.sessionId !== runtimeSessionId)
                    : [];
            const previousStorage = storageState;
            const recoveringGeneration =
                metadata?.historyGenerationId ?? previousStorage.historyGenerationId;
            const recoveringSequence =
                metadata?.lastStorageSequence ?? previousStorage.storedThroughSequence;
            const enteringRecovery = storageState.status !== 'recovering';

            if (enteringRecovery) {
                storageState =
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
                          };
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
                storageState =
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
                          };
                notifySnapshotListeners(ingress.receivedAt, true);
                cutover.abort();
                scheduleStorageRecovery();

                return;
            }

            const volatileProjection = roomProjector.getProjection({
                evaluatedAt: ingress.receivedAt,
            });
            const restoredCheckpoint = candidate?.getLatestRoomProjection();
            let finalProjection = volatileProjection;
            let finalProjectionEvidence = roomProjector.getEvidence();
            let finalRecentEvents = recentEvents;
            const restoredDurableIdentities: AcceptedInputIdentity[] = [];
            let recoveredVolatileGuards = processor.listVolatileIdentities();
            const startupFailuresToPersist = [...pendingStartupVolatileCommandFailures];

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
                    roomProjector.getEvidence(),
                    restoredCheckpoint.projection,
                    volatileProjection,
                );
                finalRecentEvents = mergeRecentEvents(
                    restoredCheckpoint.recentEvents,
                    recentEvents,
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
                    !processor.hasDurableIdentity(identity.eventId) &&
                    !startupFailuresToPersist.some(
                        (failure) => failure.event.eventId === identity.eventId,
                    ),
            );

            const projection = finalProjection;
            const unclosedSessionGapStartedAt = conservativeSessionGapStart(
                interruptedRuntimeSessions,
            );
            const gapRecordId = platformRecordId('storage.gap.recorded', generateEventId());
            const gapPayload = {
                outageStartedAt:
                    unclosedSessionGapStartedAt ?? outageStartedAt ?? previousStorage.changedAt,
                outageEndedAt: ingress.receivedAt,
                failureReason: unclosedSessionGapStartedAt
                    ? 'runtime_session_interrupted'
                    : (outageFailureReason ?? previousStorage.reason),
                boundaryBasis: unclosedSessionGapStartedAt
                    ? ('unclosed_session_later_bound' as const)
                    : (outageBoundaryBasis ?? ('degraded_startup_at' as const)),
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
                const retiredIdentityEventIds =
                    transaction.retireExpiredRecords({ asOf: ingress.receivedAt }) ?? [];
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
                transaction.activateRuntimeSession({
                    sessionId: runtimeSessionId,
                    sessionStartedAt: ingress.receivedAt,
                    lastDurableCommitAt: ingress.receivedAt,
                });

                for (const interruptedSession of interruptedRuntimeSessions) {
                    transaction.closeRuntimeSession({
                        sessionId: interruptedSession.sessionId,
                        closedAt: ingress.receivedAt,
                    });
                }

                return {
                    storageSequence: storedGap.storageSequence,
                    retiredIdentityEventIds,
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
                              operation: recoveryOperation,
                          });
                      })()
                    : candidate?.transact(recoveryOperation);

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
                    storageState =
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
                              };
                    notifySnapshotListeners(ingress.receivedAt, true);
                } else {
                    storageState = previousStorage;
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

            const committedStorage = isLifecycleCutoverCommit(outcome)
                ? outcome.storage
                : candidate;
            const committedMetadata = isLifecycleCutoverCommit(outcome)
                ? outcome.metadata
                : metadata;

            if (!committedStorage || !committedMetadata) {
                throw new StorageError(
                    'Recovery committed without an active storage generation.',
                    'fatal',
                    outcome,
                );
            }

            closeStorage(activeStorage);
            activeStorage = committedStorage;
            verifiedHistoryGenerationId = committedMetadata.historyGenerationId;
            roomProjector.installProjection(
                finalProjection,
                ingress.receivedAt,
                finalProjectionEvidence,
            );

            for (const identity of restoredDurableIdentities) {
                processor.rememberDurableIdentity(
                    identity.eventId,
                    identity.fingerprint as `fp:v1:sha256:${string}`,
                    identity.acceptedAt,
                );
            }

            for (const failure of startupFailuresToPersist) {
                processor.rememberDurableIdentity(
                    failure.event.eventId,
                    inputFingerprint(failure.event),
                    failure.acceptedAt,
                );
            }

            pendingStartupVolatileCommandFailures = [];

            // A degraded startup has not yet installed the checkpoint guards
            // into the processor. Keep those guards as volatile evidence after
            // cutover so that an event-id reuse cannot become acceptable merely
            // because recovery was the first successful storage interaction.
            for (const identity of recoveredVolatileGuards) {
                processor.rememberVolatileIdentity(
                    identity.eventId,
                    identity.fingerprint as `fp:v1:sha256:${string}`,
                    identity.acceptedAt,
                );
            }

            processor.forgetDurableIdentities(outcome.value.retiredIdentityEventIds);

            storageState = {
                status: 'available',
                changedAt: ingress.receivedAt,
                historyGenerationId: committedMetadata.historyGenerationId,
                storedThroughSequence: outcome.value.storageSequence,
            };
            recentEvents = mergeRecentEvents(finalRecentEvents, [
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
            ]);
            recoveryGapForPublication = {
                recordId: gapRecordId,
                eventType: 'storage.gap.recorded',
                occurredAt: ingress.receivedAt,
                durability: 'durable',
                storageSequence: outcome.value.storageSequence,
                source: 'backend',
                payload: gapPayload,
            };
            outageStartedAt = undefined;
            outageBoundaryBasis = undefined;
            outageFailureReason = undefined;
            cancelStorageRecovery();
            publishRecoveryCommit();

            if (!hasConflictingActiveCommands(projection)) {
                commandController.reconcileOutboxAfterRecovery();
            }

            cutover.commit();
        } catch (error) {
            if (fatalRuntimeError) {
                throw error;
            }

            closeStorage(candidate);
            enterStorageDegraded(error, ingress.receivedAt);
            cutover?.abort();
        }
    }

    function publishRecoveryCommit(): void {
        const snapshot = installedSnapshot();
        const previous = lastPublishedSnapshot;
        const committedGap = recoveryGapForPublication;
        const nonGapEvents = recentEvents.filter(
            (event) => event.eventType !== 'storage.gap.recorded',
        );
        const reconciliationRequired =
            previous === undefined ||
            !sameJson(previous.devices, snapshot.devices) ||
            !sameJson(previous.activeCommands, snapshot.activeCommands) ||
            !sameJson(previous.recentCommands, snapshot.recentCommands) ||
            !sameJson(
                previous.recentEvents.filter((event) => event.eventType !== 'storage.gap.recorded'),
                nonGapEvents,
            );

        publishSnapshot(snapshot, [
            ...(reconciliationRequired
                ? [
                      {
                          messageType: 'commands.updated' as const,
                          payload: {
                              devices: snapshot.devices,
                              activeCommands: snapshot.activeCommands,
                              recentCommands: snapshot.recentCommands,
                              recentEvents: nonGapEvents,
                          },
                      },
                  ]
                : []),
            {
                messageType: 'platform.updated' as const,
                payload: {
                    storage: snapshot.platform.storage,
                    recentEvents: committedGap ? [committedGap] : [],
                },
            },
        ]);
        recoveryGapForPublication = undefined;
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

        closeStorage(activeStorage);
        activeStorage = undefined;

        if (outageStartedAt === undefined) {
            outageStartedAt = changedAt;
            outageBoundaryBasis = 'same_process_first_degraded_at';
        }

        outageFailureReason ??= manual
            ? 'storage_manual_intervention_required'
            : 'storage_write_failed';
        const reason = manual ? 'storage_manual_intervention_required' : 'storage_write_failed';
        logStorageFailure(error, reason, correlation);
        const unchanged = storageState.status === 'degraded' && storageState.reason === reason;
        storageState =
            storageState.historyGenerationId === null
                ? {
                      status: 'degraded',
                      changedAt: unchanged ? storageState.changedAt : changedAt,
                      reason,
                      historyGenerationId: null,
                      storedThroughSequence: null,
                  }
                : {
                      status: 'degraded',
                      changedAt: unchanged ? storageState.changedAt : changedAt,
                      reason,
                      historyGenerationId: storageState.historyGenerationId,
                      storedThroughSequence: storageState.storedThroughSequence,
                  };

        if (publish && !unchanged) {
            notifySnapshotListeners(changedAt, true);
        }

        if (!manual) {
            scheduleStorageRecovery();
        }
    }

    function closeRuntimeSession(): void {
        if (!activeStorage || storageState.status !== 'available') {
            return;
        }

        const outcome = activeStorage.transact((transaction) => {
            if (typeof transaction.closeRuntimeSession === 'function') {
                transaction.closeRuntimeSession({
                    sessionId: runtimeSessionId,
                    closedAt: clock.now(),
                });
            }
        });

        if (outcome.status === 'indeterminate') {
            terminateForStorageOutcome(outcome.error, 'unknown');
        }

        if (outcome.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
            terminateForStorageOutcome(outcome.error, 'fatal');
        }
    }

    function touchRuntimeSession(transaction: RoomStorageTransaction, now: string): void {
        if (typeof transaction.activateRuntimeSession !== 'function') {
            return;
        }

        transaction.activateRuntimeSession({
            sessionId: runtimeSessionId,
            sessionStartedAt: runtimeSessionStartedAt,
            lastDurableCommitAt: now,
        });
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
            {
                eventId: generateEventId(),
                eventType: 'command.timed_out',
                occurredAt: active.delivery.deadlineAt,
                source: 'backend',
                deviceId: active.deviceId,
                commandId: active.commandId,
                payload: { timeoutMs: 5_000, reason: 'confirmation_not_received' },
            },
            ingress,
        );
    }

    function appendPreparedRecord(
        transaction: RoomStorageTransaction,
        record: PreparedRecord,
    ): number {
        switch (record.kind) {
            case 'telemetry': {
                const event = record.event;

                return transaction.appendTelemetrySample({
                    recordId: logicalRecordId(event, 'telemetry'),
                    eventId: event.eventId,
                    deviceId: event.deviceId,
                    metric: event.payload.metric,
                    value: event.payload.value,
                    unit: event.payload.unit,
                    occurredAt: event.occurredAt,
                    payload: event.payload,
                }).storageSequence;
            }

            case 'input_significant_fact': {
                const event = record.event;

                return transaction.appendSignificantFact({
                    recordId: logicalRecordId(event, 'input_fact'),
                    eventId: event.eventId,
                    eventType: event.eventType,
                    deviceId: event.deviceId,
                    commandId: event.commandId,
                    source: event.source,
                    occurredAt: event.occurredAt,
                    payload: event.payload,
                }).storageSequence;
            }

            case 'derived_command_confirmed':
                return transaction.appendSignificantFact({
                    recordId: derivedCommandRecordId(record.commandId, 'confirmed'),
                    eventId: record.eventId,
                    eventType: 'command.confirmed',
                    deviceId: record.deviceId,
                    commandId: record.commandId,
                    source: 'backend',
                    occurredAt: record.occurredAt,
                    payload: record.payload,
                }).storageSequence;
        }
    }

    function volatileGuardsForCheckpoint(prepared: ReturnType<typeof processor.prepareEvent>) {
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
        prepared: ReturnType<typeof processor.prepareEvent>,
        acceptedAt: string,
    ): void {
        if (prepared.eventId && prepared.fingerprint && prepared.kind !== 'quarantined') {
            processor.rememberVolatileIdentity(prepared.eventId, prepared.fingerprint, acceptedAt);
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

            if (storageState.status !== 'available') {
                pendingStartupVolatileCommandFailures.push({ event, acceptedAt: occurredAt });
            }
        }
    }

    function snapshotAt(evaluatedAt: string): RoomSnapshotProjection {
        return toRoomSnapshot(roomName, roomProjector, evaluatedAt, storageState, recentEvents);
    }

    function installedSnapshot(): RoomSnapshotProjection {
        return toRoomSnapshot(roomName, roomProjector, undefined, storageState, recentEvents);
    }

    function assertRuntimeIsHealthy(): void {
        if (fatalRuntimeError) {
            throw fatalRuntimeError;
        }
    }

    function reconcileExpiredDurableIdentity(event: PlatformEvent, receivedAt: string): void {
        if (
            !activeStorage ||
            storageState.status !== 'available' ||
            !processor.hasDurableIdentity(event.eventId)
        ) {
            return;
        }

        try {
            if (!activeStorage.isAcceptedInputIdentityActive(event.eventId, receivedAt)) {
                processor.forgetDurableIdentities([event.eventId]);
            }
        } catch (error) {
            if (!isDegradableStorageError(error)) {
                terminateForStorageOutcome(error, 'fatal', correlationForEvent(event));
            }

            enterStorageDegraded(error, receivedAt, true, correlationForEvent(event));
        }
    }

    function handleLedReceiptFailure(failure: LedReceiptFailure): void {
        const correlation = {
            source: 'simulator-led',
            commandId: failure.commandId,
            deviceId: 'led-main',
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
        operationalLog({ event: 'simulator_command_receipt_failure', ...correlation });

        if (failure.outcome === 'indeterminate') {
            terminateForStorageOutcome(failure.error, 'unknown', correlation);
        }

        if (failure.error instanceof StorageError && failure.error.kind === 'fatal') {
            terminateForStorageOutcome(failure.error, 'fatal', correlation);
        }

        if (storageState.status === 'available') {
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

function closeStorage(storage: RoomStorage | undefined): void {
    if (storage && typeof storage.close === 'function') {
        storage.close();
    }
}

function initializeProjectionCheckpoint(
    storage: RoomStorage | undefined,
    projector: RoomProjector,
    evaluatedAt: string,
    {
        runtimeSessionId,
        sessionStartedAt,
        priorUnclosedRuntimeSessions,
        generateEventId,
    }: {
        runtimeSessionId: string;
        sessionStartedAt: string;
        priorUnclosedRuntimeSessions: readonly RuntimeSession[];
        generateEventId(): string;
    },
) {
    if (!storage) {
        return undefined;
    }

    const startupMarkerOutcome = storage.transact((transaction) => {
        transaction.retireExpiredRecords({ asOf: evaluatedAt });

        if (typeof transaction.activateRuntimeSession === 'function') {
            transaction.activateRuntimeSession({
                sessionId: runtimeSessionId,
                sessionStartedAt,
                lastDurableCommitAt: evaluatedAt,
            });
        }
    });

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

    const outcome = storage.transact((transaction) => {
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

        if (typeof transaction.activateRuntimeSession === 'function') {
            transaction.activateRuntimeSession({
                sessionId: runtimeSessionId,
                sessionStartedAt,
                lastDurableCommitAt: evaluatedAt,
            });
        }

        for (const priorSession of priorUnclosedRuntimeSessions) {
            if (typeof transaction.closeRuntimeSession === 'function') {
                transaction.closeRuntimeSession({
                    sessionId: priorSession.sessionId,
                    closedAt: evaluatedAt,
                });
            }
        }

        return gapRecentEvent;
    });

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

function conservativeSessionGapStart(sessions: readonly RuntimeSession[]): string | undefined {
    let earliestBound: string | undefined;

    for (const session of sessions) {
        const sessionBound =
            Date.parse(session.sessionStartedAt) >= Date.parse(session.lastDurableCommitAt)
                ? session.sessionStartedAt
                : session.lastDurableCommitAt;

        if (!earliestBound || Date.parse(sessionBound) < Date.parse(earliestBound)) {
            earliestBound = sessionBound;
        }
    }

    return earliestBound;
}

function withBootstrapDurability(
    projection: RoomProjection,
    durability: 'durable' | 'volatile',
): RoomProjection {
    return {
        ...projection,
        devices: projection.devices.map((device) => ({
            ...device,
            ...(device.availability === 'unknown' ? { availabilityDurability: durability } : {}),
            ...(device.health === 'unknown' ? { healthDurability: durability } : {}),
            observationStatus: Object.fromEntries(
                Object.entries(device.observationStatus).map(([capability, observation]) => [
                    capability,
                    observation.lastObservedAt ? observation : { ...observation, durability },
                ]),
            ) as typeof device.observationStatus,
        })),
    };
}

function mergeRecoveryProjection(
    durable: RoomProjection,
    volatile: RoomProjection,
): RoomProjection {
    const volatileDevices = new Map(volatile.devices.map((device) => [device.deviceId, device]));
    const durableCommands = [...durable.activeCommands, ...durable.recentCommands];
    const volatileCommands = [...volatile.activeCommands, ...volatile.recentCommands];
    const commands = new Map(durableCommands.map((command) => [command.commandId, command]));

    for (const command of volatileCommands) {
        const durableCommand = commands.get(command.commandId);

        if (!durableCommand || isTerminalCommand(command) || !isTerminalCommand(durableCommand)) {
            commands.set(command.commandId, command);
        }
    }

    const mergedCommands = [...commands.values()].sort(
        (left, right) =>
            Date.parse(right.requestedAt) - Date.parse(left.requestedAt) ||
            right.commandId.localeCompare(left.commandId),
    );
    const activeCommands = mergedCommands.filter(
        (command): command is (typeof durable.activeCommands)[number] =>
            !isTerminalCommand(command),
    );
    const activeCommandIdByDevice = new Map(
        activeCommands.map((command) => [command.deviceId, command.commandId]),
    );
    const mergedDevices = durable.devices.map((durableDevice) => {
        const volatileDevice = volatileDevices.get(durableDevice.deviceId);

        if (!volatileDevice) {
            return durableDevice;
        }

        const observations = Object.fromEntries(
            [
                ...new Set([
                    ...Object.keys(durableDevice.observationStatus),
                    ...Object.keys(volatileDevice.observationStatus),
                ]),
            ].flatMap((capability) => {
                const durableObservation = durableDevice.observationStatus[capability];
                const volatileObservation = volatileDevice.observationStatus[capability];

                if (!durableObservation) {
                    return volatileObservation ? [[capability, volatileObservation]] : [];
                }

                if (!volatileObservation) {
                    return [[capability, durableObservation]];
                }

                return [
                    [
                        capability,
                        isStrictlyLaterTimestamp(
                            volatileObservation.lastObservedAt,
                            durableObservation.lastObservedAt,
                        )
                            ? volatileObservation
                            : durableObservation,
                    ],
                ];
            }),
        ) as typeof durableDevice.observationStatus;
        const volatileObservationCapabilities = new Set(
            Object.entries(observations)
                .filter(
                    ([capability, observation]) =>
                        observation === volatileDevice.observationStatus[capability],
                )
                .map(([capability]) => capability),
        );

        const mergedDevice = {
            ...durableDevice,
            reportedState: mergeRecoveryReportedState(
                durableDevice.reportedState,
                volatileDevice.reportedState,
                volatileObservationCapabilities,
            ),
            observationStatus: observations,
        };

        if (
            Date.parse(volatileDevice.availabilityChangedAt) >
            Date.parse(durableDevice.availabilityChangedAt)
        ) {
            mergedDevice.availability = volatileDevice.availability;
            mergedDevice.availabilityChangedAt = volatileDevice.availabilityChangedAt;
            mergedDevice.availabilityDurability = volatileDevice.availabilityDurability;

            if (volatileDevice.availability === 'offline') {
                mergedDevice.availabilityReason = volatileDevice.availabilityReason;
            } else {
                delete mergedDevice.availabilityReason;
            }
        }

        if (
            Date.parse(volatileDevice.healthChangedAt) > Date.parse(durableDevice.healthChangedAt)
        ) {
            mergedDevice.health = volatileDevice.health;
            mergedDevice.healthChangedAt = volatileDevice.healthChangedAt;
            mergedDevice.healthDurability = volatileDevice.healthDurability;

            if (volatileDevice.health === 'degraded') {
                mergedDevice.healthReason = volatileDevice.healthReason;
            } else {
                delete mergedDevice.healthReason;
            }
        }

        return {
            ...mergedDevice,
            commandAvailability: commandAvailabilityFor(
                mergedDevice.role,
                mergedDevice.availability,
                mergedDevice.health,
                mergedDevice.healthReason,
            ),
        };
    });

    return {
        updatedAt:
            Date.parse(volatile.updatedAt) > Date.parse(durable.updatedAt)
                ? volatile.updatedAt
                : durable.updatedAt,
        devices: mergedDevices.map((device) => {
            const activeCommandId = activeCommandIdByDevice.get(device.deviceId);
            const withoutActiveCommand = { ...device };
            delete withoutActiveCommand.activeCommandId;

            return activeCommandId === undefined
                ? withoutActiveCommand
                : { ...withoutActiveCommand, activeCommandId };
        }),
        activeCommands,
        recentCommands: selectRecentCommands(mergedCommands.filter(isTerminalCommand)),
    };
}

function mergeRecoveryReportedState(
    durable: RoomProjection['devices'][number]['reportedState'],
    volatile: RoomProjection['devices'][number]['reportedState'],
    volatileObservationCapabilities: ReadonlySet<string>,
): RoomProjection['devices'][number]['reportedState'] {
    const merged = { ...durable };

    for (const [property, value] of Object.entries(volatile)) {
        const capability = property === 'temperatureUnit' ? 'temperature' : property;

        if (volatileObservationCapabilities.has(capability)) {
            merged[property] = value;
        }
    }

    return merged;
}

function mergeRecoveryEvidence(
    durableEvidence: RoomProjectionEvidence,
    volatileEvidence: RoomProjectionEvidence,
    durable: RoomProjection,
    volatile: RoomProjection,
): RoomProjectionEvidence {
    const durableDevices = new Map(durable.devices.map((device) => [device.deviceId, device]));
    const durableAvailability = new Set(durableEvidence.availabilityDeviceIds);
    const volatileAvailability = new Set(volatileEvidence.availabilityDeviceIds);
    const durableHealth = new Set(durableEvidence.healthDeviceIds);
    const volatileHealth = new Set(volatileEvidence.healthDeviceIds);
    const availabilityDeviceIds = new Set<string>();
    const healthDeviceIds = new Set<string>();

    for (const volatileDevice of volatile.devices) {
        const durableDevice = durableDevices.get(volatileDevice.deviceId);

        if (!durableDevice) {
            if (volatileAvailability.has(volatileDevice.deviceId)) {
                availabilityDeviceIds.add(volatileDevice.deviceId);
            }

            if (volatileHealth.has(volatileDevice.deviceId)) {
                healthDeviceIds.add(volatileDevice.deviceId);
            }

            continue;
        }

        const newerAvailability =
            Date.parse(volatileDevice.availabilityChangedAt) >
            Date.parse(durableDevice.availabilityChangedAt);
        const newerHealth =
            Date.parse(volatileDevice.healthChangedAt) > Date.parse(durableDevice.healthChangedAt);

        if (
            (newerAvailability && volatileAvailability.has(volatileDevice.deviceId)) ||
            (!newerAvailability && durableAvailability.has(volatileDevice.deviceId))
        ) {
            availabilityDeviceIds.add(volatileDevice.deviceId);
        }

        if (
            (newerHealth && volatileHealth.has(volatileDevice.deviceId)) ||
            (!newerHealth && durableHealth.has(volatileDevice.deviceId))
        ) {
            healthDeviceIds.add(volatileDevice.deviceId);
        }
    }

    const confirmationSources = new Map(
        durableEvidence.commandConfirmationSources?.map((source) => [source.commandId, source]) ??
            [],
    );

    for (const source of volatileEvidence.commandConfirmationSources ?? []) {
        if (!confirmationSources.has(source.commandId)) {
            confirmationSources.set(source.commandId, source);
        }
    }

    return {
        availabilityDeviceIds: [...availabilityDeviceIds].sort(),
        healthDeviceIds: [...healthDeviceIds].sort(),
        commandConfirmationSources: [...confirmationSources.values()].sort((left, right) =>
            left.commandId.localeCompare(right.commandId),
        ),
    };
}

function isTerminalCommand(
    command: RoomProjection['activeCommands'][number] | RoomProjection['recentCommands'][number],
): command is RoomProjection['recentCommands'][number] {
    return ['confirmed', 'failed', 'timed_out'].includes(command.status);
}

function hasConflictingActiveCommands(projection: RoomProjection): boolean {
    const commandIdsByDevice = new Map<string, Set<string>>();

    for (const command of projection.activeCommands) {
        const commandIds = commandIdsByDevice.get(command.deviceId) ?? new Set<string>();
        commandIds.add(command.commandId);
        commandIdsByDevice.set(command.deviceId, commandIds);

        if (commandIds.size > 1) {
            return true;
        }
    }

    return false;
}

function hasVolatileDurableActiveCommandConflict(
    durable: RoomProjection,
    volatile: RoomProjection,
): boolean {
    const durableByDevice = new Map(
        durable.activeCommands.map((command) => [command.deviceId, command]),
    );

    return volatile.activeCommands.some((command) => {
        const durableCommand = durableByDevice.get(command.deviceId);

        return durableCommand !== undefined && durableCommand.commandId !== command.commandId;
    });
}

function terminalOutboxClosure(
    event: PlatformEvent,
    records: readonly PreparedRecord[],
): { commandId: string; closedAt: string } | undefined {
    if (
        event.commandId &&
        (event.eventType === 'command.failed' || event.eventType === 'command.timed_out')
    ) {
        return { commandId: event.commandId, closedAt: event.occurredAt };
    }

    const confirmation = records.find(
        (record): record is Extract<PreparedRecord, { kind: 'derived_command_confirmed' }> =>
            record.kind === 'derived_command_confirmed',
    );

    return confirmation
        ? { commandId: confirmation.commandId, closedAt: confirmation.occurredAt }
        : undefined;
}

function isLifecycleCutoverCommit<Value>(
    outcome: { status: 'committed'; value: Value } | StorageCutoverOutcome<Value>,
): outcome is Extract<StorageCutoverOutcome<Value>, { status: 'committed' }> {
    return outcome.status === 'committed' && 'storage' in outcome && 'metadata' in outcome;
}

function isStrictlyLaterTimestamp(
    candidate: string | undefined,
    baseline: string | undefined,
): boolean {
    if (candidate === undefined) {
        return false;
    }

    if (baseline === undefined) {
        return true;
    }

    return Date.parse(candidate) > Date.parse(baseline);
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The runtime, which owns the domain transition, also owns the semantic
 * description of that transition.  Keeping this out of the SSE adapter makes
 * a publication batch a real boundary: the BFF only numbers and serializes
 * already-decided deltas.
 */
function buildPublicationDeltas(
    previous: RoomSnapshotProjection | undefined,
    next: RoomSnapshotProjection,
    platformBeforeOutcome: boolean,
): readonly RoomPublicationDelta[] {
    if (!previous) {
        return [];
    }

    const deltas: RoomPublicationDelta[] = [];
    const previousDevices = new Map(previous.devices.map((device) => [device.deviceId, device]));
    const commandDeviceIds = changedCommandDeviceIds(previous, next);

    const platformDelta = !sameJson(previous.platform, next.platform)
        ? (() => {
              const gapEvents = next.recentEvents.filter(
                  (event) => event.eventType === 'storage.gap.recorded',
              );

              return {
                  messageType: 'platform.updated' as const,
                  payload: {
                      storage: next.platform.storage,
                      ...(gapEvents.length > 0 ? { recentEvents: gapEvents } : {}),
                  },
              };
          })()
        : undefined;

    if (platformBeforeOutcome && platformDelta) {
        deltas.push(platformDelta);
    }

    for (const device of next.devices) {
        if (
            !commandDeviceIds.has(device.deviceId) &&
            !sameJson(previousDevices.get(device.deviceId), device)
        ) {
            deltas.push({ messageType: 'device.updated', payload: device });
        }
    }

    const nonGapEventsChanged = !sameJson(
        previous.recentEvents.filter((event) => event.eventType !== 'storage.gap.recorded'),
        next.recentEvents.filter((event) => event.eventType !== 'storage.gap.recorded'),
    );

    if (commandDeviceIds.size > 0 || nonGapEventsChanged) {
        deltas.push({
            messageType: 'commands.updated',
            payload: {
                devices: next.devices,
                activeCommands: next.activeCommands,
                recentCommands: next.recentCommands,
                ...(nonGapEventsChanged
                    ? {
                          recentEvents: next.recentEvents.filter(
                              (event) => event.eventType !== 'storage.gap.recorded',
                          ),
                      }
                    : {}),
            },
        });
    }

    if (!platformBeforeOutcome && platformDelta) {
        deltas.push(platformDelta);
    }

    return deltas;
}

function changedCommandDeviceIds(
    previous: RoomSnapshotProjection,
    next: RoomSnapshotProjection,
): Set<string> {
    const previousCommands = new Map(
        [...previous.activeCommands, ...previous.recentCommands].map((command) => [
            command.commandId,
            command,
        ]),
    );
    const nextCommands = new Map(
        [...next.activeCommands, ...next.recentCommands].map((command) => [
            command.commandId,
            command,
        ]),
    );
    const deviceIds = new Set<string>();

    for (const commandId of new Set([...previousCommands.keys(), ...nextCommands.keys()])) {
        const before = previousCommands.get(commandId);
        const after = nextCommands.get(commandId);

        if (!sameJson(before, after)) {
            if (before) {
                deviceIds.add(before.deviceId);
            }

            if (after) {
                deviceIds.add(after.deviceId);
            }
        }
    }

    return deviceIds;
}

function isFatalStorageError(error: unknown): boolean {
    return error instanceof StorageError && error.kind === 'fatal';
}

function isDegradableStorageError(error: unknown): boolean {
    return error instanceof StorageError && error.kind !== 'fatal';
}

function isRoomProjection(value: unknown): value is RoomProjection {
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

const realTimer: TimerScheduler<ReturnType<typeof setInterval>> = {
    setInterval(callback, intervalMs) {
        return setInterval(callback, intervalMs);
    },
    clearInterval(timerHandle) {
        clearInterval(timerHandle);
    },
};

const realLedScenarioScheduler = {
    setTimeout(callback: () => void, delayMs: number) {
        return setTimeout(callback, delayMs);
    },
    clearTimeout(timerHandle: ReturnType<typeof setTimeout>) {
        clearTimeout(timerHandle);
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

const realClock: Clock = {
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

function recentEventsForRecords(
    records: readonly PreparedRecord[],
    durability: 'durable' | 'volatile',
): RecentEventProjection[] {
    return records.flatMap((record) => {
        const recentEvent = recentEventForRecord(record, durability);

        return recentEvent ? [recentEvent] : [];
    });
}

function recentEventForRecord(
    record: PreparedRecord,
    durability: 'durable' | 'volatile',
    storageSequence?: number,
): RecentEventProjection | undefined {
    if (record.kind === 'telemetry') {
        return undefined;
    }

    const storage = durability === 'durable' ? { storageSequence } : {};

    if (record.kind === 'derived_command_confirmed') {
        if (storageSequence === undefined && durability === 'durable') {
            throw new Error('Durable recent events require a storage sequence.');
        }

        return {
            recordId: derivedCommandRecordId(record.commandId, 'confirmed'),
            eventType: 'command.confirmed',
            occurredAt: record.occurredAt,
            durability,
            ...storage,
            deviceId: record.deviceId,
            commandId: record.commandId,
            source: 'backend',
            payload: record.payload,
        } as RecentEventProjection;
    }

    const event = record.event;

    if (storageSequence === undefined && durability === 'durable') {
        throw new Error('Durable recent events require a storage sequence.');
    }

    return {
        recordId: logicalRecordId(event, 'input_fact'),
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        durability,
        ...storage,
        deviceId: event.deviceId,
        ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
        source: event.source,
        payload: event.payload,
    } as RecentEventProjection;
}

function mergeRecentEvents(
    current: readonly RecentEventProjection[],
    additions: readonly RecentEventProjection[],
): RecentEventProjection[] {
    const byRecordId = new Map(current.map((event) => [event.recordId, event]));

    for (const event of additions) {
        const existing = byRecordId.get(event.recordId);

        // A durable record is the historical fact.  A later volatile copy of
        // the same record must never demote it while recovery is merging the
        // two sides of the boundary.
        if (existing?.durability === 'durable' && event.durability === 'volatile') {
            continue;
        }

        if (existing?.durability === 'volatile' && event.durability === 'durable') {
            byRecordId.set(event.recordId, event);

            continue;
        }

        if (
            !existing ||
            Date.parse(event.occurredAt) > Date.parse(existing.occurredAt) ||
            (event.occurredAt === existing.occurredAt && event.recordId > existing.recordId)
        ) {
            byRecordId.set(event.recordId, event);
        }
    }

    return [...byRecordId.values()].sort(compareRecentEventsDescending).slice(0, 20);
}

function promoteStartupVolatileCommandFailures(
    projection: RoomProjection,
    failures: readonly PendingStartupVolatileCommandFailure[],
): RoomProjection {
    const commandIds = new Set(failures.map((failure) => failure.event.commandId));
    const recentCommands = projection.recentCommands.map((command) => {
        if (!commandIds.has(command.commandId)) {
            return command;
        }

        if (
            command.status !== 'failed' ||
            command.reason !== volatileCommandLostOnRestartReason ||
            command.durability !== 'volatile'
        ) {
            throw new Error(
                `Startup volatile command ${command.commandId} was not restored as the expected failure.`,
            );
        }

        return { ...command, lifecycleDurability: 'durable' as const };
    });

    // recentCommands is a bounded cache. During a prolonged degraded period a
    // newer terminal command can evict this startup failure before recovery.
    // The recovery transaction persists the failure fact and identity either
    // way; only a retained terminal projection can expose a lifecycle-axis
    // promotion in the checkpoint cache.
    return { ...projection, recentCommands: selectRecentCommands(recentCommands) };
}

function mergeVolatileGuards(
    restored: readonly AcceptedInputIdentity[],
    live: readonly AcceptedInputIdentity[],
    { asOf, retentionMs, entryLimit }: { asOf: string; retentionMs: number; entryLimit: number },
): AcceptedInputIdentity[] {
    const guards = new Map<string, AcceptedInputIdentity>();
    const cutoff = Date.parse(asOf) - retentionMs;

    for (const candidate of [...restored, ...live]) {
        if (
            candidate.durability !== 'volatile' ||
            !candidate.fingerprint.startsWith('fp:v1:sha256:') ||
            Date.parse(candidate.acceptedAt) <= cutoff
        ) {
            continue;
        }

        const existing = guards.get(candidate.eventId);

        // Keep the oldest accepted identity when an unavailable startup has
        // observed a conflicting event-id before its checkpoint could be
        // restored. Both candidates remain guards semantically; retaining the
        // earliest one makes the conflict deterministic and never promotes it
        // to a durable accepted identity.
        if (!existing || candidate.acceptedAt < existing.acceptedAt) {
            guards.set(candidate.eventId, candidate);
        }
    }

    return [...guards.values()]
        .sort(
            (left, right) =>
                left.acceptedAt.localeCompare(right.acceptedAt) ||
                left.eventId.localeCompare(right.eventId),
        )
        .slice(-entryLimit);
}
