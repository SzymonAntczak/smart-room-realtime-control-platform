import type { TelemetryReadingRecordedEvent } from '@smart-room/contracts';
import { describe, expect, it } from 'vitest';

import { createTemperatureSensorSimulator } from '../../../../../simulator/src';

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
            deviceId: 'temp-desk',
            generateEventId: () => 'evt-temperature-1',
            emitEvent: (event) => emittedEvents.push(event),
        });

        sensor.tick('2026-06-08T09:30:00Z');

        expect(emittedEvents).toEqual([
            {
                eventId: 'evt-temperature-1',
                eventType: 'telemetry.reading.recorded',
                version: 1,
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
            deviceId: 'temp-desk',
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
            deviceId: 'temp-desk',
            generateEventId: () => 'evt-temperature-1',
            emitEvent: (event) => emittedEvents.push(event),
        });

        sensor.tick('2026-06-08T09:30:00Z');
        adapter.stop();
        sensor.tick('2026-06-08T09:30:01Z');

        expect(emittedEvents).toHaveLength(1);
        expect(emittedEvents[0]?.occurredAt).toBe('2026-06-08T09:30:00Z');
    });
});
