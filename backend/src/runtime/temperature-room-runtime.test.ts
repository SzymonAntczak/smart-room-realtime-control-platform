import type { Clock, TimerScheduler } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { createTemperatureRoomRuntime } from './temperature-room-runtime';

describe('createTemperatureRoomRuntime', () => {
    it('starts with two independently configured temperature projections', () => {
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-06-08T09:30:00Z'),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();

            expect(runtime.getRoomSnapshot().devices).toEqual(
                expect.arrayContaining([
                expect.objectContaining({
                    deviceId: 'temp-desk',
                    reportedState: { temperature: 22, temperatureUnit: 'celsius' },
                }),
                expect.objectContaining({
                    deviceId: 'temp-window',
                    reportedState: { temperature: 20, temperatureUnit: 'celsius' },
                }),
                expect.objectContaining({
                    deviceId: 'led-main',
                    reportedState: { power: 'off' },
                }),
            ]),
            );
            expect(runtime.getDeviceScenarios('temp-desk')?.deviceId).toBe('temp-desk');
            expect(runtime.getDeviceScenarios('temp-window')?.deviceId).toBe('temp-window');
        } finally {
            runtime.stop();
        }
    });

    it('uses separate cadence timers and updates only the sensor whose timer runs', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const initialWindow = device(runtime, 'temp-window')?.reportedState;

            clock.advanceBy(1000);
            timer.run(2);

            expect(timer.intervals).toEqual([1000, 1000, 2000]);
            expect(device(runtime, 'temp-desk')?.reportedState).toEqual({
                temperature: 22.2,
                temperatureUnit: 'celsius',
            });
            expect(device(runtime, 'temp-window')?.reportedState).toEqual(initialWindow);
        } finally {
            runtime.stop();
        }
    });

    it('scopes pause and resume scenarios to their selected device', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            runtime.runDeviceScenario('temp-window', 'pause_telemetry');
            clock.advanceBy(1000);
            timer.run(2);
            timer.run(3);

            expect(device(runtime, 'temp-desk')?.reportedState).toEqual({
                temperature: 22.2,
                temperatureUnit: 'celsius',
            });
            expect(device(runtime, 'temp-window')?.reportedState).toEqual({
                temperature: 20,
                temperatureUnit: 'celsius',
            });

            runtime.runDeviceScenario('temp-window', 'resume_telemetry');
            timer.runLatest();

            expect(device(runtime, 'temp-window')?.reportedState).toEqual({
                temperature: 20.2,
                temperatureUnit: 'celsius',
            });
        } finally {
            runtime.stop();
        }
    });

    it('publishes health changes for the affected device without changing the other projection', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            snapshotBroadcastIntervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            runtime.runDeviceScenario('temp-window', 'pause_telemetry');
            clock.advanceBy(1000);
            timer.run(2);
            clock.advanceBy(1501);
            timer.run(1);

            expect(snapshots.at(-1)?.devices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ deviceId: 'temp-desk', health: 'online' }),
                    expect.objectContaining({ deviceId: 'temp-window', health: 'stale' }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('takes one paused sensor offline and restores only that sensor on fresh telemetry', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            snapshotBroadcastIntervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            runtime.runDeviceScenario('temp-window', 'pause_telemetry');
            clock.advanceBy(10_001);
            timer.run(1);

            expect(device(runtime, 'temp-window')?.health).toBe('offline');

            runtime.runDeviceScenario('temp-window', 'resume_telemetry');
            clock.advanceBy(1);
            timer.runLatest();

            expect(device(runtime, 'temp-window')).toEqual(
                expect.objectContaining({
                    health: 'online',
                    reportedState: { temperature: 20.2, temperatureUnit: 'celsius' },
                }),
            );
        } finally {
            runtime.stop();
        }
    });

    it('records invalid and duplicate scenarios without changing the other sensor projection', () => {
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-06-08T09:30:00Z'),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const deskBefore = device(runtime, 'temp-desk')?.reportedState;
            runtime.runDeviceScenario('temp-window', 'emit_invalid_reading');
            runtime.runDeviceScenario('temp-window', 'replay_last_reading');

            expect(device(runtime, 'temp-desk')?.reportedState).toEqual(deskBefore);
            expect(
                runtime.getDiagnosticsSnapshot().ignoredEvents.map((event) => event.reason),
            ).toEqual(['duplicate_event', 'invalid_payload']);
        } finally {
            runtime.stop();
        }
    });

    it('dispatches an LED command through the composed runtime and publishes its reported state', () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            clock.advanceBy(1);

            runtime.dispatchLedCommand({
                commandId: 'cmd-led-1',
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });

            expect(device(runtime, 'led-main')).toEqual(
                expect.objectContaining({
                    reportedState: { power: 'on' },
                    commandAvailability: { policy: 'allow' },
                }),
            );
            expect(snapshots).toHaveLength(1);
            expect(snapshots[0]?.devices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        deviceId: 'led-main',
                        reportedState: { power: 'on' },
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('accepts an LED command through the platform boundary and projects its outcome', () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            clock.advanceBy(1);

            const result = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });

            expect(result).toEqual(expect.objectContaining({ status: 'accepted' }));
            expect(device(runtime, 'led-main')).toEqual(
                expect.objectContaining({ reportedState: { power: 'on' } }),
            );
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: result.commandId, status: 'confirmed' }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('cancels the timeout when a delayed matching report confirms the command', () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const ledScheduler = createLedScheduler();
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
            ledScenario: 'confirm_delayed',
            ledScenarioScheduler: ledScheduler,
            commandTimer,
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            expect(runtime.getRoomSnapshot().activeCommands).toHaveLength(1);

            clock.advanceBy(2_000);
            ledScheduler.runAll();

            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ status: 'confirmed' }),
            ]);
            expect(commandTimer.size()).toBe(0);
        } finally {
            runtime.stop();
        }
    });

    it('projects simulator rejection, timeout and late report as distinct terminal outcomes', () => {
        const scenarios = [
            ['reject_command', 'failed'],
            ['omit_confirmation', 'timed_out'],
            ['report_after_timeout', 'timed_out'],
        ] as const;

        for (const [scenario, expectedStatus] of scenarios) {
            const clock = createMutableClock('2026-08-05T10:00:00Z');
            const ledScheduler = createLedScheduler();
            const commandTimer = createCommandTimer();
            const runtime = createTemperatureRoomRuntime({
                clock,
                generateEventId: createEventIdGenerator(),
                ledScenario: scenario,
                ledScenarioScheduler: ledScheduler,
                commandTimer,
            });

            try {
                runtime.start();
                clock.advanceBy(1);
                runtime.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                });
                if (scenario !== 'reject_command') {
                    clock.advanceBy(5_000);
                    commandTimer.runAll();
                }
                if (scenario === 'report_after_timeout') {
                    clock.advanceBy(1_000);
                    ledScheduler.runAll();
                    expect(device(runtime, 'led-main')?.reportedState).toEqual({ power: 'on' });
                }

                expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
                expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                    expect.objectContaining({ status: expectedStatus }),
                ]);
            } finally {
                runtime.stop();
            }
        }
    });

    it('returns the documented read-only rejection reason for a temperature sensor', () => {
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-08-05T10:00:00Z'),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();

            expect(
                runtime.requestCommand({
                    deviceId: 'temp-desk',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            ).toEqual(expect.objectContaining({ status: 'rejected', reason: 'read_only_device' }));
        } finally {
            runtime.stop();
        }
    });

    it('reschedules a pending command timeout after a runtime restart', () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
            ledScenario: 'omit_confirmation',
            commandTimer,
        });

        runtime.start();
        clock.advanceBy(1);
        runtime.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        runtime.stop();
        clock.advanceBy(5_000);
        runtime.start();

        try {
            commandTimer.runAll();
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ status: 'timed_out' }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('cancels a delayed LED report when the runtime stops before restarting', () => {
        const scheduler = createLedScheduler();
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-08-05T10:00:00Z'),
            generateEventId: createEventIdGenerator(),
            ledScenario: 'confirm_delayed',
            ledScenarioScheduler: scheduler,
        });

        runtime.start();
        runtime.dispatchLedCommand({
            commandId: 'cmd-led-1',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        runtime.stop();
        scheduler.runAll();
        runtime.start();

        try {
            expect(device(runtime, 'led-main')).toEqual(
                expect.objectContaining({ reportedState: { power: 'off' } }),
            );
        } finally {
            runtime.stop();
        }
    });
});

function device(runtime: ReturnType<typeof createTemperatureRoomRuntime>, deviceId: string) {
    return runtime.getRoomSnapshot().devices.find((candidate) => candidate.deviceId === deviceId);
}

function createEventIdGenerator(): () => string {
    let index = 0;
    return () => `evt-temperature-${++index}`;
}

function createMutableClock(
    initialTimestamp: string,
): Clock & { advanceBy(milliseconds: number): void } {
    let currentTimeMs = Date.parse(initialTimestamp);
    return {
        now: () => new Date(currentTimeMs).toISOString(),
        advanceBy(milliseconds) {
            currentTimeMs += milliseconds;
        },
    };
}

function createManualTimer(): TimerScheduler<number> & {
    intervals: number[];
    run(handle: number): void;
    runLatest(): void;
} {
    const callbacks = new Map<number, () => void>();
    const intervals: number[] = [];
    let nextHandle = 1;
    return {
        intervals,
        setInterval(callback, intervalMs) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);
            intervals.push(intervalMs);
            return handle;
        },
        clearInterval(handle) {
            callbacks.delete(handle);
        },
        run(handle) {
            callbacks.get(handle)?.();
        },
        runLatest() {
            callbacks.get(nextHandle - 1)?.();
        },
    };
}

function createLedScheduler() {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;

    return {
        setTimeout(callback: () => void) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);
            return handle;
        },
        clearTimeout(timerHandle: unknown) {
            if (typeof timerHandle === 'number') callbacks.delete(timerHandle);
        },
        runAll() {
            for (const callback of callbacks.values()) callback();
            callbacks.clear();
        },
    };
}

function createCommandTimer() {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;

    return {
        setTimeout(callback: () => void) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);
            return handle;
        },
        clearTimeout(timerHandle: unknown) {
            if (typeof timerHandle === 'number') callbacks.delete(timerHandle);
        },
        runAll() {
            for (const callback of callbacks.values()) callback();
            callbacks.clear();
        },
        size() {
            return callbacks.size;
        },
    };
}
