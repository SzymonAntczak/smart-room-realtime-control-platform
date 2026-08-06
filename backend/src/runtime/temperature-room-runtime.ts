import { randomUUID } from 'node:crypto';
import { clearInterval, setInterval, setTimeout } from 'node:timers';

import type {
    AcceptedCommandResponse,
    RejectedCommandResponse,
    SetPowerCommandRequest,
} from '@smart-room/contracts/commands';
import type {
    DeviceScenarioList,
    TemperatureScenarioAction,
    TemperatureScenarioResult,
} from '@smart-room/contracts/development';
import { temperatureScenarioActions } from '@smart-room/contracts/development';
import type {
    CommandFailedEvent,
    PlatformEvent,
} from '@smart-room/contracts/events';
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
    commandTimer?: CommandTimer;
}

export interface CommandTimer {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(timerHandle: unknown): void;
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
    requestCommand(request: SetPowerCommandRequest): AcceptedCommandResponse | RejectedCommandResponse;
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
    commandTimer = realCommandTimer,
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
    const commandTimeoutHandles = new Map<string, unknown>();

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
                    processPlatformEvent(event);
                },
            });
            processPlatformEvent({
                eventId: generateEventId(),
                eventType: 'device.state.reported',
                occurredAt: clock.now(),
                source: 'simulator-adapter',
                deviceId: 'led-main',
                payload: {
                    reportedState: { power: led.getObservedPower() },
                    reportedAt: clock.now(),
                },
            });
            reschedulePendingCommands();
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
            for (const timerHandle of commandTimeoutHandles.values()) {
                commandTimer.clearTimeout(timerHandle);
            }
            commandTimeoutHandles.clear();
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
        requestCommand(request) {
            const commandId = randomUUID();
            const snapshot = getCurrentRoomSnapshot();
            const device = snapshot.devices.find((candidate) => candidate.deviceId === request.deviceId);

            if (!hasStarted || !ledAdapter || !device) {
                return rejected(commandId, 'unsupported_command', 'Device does not support this command.');
            }
            if (device.commandAvailability.policy === 'block') {
                return rejected(
                    commandId,
                    device.commandAvailability.reason ?? 'command_unavailable',
                    'Commands are not available for this device.',
                );
            }
            if (request.deviceId !== 'led-main') {
                return rejected(commandId, 'unsupported_command', 'Device does not support this command.');
            }
            if (snapshot.activeCommands.some((command) => command.deviceId === request.deviceId)) {
                processPlatformEvent(rejectedCommandEvent(commandId, request, clock.now()));
                return rejected(
                    commandId,
                    'command_already_active',
                    'Device already has an active command.',
                );
            }

            const requestedAt = clock.now();
            processPlatformEvent({
                eventId: generateEventId(),
                eventType: 'command.requested',
                occurredAt: requestedAt,
                source: 'backend',
                deviceId: request.deviceId,
                commandId,
                payload: {
                    commandType: request.commandType,
                    requestedState: request.requestedState,
                    requestedBy: 'user',
                },
            });
            processPlatformEvent({
                eventId: generateEventId(),
                eventType: 'command.dispatched',
                occurredAt: clock.now(),
                source: 'backend',
                deviceId: request.deviceId,
                commandId,
                payload: { commandType: request.commandType, target: 'simulator-adapter' },
            });
            try {
                ledAdapter.dispatch({ ...request, commandId });
            } catch {
                processPlatformEvent({
                    eventId: generateEventId(),
                    eventType: 'command.failed',
                    occurredAt: clock.now(),
                    source: 'backend',
                    deviceId: request.deviceId,
                    commandId,
                    payload: {
                        reason: 'dispatch_failed',
                        message: 'The command could not be dispatched to the device adapter.',
                    },
                });
                throw new Error('Command dispatch failed.');
            }
            scheduleTimeout(commandId, request.deviceId);
            return { commandId, status: 'accepted' };
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
                processPlatformEvent(event);
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

    function processPlatformEvent(event: PlatformEvent): void {
        const activeCommandIdBeforeEvent = event.deviceId
            ? roomProjector
                  .getProjection()
                  .activeCommands.find((command) => command.deviceId === event.deviceId)?.commandId
            : undefined;
        const result = processor.processEvent(event);
        diagnostics.recordProcessingResult(event, result);
        if (result.status === 'accepted') {
            clearCompletedCommandTimeout(activeCommandIdBeforeEvent, result.state.activeCommands);
            clearCompletedCommandTimeout(event.commandId, result.state.activeCommands);
            notifySnapshotListeners(result.evaluatedAt);
        }
    }

    function scheduleTimeout(commandId: string, deviceId: string): void {
        const active = getCurrentRoomSnapshot().activeCommands.find(
            (command) => command.commandId === commandId && command.status === 'pending',
        );
        if (!active || active.status !== 'pending') return;
        const remainingMs = Math.max(
            0,
            5_000 - (Date.parse(clock.now()) - Date.parse(active.dispatchedAt)),
        );
        commandTimeoutHandles.set(
            commandId,
            commandTimer.setTimeout(() => {
                commandTimeoutHandles.delete(commandId);
                processPlatformEvent({
                    eventId: generateEventId(),
                    eventType: 'command.timed_out',
                    occurredAt: clock.now(),
                    source: 'backend',
                    deviceId,
                    commandId,
                    payload: { timeoutMs: 5_000, reason: 'confirmation_not_received' },
                });
            }, remainingMs),
        );
    }

    function reschedulePendingCommands(): void {
        for (const command of getCurrentRoomSnapshot().activeCommands) {
            if (command.status === 'pending') {
                scheduleTimeout(command.commandId, command.deviceId);
            }
        }
    }

    function clearCompletedCommandTimeout(
        commandId: string | undefined,
        activeCommands: RoomSnapshotProjection['activeCommands'],
    ): void {
        if (!commandId || activeCommands.some((command) => command.commandId === commandId)) return;
        const timerHandle = commandTimeoutHandles.get(commandId);
        if (timerHandle !== undefined) commandTimer.clearTimeout(timerHandle);
        commandTimeoutHandles.delete(commandId);
    }

    function getCurrentRoomSnapshot(): RoomSnapshotProjection {
        return toRoomSnapshot(roomName, roomProjector, clock.now());
    }
}

function rejected(
    commandId: string,
    reason: string,
    message: string,
): RejectedCommandResponse {
    return { commandId, status: 'rejected', reason, message };
}

function rejectedCommandEvent(
    commandId: string,
    request: SetPowerCommandRequest,
    occurredAt: string,
): CommandFailedEvent {
    return {
        eventId: randomUUID(),
        eventType: 'command.failed',
        occurredAt,
        source: 'backend',
        deviceId: request.deviceId,
        commandId,
        payload: {
            reason: 'command_already_active',
            message: 'Device already has an active command.',
            commandType: request.commandType,
            requestedState: request.requestedState,
            requestedAt: occurredAt,
        },
    };
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
