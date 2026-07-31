import { describe, expect, it } from 'vitest';
import type { TemperatureReadingMessage } from './temperature-sensor';
import { createTemperatureSensorScenario } from './temperature-sensor-scenarios';

describe('createTemperatureSensorScenario', () => {
    it('emits normal deterministic readings through the scenario boundary', () => {
        const scenario = createTemperatureScenario();
        const readings: TemperatureReadingMessage[] = [];

        scenario.onReading((reading) => readings.push(reading));

        scenario.tick('2026-06-08T09:30:00Z');
        scenario.tick('2026-06-08T09:30:01Z');

        expect(
            readings.map(({ sequence, value, recordedAt }) => ({ sequence, value, recordedAt })),
        ).toEqual([
            {
                sequence: 0,
                value: 22,
                recordedAt: '2026-06-08T09:30:00Z',
            },
            {
                sequence: 1,
                value: 22.2,
                recordedAt: '2026-06-08T09:30:01Z',
            },
        ]);
    });

    it('represents a telemetry stop without emitting a reading', () => {
        const scenario = createTemperatureScenario();
        const readings: TemperatureReadingMessage[] = [];

        scenario.onReading((reading) => readings.push(reading));

        const pause = scenario.pauseTelemetry('2026-06-08T09:30:03Z');

        expect(pause).toEqual({
            scenarioEvent: 'telemetry.pause',
            observedAt: '2026-06-08T09:30:03Z',
        });
        expect(readings).toEqual([]);
    });

    it('recovers with a fresh reading after a telemetry pause', () => {
        const scenario = createTemperatureScenario();
        const readings: TemperatureReadingMessage[] = [];

        scenario.onReading((reading) => readings.push(reading));

        scenario.tick('2026-06-08T09:30:00Z');
        scenario.pauseTelemetry('2026-06-08T09:30:10Z');
        scenario.tick('2026-06-08T09:30:11Z');

        expect(readings.map(({ sequence, recordedAt }) => ({ sequence, recordedAt }))).toEqual([
            {
                sequence: 0,
                recordedAt: '2026-06-08T09:30:00Z',
            },
            {
                sequence: 1,
                recordedAt: '2026-06-08T09:30:11Z',
            },
        ]);
    });

    it('replays the last native reading as a duplicate device message', () => {
        const scenario = createTemperatureScenario();
        const readings: TemperatureReadingMessage[] = [];

        scenario.onReading((reading) => readings.push(reading));

        scenario.tick('2026-06-08T09:30:00Z');
        const replayedReading = scenario.replayLastReading();

        expect(replayedReading).toEqual({
            messageType: 'temperature.reading',
            sensorId: 'temp-desk-native',
            sequence: 0,
            value: 22,
            unit: 'celsius',
            recordedAt: '2026-06-08T09:30:00Z',
        });
        expect(readings).toEqual([replayedReading, replayedReading]);
        expect(readings[0]).not.toBe(readings[1]);
    });

    it('rejects replay before any reading has been recorded', () => {
        const scenario = createTemperatureScenario();

        expect(() => scenario.replayLastReading()).toThrow(
            'Cannot replay temperature reading before one has been recorded.',
        );
    });

    it('emits an invalid native reading without changing the deterministic sequence', () => {
        const scenario = createTemperatureScenario();
        const readings: TemperatureReadingMessage[] = [];
        scenario.onReading((reading) => readings.push(reading));

        scenario.emitInvalidReading('2026-06-08T09:30:00Z');
        scenario.tick('2026-06-08T09:30:01Z');

        expect(readings.map(({ sequence, value }) => ({ sequence, value }))).toEqual([
            { sequence: 0, value: Number.NaN },
            { sequence: 1, value: 22.2 },
        ]);
    });

    it('resets the deterministic sequence and forgets its replayable reading', () => {
        const scenario = createTemperatureScenario();
        scenario.tick('2026-06-08T09:30:00Z');

        scenario.reset();

        expect(() => scenario.replayLastReading()).toThrow(
            'Cannot replay temperature reading before one has been recorded.',
        );
        expect(scenario.tick('2026-06-08T09:30:01Z')).toMatchObject({
            sequence: 0,
            value: 22,
        });
    });
});

function createTemperatureScenario() {
    return createTemperatureSensorScenario({
        sensorId: 'temp-desk-native',
        baseTemperature: 22,
        readingPattern: [0, 0.2],
    });
}
