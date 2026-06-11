import type { TemperatureSensorSimulator } from '../../../../simulator/src';
import type { TelemetryReadingRecordedEvent } from '../../../../shared/src/events';

export type PlatformEventSink = (event: TelemetryReadingRecordedEvent) => void;
export type EventIdGenerator = () => string;

export interface SimulatorTemperatureAdapterConfig {
    sensor: TemperatureSensorSimulator;
    deviceId: string;
    generateEventId: EventIdGenerator;
    emitEvent: PlatformEventSink;
}

export interface SimulatorTemperatureAdapter {
    stop(): void;
}

export function createSimulatorTemperatureAdapter({
    sensor,
    deviceId,
    generateEventId,
    emitEvent,
}: SimulatorTemperatureAdapterConfig): SimulatorTemperatureAdapter {
    const unsubscribe = sensor.onReading((reading) => {
        emitEvent({
            eventId: generateEventId(),
            eventType: 'telemetry.reading.recorded',
            version: 1,
            occurredAt: reading.recordedAt,
            source: 'simulator-adapter',
            deviceId,
            payload: {
                metric: 'temperature',
                value: reading.value,
                unit: reading.unit,
            },
        });
    });

    return {
        stop() {
            unsubscribe();
        },
    };
}
