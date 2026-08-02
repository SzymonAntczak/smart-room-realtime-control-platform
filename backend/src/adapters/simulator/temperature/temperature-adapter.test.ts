import type { TelemetryReadingRecordedEvent } from '@smart-room/contracts';
import {
    createTemperatureSensorSimulator,
    type TemperatureReadingMessage,
    type TemperatureSensorSimulator,
} from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { createSimulatorTemperatureAdapter } from './temperature-adapter';

describe('createSimulatorTemperatureAdapter', () => {
    it('emits a platform telemetry event for a native temperature reading', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk-native',
            baseTemperature: 22,
            readingPattern: [0.5],
        });
        const emittedEvents: TelemetryReadingRecordedEvent[] = [];

        createSimulatorTemperatureAdapter({
            sensor,
            nativeSensorId: 'temp-desk-native',
            platformDeviceId: 'temp-desk',
            generateEventId: () => 'evt-temperature-1',
            emitEvent: (event) => emittedEvents.push(event),
        });

        sensor.tick('2026-06-08T09:30:00Z');

        expect(emittedEvents).toEqual([
            {
                eventId: 'evt-temperature-1',
                eventType: 'telemetry.reading.recorded',
                occurredAt: '2026-06-08T09:30:00Z',
                source: 'simulator-adapter',
                deviceId: 'temp-desk',
                payload: {
                    metric: 'temperature',
                    value: 22.5,
                    unit: 'celsius',
                },
            },
        ]);
    });

    it('uses the injected event id generator for each emitted reading', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk-native',
            baseTemperature: 22,
            readingPattern: [0, 0.2],
        });
        const eventIds = ['evt-temperature-1', 'evt-temperature-2'];
        const emittedEvents: TelemetryReadingRecordedEvent[] = [];

        createSimulatorTemperatureAdapter({
            sensor,
            nativeSensorId: 'temp-desk-native',
            platformDeviceId: 'temp-desk',
            generateEventId: () => {
                const eventId = eventIds.shift();

                if (!eventId) {
                    throw new Error('No deterministic event id configured for this reading.');
                }

                return eventId;
            },
            emitEvent: (event) => emittedEvents.push(event),
        });

        sensor.tick('2026-06-08T09:30:00Z');
        sensor.tick('2026-06-08T09:30:01Z');

        expect(emittedEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-1',
            'evt-temperature-2',
        ]);
    });

    it('stops emitting platform events after stop', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk-native',
            baseTemperature: 22,
            readingPattern: [0],
        });
        const emittedEvents: TelemetryReadingRecordedEvent[] = [];
        const adapter = createSimulatorTemperatureAdapter({
            sensor,
            nativeSensorId: 'temp-desk-native',
            platformDeviceId: 'temp-desk',
            generateEventId: () => 'evt-temperature-1',
            emitEvent: (event) => emittedEvents.push(event),
        });

        sensor.tick('2026-06-08T09:30:00Z');
        adapter.stop();
        sensor.tick('2026-06-08T09:30:01Z');

        expect(emittedEvents).toHaveLength(1);
        expect(emittedEvents[0]?.occurredAt).toBe('2026-06-08T09:30:00Z');
    });

    it('rejects an unexpected native sensor before event generation or replay caching', () => {
        const nativeSensor = createControllableNativeSensor();
        const emittedEvents: TelemetryReadingRecordedEvent[] = [];
        let generatedEventCount = 0;

        createSimulatorTemperatureAdapter({
            sensor: nativeSensor.sensor,
            nativeSensorId: 'temp-desk-native',
            platformDeviceId: 'temp-desk',
            generateEventId: () => {
                generatedEventCount += 1;
                return 'evt-temperature-1';
            },
            emitEvent: (event) => emittedEvents.push(event),
        });

        nativeSensor.emit(createReading({ sensorId: 'unexpected-native', sequence: 3 }));
        nativeSensor.emit(createReading({ sensorId: 'temp-desk-native', sequence: 3 }));

        expect(generatedEventCount).toBe(1);
        expect(emittedEvents).toEqual([
            expect.objectContaining({
                eventId: 'evt-temperature-1',
                deviceId: 'temp-desk',
            }),
        ]);
    });

    it('replays a matching native reading with its original platform event', () => {
        const nativeSensor = createControllableNativeSensor();
        const emittedEvents: TelemetryReadingRecordedEvent[] = [];
        let generatedEventCount = 0;

        createSimulatorTemperatureAdapter({
            sensor: nativeSensor.sensor,
            nativeSensorId: 'temp-desk-native',
            platformDeviceId: 'temp-desk',
            generateEventId: () => {
                generatedEventCount += 1;
                return 'evt-temperature-1';
            },
            emitEvent: (event) => emittedEvents.push(event),
        });

        const reading = createReading({ sensorId: 'temp-desk-native', sequence: 3 });
        nativeSensor.emit(reading);
        nativeSensor.emit(reading);

        expect(generatedEventCount).toBe(1);
        expect(emittedEvents).toHaveLength(2);
        expect(emittedEvents[1]).toBe(emittedEvents[0]);
    });
});

function createControllableNativeSensor(): {
    sensor: TemperatureSensorSimulator;
    emit(reading: TemperatureReadingMessage): void;
} {
    const listeners = new Set<(reading: TemperatureReadingMessage) => void>();

    return {
        sensor: {
            onReading(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            tick(recordedAt) {
                return createReading({ recordedAt });
            },
        },
        emit(reading) {
            for (const listener of listeners) {
                listener(reading);
            }
        },
    };
}

function createReading({
    sensorId = 'temp-desk-native',
    sequence = 0,
    recordedAt = '2026-06-08T09:30:00Z',
}: Partial<
    Pick<TemperatureReadingMessage, 'sensorId' | 'sequence' | 'recordedAt'>
>): TemperatureReadingMessage {
    return {
        messageType: 'temperature.reading',
        sensorId,
        sequence,
        value: 22.5,
        unit: 'celsius',
        recordedAt,
    };
}
