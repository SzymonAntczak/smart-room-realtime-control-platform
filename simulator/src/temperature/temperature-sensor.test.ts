import { describe, expect, it } from 'vitest';

import {
    createTemperatureSensorSimulator,
    type TemperatureReadingMessage,
} from './temperature-sensor';

describe('createTemperatureSensorSimulator', () => {
    it('emits the first native temperature reading from the configured sensor', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22.1,
            readingPattern: [0, 0.2, 0.4],
        });
        const readings: TemperatureReadingMessage[] = [];

        sensor.onReading((reading) => readings.push(reading));
        const reading = sensor.tick('2026-06-08T09:30:00Z');

        expect(reading).toEqual({
            messageType: 'temperature.reading',
            sensorId: 'temp-desk',
            sequence: 0,
            value: 22.1,
            unit: 'celsius',
            recordedAt: '2026-06-08T09:30:00Z',
        });
        expect(readings).toEqual([reading]);
    });

    it('cycles through the configured reading pattern deterministically', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0, 0.2, -0.1],
        });

        expect(sensor.tick('2026-06-08T09:30:00Z')).toMatchObject({
            sequence: 0,
            value: 22,
        });
        expect(sensor.tick('2026-06-08T09:30:01Z')).toMatchObject({
            sequence: 1,
            value: 22.2,
        });
        expect(sensor.tick('2026-06-08T09:30:02Z')).toMatchObject({
            sequence: 2,
            value: 21.9,
        });
        expect(sensor.tick('2026-06-08T09:30:03Z')).toMatchObject({
            sequence: 3,
            value: 22,
        });
    });

    it('stops delivering readings after unsubscribe', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });
        const readings: TemperatureReadingMessage[] = [];

        const unsubscribe = sensor.onReading((reading) => readings.push(reading));

        sensor.tick('2026-06-08T09:30:00Z');
        unsubscribe();
        sensor.tick('2026-06-08T09:30:01Z');

        expect(readings).toHaveLength(1);
        expect(readings[0]?.sequence).toBe(0);
    });

    it('delivers isolated native reading objects to multiple listeners', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });
        const firstListenerReadings: TemperatureReadingMessage[] = [];
        const secondListenerReadings: TemperatureReadingMessage[] = [];

        sensor.onReading((reading) => firstListenerReadings.push(reading));
        sensor.onReading((reading) => secondListenerReadings.push(reading));

        const reading = sensor.tick('2026-06-08T09:30:00Z');

        expect(firstListenerReadings).toEqual([reading]);
        expect(secondListenerReadings).toEqual([reading]);
        expect(firstListenerReadings[0]).not.toBe(secondListenerReadings[0]);
        expect(firstListenerReadings[0]).not.toBe(reading);
        expect(secondListenerReadings[0]).not.toBe(reading);
    });

    it('prevents one listener from mutating the reading observed by another listener', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });
        const readings: TemperatureReadingMessage[] = [];

        sensor.onReading((reading) => {
            (reading as { value: number }).value = 999;
        });
        sensor.onReading((reading) => readings.push(reading));

        const reading = sensor.tick('2026-06-08T09:30:00Z');

        expect(reading.value).toBe(22);
        expect(readings[0]?.value).toBe(22);
    });

    it('rejects an empty sensor id', () => {
        expect(() =>
            createTemperatureSensorSimulator({
                sensorId: '   ',
                baseTemperature: 22,
                readingPattern: [0],
            }),
        ).toThrow('Temperature sensorId must be a non-empty string.');
    });

    it('rejects non-finite base temperatures', () => {
        expect(() =>
            createTemperatureSensorSimulator({
                sensorId: 'temp-desk',
                baseTemperature: Number.NaN,
                readingPattern: [0],
            }),
        ).toThrow('Temperature baseTemperature must be a finite number.');
    });

    it('rejects non-finite reading pattern values', () => {
        expect(() =>
            createTemperatureSensorSimulator({
                sensorId: 'temp-desk',
                baseTemperature: 22,
                readingPattern: [Number.POSITIVE_INFINITY],
            }),
        ).toThrow('Temperature readingPattern values must be finite numbers.');
    });

    it('rejects invalid reading timestamps', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });

        expect(() => sensor.tick('not-a-date')).toThrow(
            'Temperature reading recordedAt must be a valid timestamp string.',
        );
    });
});
