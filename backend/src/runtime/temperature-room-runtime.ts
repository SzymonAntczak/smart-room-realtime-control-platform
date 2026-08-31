import { randomUUID } from 'node:crypto';
import { clearInterval, setInterval, setTimeout } from 'node:timers';

import type {
    AcceptedCommandResponse,
    RejectedCommandResponse,
    SetPowerCommandRequest,
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
import type { PlatformEvent } from '@smart-room/contracts/events';
import type {
    PlatformStorageProjection,
    RoomSnapshotProjection,
} from '@smart-room/contracts/projections';
import { isRoomSnapshotProjection } from '@smart-room/contracts/realtime';
import {
    type Clock,
    createLedScenario,
    createTemperatureSensorRuntime,
    createTemperatureSensorScenario,
    type LedScenarioName,
    type LedScenarioScheduler,
    type TemperatureSensorRuntime,
    type TimerScheduler,
} from '@smart-room/simulator';

import {
    createSimulatorLedAdapter,
    type SimulatorLedAdapter,
} from '../adapters/simulator/led/led-adapter';
import {
    createSimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapter,
} from '../adapters/simulator/temperature/temperature-adapter';
import {
    type CommandTimer,
    createSetPowerCommandController,
} from '../platform/command-processing/set-power-command-controller';
import {
    derivedCommandRecordId,
    inputFingerprint,
    logicalRecordId,
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
import {
    createRoomProjector,
    type RoomProjection,
    type RoomProjector,
} from '../platform/read-model/room-projection';
import type {
    AcceptedInputIdentity,
    RoomStorage,
    RoomStorageTransaction,
    StorageMetadata,
} from '../platform/storage/room-storage';
import { StorageError } from '../platform/storage/storage-errors';

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
    getDeviceScenarios(deviceId: string): DeviceScenarioList | undefined;
    runDeviceScenario(deviceId: string, action: DeviceScenarioAction): DeviceScenarioResult;
    requestCommand(
        request: SetPowerCommandRequest,
    ): AcceptedCommandResponse | RejectedCommandResponse;
}

export type RoomSnapshotListener = (snapshot: RoomSnapshotProjection) => void;

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
    const roomProjector = createRoomProjector({
        devices,
        initialUpdatedAt: clock.now(),
    });
    let fatalRuntimeError: Error | undefined;
    const initializedCheckpoint = initializeProjectionCheckpoint(
        storage,
        roomProjector,
        clock.now(),
    );
    const initialStorageOutcome = initializedCheckpoint?.outcome;
    let startupStorageError = initializedCheckpoint?.readError;

    if (initialStorageOutcome?.status === 'indeterminate') {
        terminateForStorageOutcome(initialStorageOutcome.error, 'unknown');
    }

    if (
        initialStorageOutcome?.status === 'confirmed_rolled_back' &&
        isFatalStorageError(initialStorageOutcome.error)
    ) {
        terminateForStorageOutcome(initialStorageOutcome.error, 'fatal');
    }

    if (startupStorageError && !isDegradableStorageError(startupStorageError)) {
        throw startupStorageError;
    }

    let initialAcceptedInputIdentities: AcceptedInputIdentity[] = [];
    let initialStorageMetadata: StorageMetadata | undefined;

    if (
        storage &&
        !startupStorageError &&
        initialStorageOutcome?.status !== 'confirmed_rolled_back'
    ) {
        try {
            initialAcceptedInputIdentities = storage.listAcceptedInputIdentities();
            initialStorageMetadata = storage.getMetadata();
        } catch (error) {
            startupStorageError = error;
        }
    }

    if (startupStorageError && !isDegradableStorageError(startupStorageError)) {
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
    let storageState: PlatformStorageProjection =
        storage &&
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
                  reason: storage ? 'storage_write_failed' : 'storage_not_configured',
                  historyGenerationId: null,
                  storedThroughSequence: null,
              };

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
    let bufferedAdapterEvents: PlatformEvent[] | undefined;
    let hasStarted = false;
    let snapshotBroadcastTimerHandle: unknown | undefined;
    let lastPublishedSnapshot: RoomSnapshotProjection | undefined;
    const inputCoordinator = createRoomInputCoordinator({
        now: clock.now,
        dispatch(input) {
            return processPlatformEvent(input.event, input.ingress);
        },
    });
    const commandController = createSetPowerCommandController({
        routes: [
            {
                deviceId: 'led-main',
                target: 'simulator-adapter',
                dispatcher: {
                    dispatch(command) {
                        if (!hasStarted || !ledAdapter) {
                            throw new Error('The LED adapter is not available.');
                        }

                        ledAdapter.dispatch(command);
                    },
                },
            },
        ],
        emitEvent(event) {
            const result = inputCoordinator.receive(event);

            if (!result) {
                throw new Error('Command lifecycle event was enqueued during another dispatch.');
            }

            return result;
        },
        createDispatchScope() {
            if (bufferedAdapterEvents) {
                throw new Error('A command dispatch scope is already active.');
            }

            const bufferedEvents: PlatformEvent[] = [];

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
                    for (const event of bufferedEvents) {
                        inputCoordinator.receive(event);
                    }

                    bufferedEvents.length = 0;
                },
            };
        },
        getRoomSnapshot: getCurrentRoomSnapshot,
        clock,
        commandTimer,
        generateCommandId,
        generateEventId,
    });

    return {
        start() {
            assertRuntimeIsHealthy();

            if (hasStarted) {
                return;
            }

            hasStarted = true;
            const startedLed = attachLedScenario('off');
            startedLed.reportAvailability('online', clock.now());
            startedLed.reportCurrentState(clock.now());
            commandController.reschedulePendingCommands();

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

            for (const sensorEntry of sensors) {
                sensorEntry.adapter?.stop();
                sensorEntry.adapter = undefined;
            }

            ledAdapter?.stop();
            ledAdapter = undefined;
            led?.stop();
            led = undefined;

            commandController.stop();
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
        });
        ledAdapter = createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            emitEvent(event) {
                receiveAdapterEvent(event);
            },
        });

        return led;
    }

    function findSensor(deviceId: string): (typeof sensors)[number] | undefined {
        return sensors.find((sensorEntry) => sensorEntry.definition.deviceId === deviceId);
    }

    function notifySnapshotListeners(evaluatedAt: string, installedProjectionOnly = false): void {
        const snapshot = installedProjectionOnly ? installedSnapshot() : snapshotAt(evaluatedAt);
        lastPublishedSnapshot = snapshot;

        for (const listener of snapshotListeners) {
            try {
                listener(snapshot);
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

        if (storage && storageState.status === 'available') {
            const outcome = storage.transact((transaction) => {
                const retiredIdentityEventIds =
                    transaction.retireExpiredRecords({ asOf: evaluatedAt }) ?? [];
                transaction.saveLatestRoomProjection({
                    updatedAt: prepared.candidateState.updatedAt,
                    projection: prepared.candidateState,
                    projectionEvidence: prepared.candidateEvidence,
                    volatileGuards: processor.listVolatileIdentities(),
                });

                return { retiredIdentityEventIds };
            });

            if (outcome.status === 'indeterminate') {
                return terminateForStorageOutcome(outcome.error, 'unknown');
            }

            if (outcome.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
                return terminateForStorageOutcome(outcome.error, 'fatal');
            }

            if (outcome.status === 'confirmed_rolled_back') {
                storageState = {
                    status: 'degraded',
                    changedAt: evaluatedAt,
                    reason: 'storage_write_failed',
                    historyGenerationId: storageState.historyGenerationId,
                    storedThroughSequence: storageState.storedThroughSequence,
                };
                notifySnapshotListeners(evaluatedAt, true);
            } else {
                processor.forgetDurableIdentities(outcome.value.retiredIdentityEventIds);
            }
        }

        processor.commitPreparedProjection(prepared);

        notifySnapshotListeners(evaluatedAt);
    }

    function processPlatformEvent(
        event: PlatformEvent,
        ingress: EventIngress,
    ): EventProcessingResult {
        assertRuntimeIsHealthy();
        const receivedAt = ingress.receivedAt;
        closeExpiredCommandBeforeStateReport(event, ingress);
        const activeCommandIdBeforeEvent = event.deviceId
            ? roomProjector
                  .getProjection()
                  .activeCommands.find((command) => command.deviceId === event.deviceId)?.commandId
            : undefined;
        reconcileExpiredDurableIdentity(event.eventId, receivedAt);
        const prepared = processor.prepareEvent(
            event,
            ingress,
            storageState.status === 'available' ? 'available' : 'degraded',
        );
        const durablePreparedState = processor.materializePreparedState(prepared, 'durable');
        let result: EventProcessingResult;

        if (storage && storageState.status === 'available') {
            const outcome = storage.transact((transaction) => {
                let storedThroughSequence: number | undefined;

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
                    transaction.saveLatestRoomProjection({
                        updatedAt: durablePreparedState.updatedAt,
                        projection: durablePreparedState,
                        projectionEvidence:
                            prepared.candidateEvidence ?? roomProjector.getEvidence(),
                        volatileGuards: volatileGuardsForCheckpoint(prepared),
                    });
                }

                return { storedThroughSequence, retiredIdentityEventIds };
            });

            if (outcome.status === 'indeterminate') {
                return terminateForStorageOutcome(outcome.error, 'unknown');
            }

            if (outcome.status === 'confirmed_rolled_back' && isFatalStorageError(outcome.error)) {
                return terminateForStorageOutcome(outcome.error, 'fatal');
            }

            if (outcome.status === 'confirmed_rolled_back') {
                storageState = {
                    status: 'degraded',
                    changedAt: receivedAt,
                    reason: 'storage_write_failed',
                    historyGenerationId: storageState.historyGenerationId,
                    storedThroughSequence: storageState.storedThroughSequence,
                };
                notifySnapshotListeners(receivedAt, true);
                result = processor.commitPrepared(prepared, 'volatile');
                rememberVolatileIdentity(prepared, receivedAt);
            } else {
                result = processor.commitPrepared(prepared);
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
        }

        diagnostics.recordProcessingResult(event, result);
        commandController.onEventProcessed(activeCommandIdBeforeEvent, event, result);

        if (result.status === 'accepted' || prepared.kind === 'accepted_non_applying') {
            notifySnapshotListeners(result.status === 'accepted' ? result.evaluatedAt : receivedAt);
        }

        return result;
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

        if (!active || active.status !== 'pending' || !active.deadlineAt) {
            return;
        }

        if (Date.parse(ingress.receivedAt) < Date.parse(active.deadlineAt)) {
            return;
        }

        processPlatformEvent(
            {
                eventId: generateEventId(),
                eventType: 'command.timed_out',
                occurredAt: active.deadlineAt,
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
            bufferedAdapterEvents.push(event);

            return;
        }

        inputCoordinator.receive(event);
    }

    function getCurrentRoomSnapshot(): RoomSnapshotProjection {
        return snapshotAt(clock.now());
    }

    function snapshotAt(evaluatedAt: string): RoomSnapshotProjection {
        return toRoomSnapshot(roomName, roomProjector, evaluatedAt, storageState);
    }

    function installedSnapshot(): RoomSnapshotProjection {
        return toRoomSnapshot(roomName, roomProjector, undefined, storageState);
    }

    function assertRuntimeIsHealthy(): void {
        if (fatalRuntimeError) {
            throw fatalRuntimeError;
        }
    }

    function reconcileExpiredDurableIdentity(eventId: string, receivedAt: string): void {
        if (
            !storage ||
            storageState.status !== 'available' ||
            !processor.hasDurableIdentity(eventId)
        ) {
            return;
        }

        try {
            if (!storage.isAcceptedInputIdentityActive(eventId, receivedAt)) {
                processor.forgetDurableIdentities([eventId]);
            }
        } catch (error) {
            if (!isDegradableStorageError(error)) {
                terminateForStorageOutcome(error, 'fatal');
            }

            storageState = {
                status: 'degraded',
                changedAt: receivedAt,
                reason: 'storage_write_failed',
                historyGenerationId: storageState.historyGenerationId,
                storedThroughSequence: storageState.storedThroughSequence,
            };
            notifySnapshotListeners(receivedAt, true);
        }
    }

    function terminateForStorageOutcome(cause: unknown, kind: 'unknown' | 'fatal'): never {
        fatalRuntimeError ??= new Error(
            kind === 'unknown' ? 'storage_commit_outcome_unknown' : 'storage_fatal_error',
            { cause },
        );

        return onFatalStorageError(fatalRuntimeError);
    }
}

function initializeProjectionCheckpoint(
    storage: RoomStorage | undefined,
    projector: RoomProjector,
    evaluatedAt: string,
) {
    if (!storage) {
        return undefined;
    }

    const retentionOutcome = storage.transact((transaction) =>
        transaction.retireExpiredRecords({ asOf: evaluatedAt }),
    );

    if (retentionOutcome.status !== 'committed') {
        return {
            outcome: retentionOutcome,
            restored: false,
            volatileGuards: [],
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

    if (checkpoint && JSON.stringify(checkpoint.projection) === JSON.stringify(projection)) {
        projector.installProjection(projection, evaluatedAt, projectionEvidence);

        return { restored: true, volatileGuards: checkpoint.volatileGuards };
    }

    const outcome = storage.transact((transaction) => {
        transaction.retireExpiredRecords({ asOf: evaluatedAt });
        transaction.saveLatestRoomProjection({
            updatedAt: projection.updatedAt,
            projection,
            projectionEvidence,
            volatileGuards: checkpoint?.volatileGuards ?? [],
        });
    });

    if (outcome.status !== 'indeterminate') {
        projector.installProjection(projection, evaluatedAt, projectionEvidence);
    }

    return {
        outcome,
        restored: false,
        volatileGuards: checkpoint?.volatileGuards ?? [],
    };
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

function toRoomSnapshot(
    roomName: string,
    roomProjector: RoomProjector,
    evaluatedAt: string | undefined,
    storage: PlatformStorageProjection,
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
