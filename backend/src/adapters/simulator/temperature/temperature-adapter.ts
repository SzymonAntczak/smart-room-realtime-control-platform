import type {
    DeviceAvailabilityChangedEvent,
    DeviceHealthChangedEvent,
    TelemetryReadingRecordedEvent,
} from '@smart-room/contracts/events';
import type { TemperatureSensorSimulator } from '@smart-room/simulator';

import type { EventIdGenerator, PlatformEventSink } from '../../../platform/ports/event-sink';

export interface SimulatorTemperatureAdapterConfig {
    sensor: TemperatureSensorSimulator;
    nativeSensorId: string;
    platformDeviceId: string;
    generateEventId: EventIdGenerator;
    emitEvent: PlatformEventSink<TelemetryReadingRecordedEvent>;
    emitAvailabilityEvent?: PlatformEventSink<DeviceAvailabilityChangedEvent>;
    emitHealthEvent?: PlatformEventSink<DeviceHealthChangedEvent>;
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
    emitAvailabilityEvent,
    emitHealthEvent,
}: SimulatorTemperatureAdapterConfig): SimulatorTemperatureAdapter {
    const replayableEventsBySequence = new Map<number, TelemetryReadingRecordedEvent>();
    const unsubscribe = sensor.onReading((reading) => {
        if (reading.sensorId !== nativeSensorId) {
            return;
        }

        const replayedEvent = replayableEventsBySequence.get(reading.sequence);

        if (replayedEvent) {
            emitEvent(replayedEvent);

            return;
        }

        const event: TelemetryReadingRecordedEvent = {
            eventId: generateEventId(),
            eventType: 'telemetry.reading.recorded',
            occurredAt: reading.recordedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            payload: {
                metric: 'temperature',
                value: reading.value,
                unit: reading.unit,
            },
        };

        replayableEventsBySequence.set(reading.sequence, event);
        trimReplayableEvents(replayableEventsBySequence);
        emitEvent(event);
    });
    const unsubscribeFromAvailability = sensor.onAvailability((report) => {
        if (report.sensorId !== nativeSensorId) {
            return;
        }

        emitAvailabilityEvent?.({
            eventId: generateEventId(),
            eventType: 'device.availability.changed',
            occurredAt: report.reportedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            payload: {
                previousAvailability: report.previousAvailability,
                availability: report.availability,
                reason: 'simulator_reported',
            },
        });
    });
    const unsubscribeFromHealth = sensor.onHealth((report) => {
        if (report.sensorId !== nativeSensorId) {
            return;
        }

        emitHealthEvent?.({
            eventId: generateEventId(),
            eventType: 'device.health.changed',
            occurredAt: report.reportedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            payload: {
                previousHealth: report.previousHealth,
                health: report.health,
                reason: report.reason,
            },
        });
    });

    return {
        stop() {
            unsubscribe();
            unsubscribeFromAvailability();
            unsubscribeFromHealth();
        },
    };
}

function trimReplayableEvents(eventsBySequence: Map<number, TelemetryReadingRecordedEvent>): void {
    const replayEventLimit = 2;

    while (eventsBySequence.size > replayEventLimit) {
        const oldestSequence = eventsBySequence.keys().next().value;

        if (oldestSequence === undefined) {
            return;
        }

        eventsBySequence.delete(oldestSequence);
    }
}
