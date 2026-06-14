import { randomUUID } from 'node:crypto';
import {
    createTemperatureSensorRuntime,
    createTemperatureSensorSimulator,
    type Clock,
    type TimerScheduler,
    type TemperatureSensorRuntime,
} from '../../../simulator/src';
import type { RoomSnapshotProjection } from '../../../shared/src/projections';
import {
    createSimulatorTemperatureAdapter,
    type SimulatorTemperatureAdapter,
} from '../adapters/simulator/temperature/temperature-adapter';
import {
    createEventProcessor,
    type DeviceDefinition,
} from '../platform/event-processing/event-processor';
import {
    createEventProcessingDiagnostics,
    type EventProcessingDiagnosticsSnapshot,
} from '../platform/event-processing/event-processing-diagnostics';
import { createRoomProjector, type RoomProjector } from '../platform/read-model/room-projection';

export interface TemperatureRoomRuntimeConfig {
    roomName?: string;
    intervalMs?: number;
    clock?: Clock;
    timer?: TimerScheduler;
    generateEventId?: () => string;
    diagnosticEventLimit?: number;
}

export interface TemperatureRoomRuntime {
    start(): void;
    stop(): void;
    getRoomSnapshot(): RoomSnapshotProjection;
    getDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot;
}

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
    clock = realClock,
    timer,
    generateEventId = randomUUID,
    diagnosticEventLimit,
}: TemperatureRoomRuntimeConfig = {}): TemperatureRoomRuntime {
    const sensor = createTemperatureSensorSimulator({
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
    let hasStarted = false;
    let adapter: SimulatorTemperatureAdapter | undefined;

    return {
        start() {
            if (hasStarted) {
                return;
            }

            hasStarted = true;
            adapter = createSimulatorTemperatureAdapter({
                sensor,
                deviceId: 'temp-desk',
                generateEventId,
                emitEvent(event) {
                    diagnostics.recordProcessingResult(event, processor.processEvent(event));
                },
            });
            sensor.tick(clock.now());
            sensorRuntime.start();
        },
        stop() {
            sensorRuntime.stop();
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
    };
}

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
        recentEvents: projection.recentEvents,
    };
}
