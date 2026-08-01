import type { TelemetryReadingRecordedEvent } from '@smart-room/contracts';
import type { TemperatureSensorSimulator } from '@smart-room/simulator';

import type { EventIdGenerator, PlatformEventSink } from '../../../platform/ports/event-sink';

export interface SimulatorTemperatureAdapterConfig {
    sensor: TemperatureSensorSimulator;
    nativeSensorId: string;
    platformDeviceId: string;
    generateEventId: EventIdGenerator;
    emitEvent: PlatformEventSink<TelemetryReadingRecordedEvent>;
}

export interface SimulatorTemperatureAdapter {
    stop(): void;
}

export function createSimulatorTemperatureAdapter({
    sensor,
    nativeSensorId,
    platformDeviceId,
    generateEventId,
    emitEvent,
}: SimulatorTemperatureAdapterConfig): SimulatorTemperatureAdapter {
    const recentEventsBySequence = new Map<number, TelemetryReadingRecordedEvent>();
    const unsubscribe = sensor.onReading((reading) => {
        if (reading.sensorId !== nativeSensorId) {
            return;
        }

        const replayedEvent = recentEventsBySequence.get(reading.sequence);

        if (replayedEvent) {
            emitEvent(replayedEvent);
            return;
        }

        const event: TelemetryReadingRecordedEvent = {
            eventId: generateEventId(),
            eventType: 'telemetry.reading.recorded',
            version: 1,
            occurredAt: reading.recordedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            payload: {
                metric: 'temperature',
                value: reading.value,
                unit: reading.unit,
            },
        };

        recentEventsBySequence.set(reading.sequence, event);
        trimRecentEvents(recentEventsBySequence);
        emitEvent(event);
    });

    return {
        stop() {
            unsubscribe();
        },
    };
}

function trimRecentEvents(eventsBySequence: Map<number, TelemetryReadingRecordedEvent>): void {
    const replayEventLimit = 2;

    while (eventsBySequence.size > replayEventLimit) {
        const oldestSequence = eventsBySequence.keys().next().value;

        if (oldestSequence === undefined) {
            return;
        }

        eventsBySequence.delete(oldestSequence);
    }
}
