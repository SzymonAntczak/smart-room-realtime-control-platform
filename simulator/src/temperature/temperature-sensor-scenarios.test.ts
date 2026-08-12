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

    it('suppresses periodic telemetry while offline and resumes with the next reading', () => {
        const scenario = createTemperatureScenario();
        const readings: TemperatureReadingMessage[] = [];
        scenario.onReading((reading) => readings.push(reading));

        scenario.tick('2026-06-08T09:30:00Z');
        scenario.disconnect('2026-06-08T09:30:01Z');
        scenario.tick('2026-06-08T09:30:02Z');
        scenario.emitInvalidReading('2026-06-08T09:30:03Z');
        scenario.replayLastReading();

        expect(readings).toHaveLength(1);
        expect(scenario.isOffline()).toBe(true);

        scenario.reconnect('2026-06-08T09:30:04Z');
        scenario.tick('2026-06-08T09:30:05Z');

        expect(scenario.isOffline()).toBe(false);
        expect(readings.map(({ sequence, recordedAt }) => ({ sequence, recordedAt }))).toEqual([
            { sequence: 0, recordedAt: '2026-06-08T09:30:00Z' },
            { sequence: 1, recordedAt: '2026-06-08T09:30:05Z' },
        ]);
    });

    it('replays the last native reading as a duplicate device message', () => {
        const scenario = createTemperatureScenario();
        const readings: TemperatureReadingMessage[] = [];

        scenario.onReading((reading) => readings.push(reading));

        scenario.tick('2026-06-08T09:30:00Z');
        const replayedReading = scenario.replayLastReading();

        expect(replayedReading).toEqual({
            messageId: expect.any(String),
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

    it('resets state without dropping availability or health subscriptions', () => {
        const scenario = createTemperatureScenario();
        scenario.tick('2026-06-08T09:30:00Z');
        const availability: unknown[] = [];
        const health: unknown[] = [];
        scenario.onAvailability((report) => availability.push(report));
        scenario.onHealth((report) => health.push(report));
        scenario.disconnect('2026-06-08T09:30:01Z');

        scenario.reset();

        expect(() => scenario.replayLastReading()).toThrow(
            'Cannot replay temperature reading before one has been recorded.',
        );
        expect(scenario.isOffline()).toBe(false);
        expect(scenario.tick('2026-06-08T09:30:01Z')).toMatchObject({
            sequence: 0,
            value: 22,
        });
        scenario.reportAvailability('online', '2026-06-08T09:30:02Z');
        scenario.reportHealth('healthy', 'recovered', '2026-06-08T09:30:03Z');

        expect(availability).toMatchObject([
            { previousAvailability: 'unknown', availability: 'offline' },
            { previousAvailability: 'unknown', availability: 'online' },
        ]);
        expect(health).toMatchObject([{ previousHealth: 'unknown', health: 'healthy' }]);
    });
});

function createTemperatureScenario() {
    return createTemperatureSensorScenario({
        sensorId: 'temp-desk-native',
        baseTemperature: 22,
        readingPattern: [0, 0.2],
    });
}
