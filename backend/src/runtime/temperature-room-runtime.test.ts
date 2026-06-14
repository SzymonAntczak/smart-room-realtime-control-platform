import { describe, expect, it } from 'vitest';
import type { Clock, TimerScheduler } from '../../../simulator/src';
import { createTemperatureRoomRuntime } from './temperature-room-runtime';

describe('createTemperatureRoomRuntime', () => {
    it('starts with an immediate temperature reading from the injected clock', () => {
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 10_000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
            ]),
            generateEventId: createSequenceEventIdGenerator(['evt-temperature-1']),
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
            expect(runtime.getDiagnosticsSnapshot()).toEqual({
                ignoredEvents: [],
            });
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
                '2026-06-08T09:30:01Z',
            ]),
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-2',
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

    it('derives stale and offline health when temperature telemetry stops, then recovers on a fresh reading', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:02.501Z',
                '2026-06-08T09:30:10.001Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:05Z',
                '2026-06-08T09:30:12Z',
            ]),
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-2',
                'evt-temperature-late',
            ]),
            timer,
        });

        try {
            runtime.start();

            expect(runtime.getRoomSnapshot().devices[0]?.health).toBe('online');
            expect(runtime.getRoomSnapshot().devices[0]?.health).toBe('stale');
            expect(runtime.getRoomSnapshot().devices[0]?.health).toBe('offline');

            timer.runLatest();

            const recoveredSnapshot = runtime.getRoomSnapshot();

            expect(recoveredSnapshot.devices[0]).toEqual(
                expect.objectContaining({
                    health: 'online',
                    lastSeenAt: '2026-06-08T09:30:11Z',
                }),
            );
            expect(recoveredSnapshot.updatedAt).toBe('2026-06-08T09:30:11Z');
            expect(recoveredSnapshot.recentEvents.map((event) => event.eventId)).toEqual([
                'evt-temperature-2',
                'evt-temperature-1',
            ]);

            timer.runLatest();

            const snapshotAfterLateTelemetry = runtime.getRoomSnapshot();

            expect(snapshotAfterLateTelemetry.devices[0]).toEqual(
                expect.objectContaining({
                    health: 'online',
                    lastSeenAt: '2026-06-08T09:30:11Z',
                    reportedState: {
                        temperature: 22.2,
                        temperatureUnit: 'celsius',
                    },
                }),
            );
            expect(snapshotAfterLateTelemetry.updatedAt).toBe('2026-06-08T09:30:11Z');
            expect(snapshotAfterLateTelemetry.recentEvents.map((event) => event.eventId)).toEqual([
                'evt-temperature-late',
                'evt-temperature-2',
                'evt-temperature-1',
            ]);
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
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-2',
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
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-2',
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

    it('uses crypto UUID event ids by default', () => {
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 10_000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
            ]),
        });

        try {
            runtime.start();

            const eventId = runtime.getRoomSnapshot().recentEvents[0]?.eventId;

            expect(eventId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
        } finally {
            runtime.stop();
        }
    });

    it('records ignored duplicate events in diagnostics without updating recent events', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:02Z',
            ]),
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-1',
            ]),
            timer,
        });

        try {
            runtime.start();
            timer.runLatest();

            expect(runtime.getRoomSnapshot().recentEvents.map((event) => event.eventId)).toEqual([
                'evt-temperature-1',
            ]);
            expect(runtime.getDiagnosticsSnapshot()).toEqual({
                ignoredEvents: [
                    {
                        diagnosticId: 'diag-1',
                        reason: 'duplicate_event',
                        observedAt: '2026-06-08T09:30:02Z',
                        eventId: 'evt-temperature-1',
                        eventType: 'telemetry.reading.recorded',
                        source: 'simulator-adapter',
                        deviceId: 'temp-desk',
                        occurredAt: '2026-06-08T09:30:01Z',
                    },
                ],
            });
        } finally {
            runtime.stop();
        }
    });

    it('keeps ignored diagnostics newest-first and applies the diagnostics limit', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            diagnosticEventLimit: 2,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:03Z',
                '2026-06-08T09:30:04Z',
                '2026-06-08T09:30:05Z',
                '2026-06-08T09:30:06Z',
            ]),
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-1',
                'evt-temperature-1',
                'evt-temperature-1',
            ]),
            timer,
        });

        try {
            runtime.start();
            timer.runLatest();
            timer.runLatest();
            timer.runLatest();

            expect(
                runtime
                    .getDiagnosticsSnapshot()
                    .ignoredEvents.map((diagnostic) => diagnostic.diagnosticId),
            ).toEqual(['diag-3', 'diag-2']);
            expect(
                runtime.getDiagnosticsSnapshot().ignoredEvents.map((diagnostic) => ({
                    observedAt: diagnostic.observedAt,
                    occurredAt: diagnostic.occurredAt,
                })),
            ).toEqual([
                {
                    observedAt: '2026-06-08T09:30:06Z',
                    occurredAt: '2026-06-08T09:30:05Z',
                },
                {
                    observedAt: '2026-06-08T09:30:04Z',
                    occurredAt: '2026-06-08T09:30:03Z',
                },
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

function createSequenceEventIdGenerator(eventIds: string[]): () => string {
    const pendingEventIds = [...eventIds];

    return () => {
        const eventId = pendingEventIds.shift();

        if (!eventId) {
            throw new Error('No deterministic event id configured.');
        }

        return eventId;
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
