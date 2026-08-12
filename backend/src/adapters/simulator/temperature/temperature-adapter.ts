import type {
    DeviceAvailabilityChangedEvent,
    DeviceHealthChangedEvent,
    TelemetryReadingRecordedEvent,
} from '@smart-room/contracts/events';
import type { TemperatureSensorSimulator } from '@smart-room/simulator';

import type { PlatformEventSink } from '../../../platform/ports/event-sink';

export interface SimulatorTemperatureAdapterConfig {
    sensor: TemperatureSensorSimulator;
    nativeSensorId: string;
    platformDeviceId: string;
    emitEvent: PlatformEventSink<
        TelemetryReadingRecordedEvent | DeviceAvailabilityChangedEvent | DeviceHealthChangedEvent
    >;
}

export interface SimulatorTemperatureAdapter {
    stop(): void;
}

export function createSimulatorTemperatureAdapter({
    sensor,
    nativeSensorId,
    platformDeviceId,
    emitEvent,
}: SimulatorTemperatureAdapterConfig): SimulatorTemperatureAdapter {
    const unsubscribe = sensor.onReading((reading) => {
        if (reading.sensorId !== nativeSensorId) {
            return;
        }

        const event: TelemetryReadingRecordedEvent = {
            eventId: toPlatformEventId(nativeSensorId, reading.messageId),
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

        emitEvent(event);
    });
    const unsubscribeFromAvailability = sensor.onAvailability((report) => {
        if (report.sensorId !== nativeSensorId) {
            return;
        }

        emitEvent({
            eventId: toPlatformEventId(nativeSensorId, report.messageId),
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

        emitEvent({
            eventId: toPlatformEventId(nativeSensorId, report.messageId),
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

function toPlatformEventId(nativeDeviceId: string, messageId: string): string {
    return `simulator-adapter:${nativeDeviceId}:${messageId}`;
}
