import type { Clock, LedScenarioScheduler } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import type { CommandTimer } from '../../platform/command-processing/set-power-command-controller';
import { createTemperatureRoomRuntime } from '../../runtime/temperature-room-runtime';

describe('LED command reference loop', () => {
    it('keeps normal, delayed, rejected, timed-out and late-report outcomes explainable', async () => {
        await verifyScenario('confirm_immediately', 'confirmed');
        await verifyScenario('confirm_delayed', 'confirmed');
        await verifyScenario('reject_command', 'failed');
        await verifyScenario('omit_confirmation', 'timed_out');
        await verifyScenario('report_after_timeout', 'timed_out');
    });
});

async function verifyScenario(
    scenario:
        | 'confirm_immediately'
        | 'confirm_delayed'
        | 'reject_command'
        | 'omit_confirmation'
        | 'report_after_timeout',
    expectedStatus: 'confirmed' | 'failed' | 'timed_out',
): Promise<void> {
    const clock = createMutableClock('2026-08-05T10:00:00Z');
    const ledScheduler = createManualTimeoutScheduler();
    const commandTimer = createManualTimeoutScheduler();
    const runtime = createTemperatureRoomRuntime({
        clock,
        commandTimer,
        generateEventId: createEventIdGenerator(),
        ledScenario: scenario,
        ledScenarioScheduler: ledScheduler,
    });

    try {
        runtime.start();
        clock.advanceBy(1);
        const result = runtime.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        await flushCommandDispatch();

        expect(result.status).toBe('accepted');

        if (scenario === 'confirm_delayed') {
            expect(runtime.getRoomSnapshot().activeCommands).toHaveLength(1);
            clock.advanceBy(2_000);
            ledScheduler.runAll();
        }

        if (scenario === 'omit_confirmation' || scenario === 'report_after_timeout') {
            expect(runtime.getRoomSnapshot().activeCommands).toHaveLength(1);
            clock.advanceBy(5_000);
            commandTimer.runAll();
        }

        if (scenario === 'report_after_timeout') {
            clock.advanceBy(1_000);
            ledScheduler.runAll();
            expect(ledPower(runtime)).toBe('on');
        }

        expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
        expect(runtime.getRoomSnapshot().recentCommands).toEqual([
            expect.objectContaining({ commandId: result.commandId, status: expectedStatus }),
        ]);
    } finally {
        runtime.stop();
    }
}

async function flushCommandDispatch(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function ledPower(runtime: ReturnType<typeof createTemperatureRoomRuntime>) {
    return runtime.getRoomSnapshot().devices.find((device) => device.deviceId === 'led-main')
        ?.reportedState.power;
}

function createEventIdGenerator(): () => string {
    let index = 0;

    return () => `evt-led-reference-${++index}`;
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

function createManualTimeoutScheduler(): LedScenarioScheduler<number> &
    CommandTimer & { runAll(): void } {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;

    return {
        setTimeout(callback) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);

            return handle;
        },
        clearTimeout(handle) {
            if (typeof handle === 'number') {
                callbacks.delete(handle);
            }
        },
        runAll() {
            for (const callback of callbacks.values()) {
                callback();
            }

            callbacks.clear();
        },
    };
}
