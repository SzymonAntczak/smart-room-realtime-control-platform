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
} from '../../adapters/simulator/led/led-adapter';
import { createSqliteLedCommandReceiptPort } from '../../adapters/simulator/led/sqlite-led-command-receipt-port';
import {
    createSimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapter,
} from '../../adapters/simulator/temperature/temperature-adapter';
import type { SetPowerCommandDispatcher } from '../../platform/ports/set-power-command-dispatcher';
import type { DeviceDefinition } from '../../platform/read-model/room-projection';
import type { RoomStorage } from '../../platform/storage/room-storage';
import { StorageAvailabilityError } from '../../platform/storage/storage-errors';

interface TemperatureSensorDefinition extends DeviceDefinition {
    nativeSensorId: string;
    baseTemperature: number;
    intervalMsMultiplier: number;
}

export interface TemperatureRoomSources {
    readonly devices: DeviceDefinition[];
    readonly commandDispatcher: SetPowerCommandDispatcher;
    startCommandSources(): void;
    startObservationSources(): void;
    startPeriodicSources(): void;
    stopPeriodicSources(): void;
    stop(): void;
    getDeviceScenarios(deviceId: string): DeviceScenarioList | undefined;
    runDeviceScenario(deviceId: string, action: DeviceScenarioAction): DeviceScenarioResult;
}

export interface TemperatureRoomSourcesConfig {
    intervalMs: number;
    clock: Clock;
    timer?: TimerScheduler;
    generateNativeMessageId(): string;
    ledScenario: LedScenarioName;
    ledScenarioScheduler: LedScenarioScheduler;
    emitEvent(event: PlatformEvent): void;
    getRoomSnapshot(): RoomSnapshotProjection;
    getActiveStorage(): RoomStorage | undefined;
    onReceiptFailure(failure: LedReceiptFailure): void;
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

export function createTemperatureRoomSources({
    intervalMs,
    clock,
    timer,
    generateNativeMessageId,
    ledScenario,
    ledScenarioScheduler,
    emitEvent,
    getRoomSnapshot,
    getActiveStorage,
    onReceiptFailure,
}: TemperatureRoomSourcesConfig): TemperatureRoomSources {
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
    const devices: DeviceDefinition[] = defaultSensors.map(
        ({ deviceId, name, role, intervalMsMultiplier }) => ({
            deviceId,
            name,
            role,
            expectedIntervalMsByCapability: { temperature: intervalMs * intervalMsMultiplier },
        }),
    );
    devices.push({ deviceId: 'led-main', name: 'Main LED', role: 'led-output' });
    let led: ReturnType<typeof createLedScenario> | undefined;
    let ledAdapter: SimulatorLedAdapter | undefined;
    let hasStarted = false;

    for (const sensorEntry of sensors) {
        sensorEntry.runtime = createTemperatureSensorRuntime({
            sensor: sensorEntry.sensor,
            intervalMs: intervalMs * sensorEntry.definition.intervalMsMultiplier,
            clock,
            timer,
        });
    }

    const commandDispatcher: SetPowerCommandDispatcher = {
        dispatch(command, context) {
            if (!hasStarted || !ledAdapter) {
                throw new Error('The LED adapter is not available.');
            }

            return ledAdapter.dispatch(command, context);
        },
    };

    return {
        devices,
        commandDispatcher,
        startCommandSources() {
            hasStarted = true;
            const startedLed = attachLedScenario('off');
            startedLed.restoreDurablePlans();
            startedLed.reportAvailability('online', clock.now());
            startedLed.reportCurrentState(clock.now());
        },
        startObservationSources() {
            for (const sensorEntry of sensors) {
                sensorEntry.adapter = createAdapter(sensorEntry);
                sensorEntry.sensor.reportAvailability('online', clock.now());
                sensorEntry.sensor.tick(clock.now());
            }
        },
        startPeriodicSources() {
            for (const sensorEntry of sensors) {
                sensorEntry.runtime?.start();
            }
        },
        stopPeriodicSources() {
            for (const sensorEntry of sensors) {
                sensorEntry.runtime?.stop();
            }
        },
        stop() {
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
                    getRoomSnapshot().activeCommands.some(
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

            return { action, status: 'completed' };
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
        const handlers = {
            pause_telemetry() {
                sensorEntry.runtime?.stop();
            },
            resume_telemetry() {
                sensorEntry.runtime?.start();
            },
            replay_last_reading() {
                sensorEntry.sensor.replayLastReading();
            },
            emit_invalid_reading(at: string) {
                sensorEntry.sensor.emitInvalidReading(at);
            },
            emit_next_reading(at: string) {
                sensorEntry.sensor.tick(at);
            },
            emit_future_dated_reading(at: string) {
                sensorEntry.sensor.emitFutureDatedReading(
                    new Date(Date.parse(at) + 2_000).toISOString(),
                );
            },
            reset(at: string) {
                sensorEntry.runtime?.stop();
                sensorEntry.adapter?.stop();
                sensorEntry.sensor.reset();
                sensorEntry.adapter = createAdapter(sensorEntry);
                sensorEntry.sensor.tick(at);
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

        handlers[action](observedAt);
    }

    function createAdapter(sensorEntry: (typeof sensors)[number]): SimulatorTemperatureAdapter {
        return createSimulatorTemperatureAdapter({
            sensor: sensorEntry.sensor,
            nativeSensorId: sensorEntry.definition.nativeSensorId,
            platformDeviceId: sensorEntry.definition.deviceId,
            emitEvent,
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
            onReceiptFailure,
        });
        ledAdapter = createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            clock,
            emitEvent,
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
            const activeStorage = getActiveStorage();

            if (!activeStorage) {
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
