import { describe, expect, it } from 'vitest';
import type { Clock, TimerScheduler } from '../../../simulator/src';
import { createTemperatureRoomRuntime } from './temperature-room-runtime';

describe('createTemperatureRoomRuntime', () => {
    it('starts with an immediate temperature reading from the injected clock', () => {
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 10_000,
            clock: createSequenceClock(['2026-06-08T09:29:59Z', '2026-06-08T09:30:00Z']),
        });

        try {
            runtime.start();

            const snapshot = runtime.getRoomSnapshot();

            expect(snapshot.roomName).toBe('Smart Room');
            expect(snapshot.devices).toEqual([
                expect.objectContaining({
                    deviceId: 'temp-desk',
                    name: 'Desk Temperature',
                    role: 'temperature-sensor',
                    health: 'online',
                    reportedState: {
                        temperature: 22,
                        temperatureUnit: 'celsius',
                    },
                    commandAvailability: {
                        policy: 'block',
                        reason: 'read_only_device',
                    },
                }),
            ]);
            expect(snapshot.activeCommands).toEqual([]);
            expect(snapshot.recentEvents).toEqual([
                expect.objectContaining({
                    eventId: 'evt-temperature-1',
                    eventType: 'telemetry.reading.recorded',
                    source: 'simulator-adapter',
                    deviceId: 'temp-desk',
                    summary: 'Temperature reading recorded',
                }),
            ]);
            expect(snapshot.updatedAt).toBe('2026-06-08T09:30:00Z');
            expect(snapshot.devices[0]?.lastSeenAt).toBe('2026-06-08T09:30:00Z');
            expect(snapshot.recentEvents[0]?.occurredAt).toBe('2026-06-08T09:30:00Z');
        } finally {
            runtime.stop();
        }
    });

    it('uses the injected timer for scheduled temperature readings', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
            ]),
            timer,
        });

        try {
            runtime.start();

            timer.runLatest();

            const snapshot = runtime.getRoomSnapshot();

            expect(snapshot.updatedAt).toBe('2026-06-08T09:30:01Z');
            expect(snapshot.devices[0]?.reportedState).toEqual({
                temperature: 22.2,
                temperatureUnit: 'celsius',
            });
            expect(snapshot.recentEvents.map((event) => event.eventId)).toEqual([
                'evt-temperature-2',
                'evt-temperature-1',
            ]);
            expect(timer.intervals).toEqual([1000]);
        } finally {
            runtime.stop();
        }
    });

    it('stops scheduled readings and adapter subscription', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
            ]),
            timer,
        });

        runtime.start();
        runtime.stop();

        timer.runLatest();

        const snapshotAfterStop = runtime.getRoomSnapshot();

        expect(snapshotAfterStop.updatedAt).toBe('2026-06-08T09:30:00Z');
        expect(snapshotAfterStop.recentEvents.map((event) => event.eventId)).toEqual([
            'evt-temperature-1',
        ]);
        expect(timer.clearedHandles).toEqual([1]);
    });

    it('can restart without creating duplicate adapter subscriptions', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
            ]),
            timer,
        });

        try {
            runtime.start();
            runtime.stop();
            runtime.start();

            const snapshot = runtime.getRoomSnapshot();

            expect(snapshot.updatedAt).toBe('2026-06-08T09:30:01Z');
            expect(snapshot.recentEvents.map((event) => event.eventId)).toEqual([
                'evt-temperature-2',
                'evt-temperature-1',
            ]);
        } finally {
            runtime.stop();
        }
    });
});

function createSequenceClock(timestamps: string[]): Clock {
    const pendingTimestamps = [...timestamps];

    return {
        now() {
            const timestamp = pendingTimestamps.shift();

            if (!timestamp) {
                throw new Error('No deterministic timestamp configured.');
            }

            return timestamp;
        },
    };
}

function createManualTimer(): TimerScheduler<number> & {
    intervals: number[];
    clearedHandles: number[];
    runLatest(): void;
} {
    const callbacks = new Map<number, () => void>();
    const intervals: number[] = [];
    const clearedHandles: number[] = [];
    let nextHandle = 1;

    return {
        intervals,
        clearedHandles,
        setInterval(callback, intervalMs) {
            const handle = nextHandle;
            nextHandle += 1;
            callbacks.set(handle, callback);
            intervals.push(intervalMs);
            return handle;
        },
        clearInterval(timerHandle) {
            callbacks.delete(timerHandle);
            clearedHandles.push(timerHandle);
        },
        runLatest() {
            const latestHandle = nextHandle - 1;
            callbacks.get(latestHandle)?.();
        },
    };
}
