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
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
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
    createEventProcessingDiagnostics,
    type EventProcessingDiagnosticsSnapshot,
} from '../platform/event-processing/event-processing-diagnostics';
import {
    createEventProcessor,
    type DeviceDefinition,
    type EventProcessingResult,
} from '../platform/event-processing/event-processor';
import { createRoomProjector, type RoomProjector } from '../platform/read-model/room-projection';

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
    const processor = createEventProcessor({
        devices,
        roomProjector,
        clock,
        deduplicationRetentionMs,
        deduplicationEntryLimit,
    });
    const diagnostics = createEventProcessingDiagnostics({
        clock,
        diagnosticEventLimit,
    });

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
        emitEvent: processPlatformEvent,
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
                        processPlatformEvent(event);
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
                notifyFreshnessChanges(clock.now());
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
            return toRoomSnapshot(roomName, roomProjector, clock.now());
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

    function notifySnapshotListeners(evaluatedAt: string): void {
        const snapshot = toRoomSnapshot(roomName, roomProjector, evaluatedAt);
        lastPublishedSnapshot = snapshot;

        for (const listener of snapshotListeners) {
            try {
                listener(snapshot);
            } catch {
                // A failed realtime client must not block event ingestion or other clients.
            }
        }
    }

    function notifyFreshnessChanges(evaluatedAt: string): void {
        const snapshot = toRoomSnapshot(roomName, roomProjector, evaluatedAt);
        const previousSnapshot = lastPublishedSnapshot;

        if (previousSnapshot && !hasObservationStatusChange(previousSnapshot, snapshot)) {
            return;
        }

        notifySnapshotListeners(evaluatedAt);
    }

    function processPlatformEvent(event: PlatformEvent): EventProcessingResult {
        const activeCommandIdBeforeEvent = event.deviceId
            ? roomProjector
                  .getProjection()
                  .activeCommands.find((command) => command.deviceId === event.deviceId)?.commandId
            : undefined;
        const result = processor.processEvent(event);
        diagnostics.recordProcessingResult(event, result);
        commandController.onEventProcessed(activeCommandIdBeforeEvent, event, result);

        if (result.status === 'accepted') {
            notifySnapshotListeners(result.evaluatedAt);
        }

        return result;
    }

    function receiveAdapterEvent(event: PlatformEvent): void {
        if (bufferedAdapterEvents) {
            bufferedAdapterEvents.push(event);

            return;
        }

        processPlatformEvent(event);
    }

    function getCurrentRoomSnapshot(): RoomSnapshotProjection {
        return toRoomSnapshot(roomName, roomProjector, clock.now());
    }
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
    evaluatedAt: string,
): RoomSnapshotProjection {
    const projection = roomProjector.getProjection({
        evaluatedAt,
    });

    return {
        roomName,
        updatedAt: projection.updatedAt,
        devices: projection.devices,
        activeCommands: projection.activeCommands,
        recentCommands: projection.recentCommands,
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
