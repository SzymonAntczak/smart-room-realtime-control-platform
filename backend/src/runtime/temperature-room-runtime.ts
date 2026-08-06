import { randomUUID } from 'node:crypto';
import { clearInterval, setInterval, setTimeout } from 'node:timers';

import type {
    DeviceScenarioList,
    TemperatureScenarioAction,
    TemperatureScenarioResult,
} from '@smart-room/contracts/development';
import { temperatureScenarioActions } from '@smart-room/contracts/development';
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
    type PlatformSetPowerCommand,
    type SimulatorLedAdapter,
} from '../adapters/simulator/led/led-adapter';
import {
    createSimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapter,
} from '../adapters/simulator/temperature/temperature-adapter';
import {
    createEventProcessingDiagnostics,
    type EventProcessingDiagnosticsSnapshot,
} from '../platform/event-processing/event-processing-diagnostics';
import {
    createEventProcessor,
    type DeviceDefinition,
} from '../platform/event-processing/event-processor';
import { createRoomProjector, type RoomProjector } from '../platform/read-model/room-projection';

export interface TemperatureRoomRuntimeConfig {
    roomName?: string;
    intervalMs?: number;
    snapshotBroadcastIntervalMs?: number;
    clock?: Clock;
    timer?: TimerScheduler;
    generateEventId?: () => string;
    diagnosticEventLimit?: number;
    deduplicationRetentionMs?: number;
    deduplicationEntryLimit?: number;
    ledScenario?: LedScenarioName;
    ledScenarioScheduler?: LedScenarioScheduler;
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
    runDeviceScenario(
        deviceId: string,
        action: TemperatureScenarioAction,
    ): TemperatureScenarioResult;
    dispatchLedCommand(command: PlatformSetPowerCommand): void;
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

export function createTemperatureRoomRuntime({
    roomName = 'Smart Room',
    intervalMs = 1000,
    snapshotBroadcastIntervalMs = 1000,
    clock = realClock,
    timer,
    generateEventId = randomUUID,
    diagnosticEventLimit,
    deduplicationRetentionMs,
    deduplicationEntryLimit,
    ledScenario = 'confirm_immediately',
    ledScenarioScheduler = realLedScenarioScheduler,
}: TemperatureRoomRuntimeConfig = {}): TemperatureRoomRuntime {
    const sensors = defaultSensors.map((definition) => ({
        definition,
        sensor: createTemperatureSensorScenario({
            sensorId: definition.nativeSensorId,
            baseTemperature: definition.baseTemperature,
            readingPattern,
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
    let hasStarted = false;
    let snapshotBroadcastTimerHandle: unknown | undefined;
    let lastPublishedSnapshot: RoomSnapshotProjection | undefined;

    return {
        start() {
            if (hasStarted) {
                return;
            }

            hasStarted = true;
            led = createLedScenario({
                deviceId: 'led-main-native',
                initialPower: 'off',
                scenario: ledScenario,
                clock,
                scheduler: ledScenarioScheduler,
            });
            ledAdapter = createSimulatorLedAdapter({
                led,
                nativeLedId: 'led-main-native',
                platformDeviceId: 'led-main',
                generateEventId,
                emitEvent(event) {
                    const result = processor.processEvent(event);
                    diagnostics.recordProcessingResult(event, result);
                    if (result.status === 'accepted') {
                        notifySnapshotListeners(result.evaluatedAt);
                    }
                },
            });
            for (const sensorEntry of sensors) {
                sensorEntry.adapter = createAdapter(sensorEntry);
                sensorEntry.sensor.tick(clock.now());
            }
            snapshotBroadcastTimerHandle = snapshotBroadcastTimer.setInterval(() => {
                notifyHealthChanges(clock.now());
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
            if (!findSensor(deviceId)) return undefined;

            return {
                deviceId,
                scenarios: temperatureScenarioActions.map((action) => ({ action })),
            };
        },
        runDeviceScenario(deviceId, action) {
            const sensorEntry = findSensor(deviceId);
            if (!sensorEntry) {
                throw new Error(`No development scenarios are configured for ${deviceId}.`);
            }
            if (!hasStarted) {
                throw new Error(
                    'Temperature room runtime must be started before running a scenario.',
                );
            }

            const observedAt = clock.now();

            runScenarioAction(sensorEntry, action, observedAt);

            return {
                action,
                status: 'completed',
            };
        },
        dispatchLedCommand(command) {
            if (!hasStarted || !ledAdapter) {
                throw new Error(
                    'Temperature room runtime must be started before dispatching LED commands.',
                );
            }

            ledAdapter.dispatch(command);
        },
    };

    function runScenarioAction(
        sensorEntry: (typeof sensors)[number],
        action: TemperatureScenarioAction,
        observedAt: string,
    ): void {
        const scenarioHandlers = {
            pause_telemetry(observedAt: string) {
                sensorEntry.runtime?.stop();
                sensorEntry.sensor.pauseTelemetry(observedAt);
            },
            resume_telemetry(observedAt: string) {
                sensorEntry.sensor.resumeTelemetry(observedAt);
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
            reset(observedAt: string) {
                sensorEntry.runtime?.stop();
                sensorEntry.adapter?.stop();
                sensorEntry.sensor.reset();
                sensorEntry.adapter = createAdapter(sensorEntry);
                sensorEntry.sensor.tick(observedAt);
                sensorEntry.runtime?.start();
            },
        } satisfies Record<TemperatureScenarioAction, (observedAt: string) => void>;

        scenarioHandlers[action](observedAt);
    }

    function createAdapter(sensorEntry: (typeof sensors)[number]): SimulatorTemperatureAdapter {
        return createSimulatorTemperatureAdapter({
            sensor: sensorEntry.sensor,
            nativeSensorId: sensorEntry.definition.nativeSensorId,
            platformDeviceId: sensorEntry.definition.deviceId,
            generateEventId,
            emitEvent(event) {
                const result = processor.processEvent(event);

                diagnostics.recordProcessingResult(event, result);

                if (result.status === 'accepted') {
                    notifySnapshotListeners(result.evaluatedAt);
                }
            },
        });
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

    function notifyHealthChanges(evaluatedAt: string): void {
        const snapshot = toRoomSnapshot(roomName, roomProjector, evaluatedAt);
        const previousSnapshot = lastPublishedSnapshot;

        if (
            previousSnapshot &&
            snapshot.devices.every((device) => {
                const previous = previousSnapshot.devices.find(
                    (candidate) => candidate.deviceId === device.deviceId,
                );

                return previous?.health === device.health;
            })
        ) {
            return;
        }

        notifySnapshotListeners(evaluatedAt);
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
