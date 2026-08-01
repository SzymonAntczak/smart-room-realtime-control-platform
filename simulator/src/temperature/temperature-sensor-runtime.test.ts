import { describe, expect, it } from 'vitest';

import {
    createTemperatureSensorSimulator,
    type TemperatureReadingMessage,
} from './temperature-sensor';
import {
    type Clock,
    createTemperatureSensorRuntime,
    type TimerScheduler,
} from './temperature-sensor-runtime';

describe('createTemperatureSensorRuntime', () => {
    it('starts one interval with the configured sampling interval', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });
        const timer = createFakeTimer();

        const runtime = createTemperatureSensorRuntime({
            sensor,
            intervalMs: 1000,
            timer,
            clock: createFakeClock('2026-06-08T09:30:00Z'),
        });

        runtime.start();
        runtime.start();

        expect(timer.intervals).toEqual([
            {
                handle: 1,
                intervalMs: 1000,
                cleared: false,
            },
        ]);
        expect(runtime.isRunning()).toBe(true);
    });

    it('does not emit a reading synchronously when started', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });
        const readings: TemperatureReadingMessage[] = [];

        sensor.onReading((reading) => readings.push(reading));

        createTemperatureSensorRuntime({
            sensor,
            intervalMs: 1000,
            timer: createFakeTimer(),
            clock: createFakeClock('2026-06-08T09:30:00Z'),
        }).start();

        expect(readings).toEqual([]);
    });

    it('emits a sensor reading with the runtime clock when the interval fires', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0, 0.2],
        });
        const timer = createFakeTimer();
        const readings: TemperatureReadingMessage[] = [];

        sensor.onReading((reading) => readings.push(reading));

        createTemperatureSensorRuntime({
            sensor,
            intervalMs: 1000,
            timer,
            clock: createFakeClock('2026-06-08T09:30:01Z'),
        }).start();

        timer.fire(1);

        expect(readings).toEqual([
            {
                messageType: 'temperature.reading',
                sensorId: 'temp-desk',
                sequence: 0,
                value: 22,
                unit: 'celsius',
                recordedAt: '2026-06-08T09:30:01Z',
            },
        ]);
    });

    it('stops the active interval and prevents later interval firings from emitting readings', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });
        const timer = createFakeTimer();
        const readings: TemperatureReadingMessage[] = [];
        const runtime = createTemperatureSensorRuntime({
            sensor,
            intervalMs: 1000,
            timer,
            clock: createFakeClock('2026-06-08T09:30:01Z'),
        });

        sensor.onReading((reading) => readings.push(reading));

        runtime.start();
        runtime.stop();
        runtime.stop();
        timer.fire(1);

        expect(timer.intervals[0]?.cleared).toBe(true);
        expect(runtime.isRunning()).toBe(false);
        expect(readings).toEqual([]);
    });

    it('can restart after stop and continue emitting later readings', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0, 0.2],
        });
        const timer = createFakeTimer();
        const readings: TemperatureReadingMessage[] = [];
        const runtime = createTemperatureSensorRuntime({
            sensor,
            intervalMs: 1000,
            timer,
            clock: createSequenceClock(['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z']),
        });

        sensor.onReading((reading) => readings.push(reading));

        runtime.start();
        timer.fire(1);
        runtime.stop();
        runtime.start();
        timer.fire(2);

        expect(timer.intervals).toEqual([
            {
                handle: 1,
                intervalMs: 1000,
                cleared: true,
            },
            {
                handle: 2,
                intervalMs: 1000,
                cleared: false,
            },
        ]);
        expect(readings.map((reading) => reading.sequence)).toEqual([0, 1]);
        expect(readings.map((reading) => reading.recordedAt)).toEqual([
            '2026-06-08T09:30:01Z',
            '2026-06-08T09:30:02Z',
        ]);
    });

    it('rejects non-positive sampling intervals', () => {
        const sensor = createTemperatureSensorSimulator({
            sensorId: 'temp-desk',
            baseTemperature: 22,
            readingPattern: [0],
        });

        expect(() =>
            createTemperatureSensorRuntime({
                sensor,
                intervalMs: 0,
            }),
        ).toThrow(RangeError);
    });
});

interface FakeInterval {
    handle: number;
    intervalMs: number;
    callback: () => void;
    cleared: boolean;
}

function createFakeTimer(): TimerScheduler<number> & {
    intervals: Array<Omit<FakeInterval, 'callback'>>;
    fire(handle: number): void;
} {
    const intervals: FakeInterval[] = [];

    return {
        get intervals() {
            return intervals.map(({ handle, intervalMs, cleared }) => ({
                handle,
                intervalMs,
                cleared,
            }));
        },
        setInterval(callback, intervalMs) {
            const handle = intervals.length + 1;

            intervals.push({
                handle,
                intervalMs,
                callback,
                cleared: false,
            });

            return handle;
        },
        clearInterval(timerHandle) {
            const interval = intervals.find(({ handle }) => handle === timerHandle);

            if (interval) {
                interval.cleared = true;
            }
        },
        fire(handle) {
            const interval = intervals.find((candidate) => candidate.handle === handle);

            if (interval && !interval.cleared) {
                interval.callback();
            }
        },
    };
}

function createFakeClock(timestamp: string): Clock {
    return {
        now() {
            return timestamp;
        },
    };
}

function createSequenceClock(timestamps: string[]): Clock {
    let nextTimestampIndex = 0;

    return {
        now() {
            const timestamp = timestamps[nextTimestampIndex];
            nextTimestampIndex += 1;

            if (!timestamp) {
                throw new Error('Fake clock has no timestamp for this tick.');
            }

            return timestamp;
        },
    };
}
