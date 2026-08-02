import { randomUUID } from 'node:crypto';
import { clearInterval, setInterval } from 'node:timers';

import type {
    DeviceScenarioList,
    RoomSnapshotProjection,
    TemperatureScenarioAction,
    TemperatureScenarioResult,
} from '@smart-room/contracts';
import { temperatureScenarioActions } from '@smart-room/contracts';
import {
    type Clock,
    createTemperatureSensorRuntime,
    createTemperatureSensorScenario,
    type TemperatureSensorRuntime,
    type TimerScheduler,
} from '@smart-room/simulator';

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
}

export type RoomSnapshotListener = (snapshot: RoomSnapshotProjection) => void;

const defaultDevices: DeviceDefinition[] = [
    {
        deviceId: 'temp-desk',
        name: 'Desk Temperature',
        role: 'temperature-sensor',
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
}: TemperatureRoomRuntimeConfig = {}): TemperatureRoomRuntime {
    const sensor = createTemperatureSensorScenario({
        sensorId: 'temp-desk-native',
        baseTemperature: 22,
        readingPattern,
    });
    const roomProjector = createRoomProjector({
        devices: defaultDevices,
        initialUpdatedAt: clock.now(),
    });
    const processor = createEventProcessor({
        devices: defaultDevices,
        roomProjector,
        clock,
        deduplicationRetentionMs,
        deduplicationEntryLimit,
    });
    const diagnostics = createEventProcessingDiagnostics({
        clock,
        diagnosticEventLimit,
    });
    const sensorRuntime: TemperatureSensorRuntime = createTemperatureSensorRuntime({
        sensor,
        intervalMs,
        clock,
        timer,
    });
    const snapshotBroadcastTimer = timer ?? (realTimer as TimerScheduler);
    const snapshotListeners = new Set<RoomSnapshotListener>();
    let hasStarted = false;
    let adapter: SimulatorTemperatureAdapter | undefined;
    let snapshotBroadcastTimerHandle: unknown | undefined;
    let lastPublishedSnapshot: RoomSnapshotProjection | undefined;

    return {
        start() {
            if (hasStarted) {
                return;
            }

            hasStarted = true;
            adapter = createAdapter();
            sensor.tick(clock.now());
            snapshotBroadcastTimerHandle = snapshotBroadcastTimer.setInterval(() => {
                notifyHealthChanges(clock.now());
            }, snapshotBroadcastIntervalMs);
            sensorRuntime.start();
        },
        stop() {
            sensorRuntime.stop();
            if (snapshotBroadcastTimerHandle !== undefined) {
                snapshotBroadcastTimer.clearInterval(snapshotBroadcastTimerHandle);
                snapshotBroadcastTimerHandle = undefined;
            }
            adapter?.stop();
            adapter = undefined;
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
            if (deviceId !== defaultDevices[0].deviceId) return undefined;

            return {
                deviceId,
                scenarios: temperatureScenarioActions.map((action) => ({ action })),
            };
        },
        runDeviceScenario(deviceId, action) {
            if (deviceId !== defaultDevices[0].deviceId) {
                throw new Error(`No development scenarios are configured for ${deviceId}.`);
            }
            if (!hasStarted) {
                throw new Error(
                    'Temperature room runtime must be started before running a scenario.',
                );
            }

            const observedAt = clock.now();

            runScenarioAction(action, observedAt);

            return {
                action,
                status: 'completed',
            };
        },
    };

    function runScenarioAction(action: TemperatureScenarioAction, observedAt: string): void {
        const scenarioHandlers = {
            pause_telemetry(observedAt: string) {
                sensorRuntime.stop();
                sensor.pauseTelemetry(observedAt);
            },
            resume_telemetry(observedAt: string) {
                sensor.resumeTelemetry(observedAt);
                sensorRuntime.start();
            },
            replay_last_reading() {
                sensor.replayLastReading();
            },
            emit_invalid_reading(observedAt: string) {
                sensor.emitInvalidReading(observedAt);
            },
            emit_next_reading(observedAt: string) {
                sensor.tick(observedAt);
            },
            reset(observedAt: string) {
                sensorRuntime.stop();
                adapter?.stop();
                sensor.reset();
                adapter = createAdapter();
                sensor.tick(observedAt);
                sensorRuntime.start();
            },
        } satisfies Record<TemperatureScenarioAction, (observedAt: string) => void>;

        scenarioHandlers[action](observedAt);
    }

    function createAdapter(): SimulatorTemperatureAdapter {
        return createSimulatorTemperatureAdapter({
            sensor,
            nativeSensorId: 'temp-desk-native',
            platformDeviceId: 'temp-desk',
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
        recentEvents: projection.recentEvents,
    };
}
