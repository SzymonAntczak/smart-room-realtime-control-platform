import type { Clock, TimerScheduler } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

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
            expect(timer.intervals).toEqual([1000, 1000]);
        } finally {
            runtime.stop();
        }
    });

    it('accepts a repeated event id after the injected deduplication retention expires', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock,
            timer,
            deduplicationRetentionMs: 1000,
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-1',
                'evt-temperature-1',
            ]),
        });

        try {
            runtime.start();

            clock.advanceBy(999);
            timer.runLatest();

            expect(runtime.getRoomSnapshot().recentEvents).toHaveLength(1);
            expect(runtime.getDiagnosticsSnapshot().ignoredEvents).toEqual([
                expect.objectContaining({
                    reason: 'duplicate_event',
                    eventId: 'evt-temperature-1',
                }),
            ]);

            clock.advanceBy(2);
            timer.runLatest();

            const snapshot = runtime.getRoomSnapshot();

            expect(snapshot.devices[0]?.reportedState).toEqual({
                temperature: 22.4,
                temperatureUnit: 'celsius',
            });
            expect(snapshot.recentEvents.map((event) => event.eventId)).toEqual([
                'evt-temperature-1',
                'evt-temperature-1',
            ]);
            expect(snapshot.recentEvents).toHaveLength(2);
        } finally {
            runtime.stop();
        }
    });

    it('notifies snapshot subscribers after accepted temperature readings only', () => {
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
                'evt-temperature-1',
            ]),
            timer,
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        const unsubscribe = runtime.subscribeRoomSnapshot((snapshot) => {
            snapshots.push(snapshot);
        });

        try {
            runtime.start();
            timer.runLatest();

            expect(snapshots.map((snapshot) => snapshot.updatedAt)).toEqual([
                '2026-06-08T09:30:00Z',
            ]);
            expect(snapshots[0]?.devices[0]?.reportedState).toEqual({
                temperature: 22,
                temperatureUnit: 'celsius',
            });
        } finally {
            unsubscribe();
            runtime.stop();
        }
    });

    it('broadcasts stale and offline snapshots when temperature telemetry stops', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 10_000,
            snapshotBroadcastIntervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:02.501Z',
                '2026-06-08T09:30:10.001Z',
            ]),
            generateEventId: createSequenceEventIdGenerator(['evt-temperature-1']),
            timer,
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];

        runtime.subscribeRoomSnapshot((snapshot) => {
            snapshots.push(snapshot);
        });

        try {
            runtime.start();

            timer.run(1);
            timer.run(1);

            expect(snapshots.map((snapshot) => snapshot.devices[0]?.health)).toEqual([
                'online',
                'stale',
                'offline',
            ]);
            expect(snapshots.map((snapshot) => snapshot.updatedAt)).toEqual([
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
            ]);
            expect(snapshots.at(-1)?.devices[0]?.lastSeenAt).toBe('2026-06-08T09:30:00Z');
            expect(snapshots.at(-1)?.recentEvents).toEqual([
                expect.objectContaining({
                    eventId: 'evt-temperature-1',
                    eventType: 'telemetry.reading.recorded',
                    occurredAt: '2026-06-08T09:30:00Z',
                }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('keeps notifying subscribers when another snapshot subscriber throws', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock: createSequenceClock(['2026-06-08T09:29:59Z', '2026-06-08T09:30:00Z']),
            generateEventId: createSequenceEventIdGenerator(['evt-temperature-1']),
            timer,
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];

        runtime.subscribeRoomSnapshot(() => {
            throw new Error('Subscriber failed.');
        });
        runtime.subscribeRoomSnapshot((snapshot) => {
            snapshots.push(snapshot);
        });

        try {
            expect(() => runtime.start()).not.toThrow();
            expect(snapshots).toHaveLength(1);
            expect(snapshots[0]?.updatedAt).toBe('2026-06-08T09:30:00Z');
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
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:02.501Z',
                '2026-06-08T09:30:10.001Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:05Z',
                '2026-06-08T09:30:21.001Z',
                '2026-06-08T09:30:21.001Z',
                '2026-06-08T09:30:12Z',
            ]),
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-2',
                'evt-temperature-late',
            ]),
            timer,
        });
        const publishedSnapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];

        runtime.subscribeRoomSnapshot((snapshot) => {
            publishedSnapshots.push(snapshot);
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

            expect(publishedSnapshots.at(-1)?.devices[0]?.health).toBe('offline');

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
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:01Z',
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
        expect(timer.clearedHandles).toEqual([2, 1]);
    });

    it('can restart without creating duplicate adapter subscriptions', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:01Z',
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
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:03Z',
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
                        commandId: undefined,
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

    it('runs invalid and replay scenarios through diagnostics without changing confirmed state', () => {
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 10_000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:03Z',
                '2026-06-08T09:30:04Z',
                '2026-06-08T09:30:05Z',
            ]),
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-invalid',
                'evt-temperature-reset',
            ]),
        });

        try {
            runtime.start();
            runtime.runScenario('emit_invalid_reading');
            runtime.runScenario('replay_last_reading');
            runtime.runScenario('reset');

            expect(runtime.getRoomSnapshot().devices[0]?.reportedState).toEqual({
                temperature: 22,
                temperatureUnit: 'celsius',
            });
            expect(
                runtime.getDiagnosticsSnapshot().ignoredEvents.map((event) => event.reason),
            ).toEqual(['duplicate_event', 'invalid_payload']);
            expect(runtime.getRoomSnapshot().recentEvents.map((event) => event.eventId)).toEqual([
                'evt-temperature-reset',
                'evt-temperature-1',
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('pauses telemetry through stale and offline health, then recovers with one resumed timer', () => {
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            snapshotBroadcastIntervalMs: 1000,
            clock: createSequenceClock([
                '2026-06-08T09:29:59Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:02.501Z',
                '2026-06-08T09:30:10.001Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
                '2026-06-08T09:30:11Z',
            ]),
            generateEventId: createSequenceEventIdGenerator([
                'evt-temperature-1',
                'evt-temperature-2',
            ]),
            timer,
        });
        const healthSnapshots: string[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => {
            const health = snapshot.devices[0]?.health;

            if (health) {
                healthSnapshots.push(health);
            }
        });

        try {
            runtime.start();
            runtime.runScenario('pause_telemetry');
            timer.run(1);
            timer.run(1);
            runtime.runScenario('resume_telemetry');
            timer.run(3);

            expect(healthSnapshots).toEqual(['online', 'stale', 'offline', 'online']);
            expect(runtime.getRoomSnapshot().devices[0]?.lastSeenAt).toBe('2026-06-08T09:30:11Z');
            expect(timer.intervals).toEqual([1000, 1000, 1000]);
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
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:00Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:01Z',
                '2026-06-08T09:30:02Z',
                '2026-06-08T09:30:03Z',
                '2026-06-08T09:30:03Z',
                '2026-06-08T09:30:04Z',
                '2026-06-08T09:30:05Z',
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
    const finalTimestamp = pendingTimestamps.at(-1);

    return {
        now() {
            const timestamp = pendingTimestamps.shift();

            if (timestamp) {
                return timestamp;
            }

            if (!finalTimestamp) {
                throw new Error('No deterministic timestamp configured.');
            }

            return finalTimestamp;
        },
    };
}

function createMutableClock(
    initialTimestamp: string,
): Clock & { advanceBy(milliseconds: number): void } {
    let currentTimeMs = Date.parse(initialTimestamp);

    return {
        now() {
            return new Date(currentTimeMs).toISOString();
        },
        advanceBy(milliseconds) {
            currentTimeMs += milliseconds;
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
    run(handle: number): void;
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
        run(handle) {
            callbacks.get(handle)?.();
        },
        runLatest() {
            const latestHandle = nextHandle - 1;
            callbacks.get(latestHandle)?.();
        },
    };
}
