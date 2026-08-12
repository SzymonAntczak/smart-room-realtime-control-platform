import { describe, expect, it } from 'vitest';

import { createLedScenario } from './led-scenarios';
import type { LedSetPowerCommand, LedStateReport } from './led-simulator';

describe('createLedScenario', () => {
    it('reports matching state immediately for confirm_immediately', () => {
        const { scenario, reports, timer } = createTestScenario('confirm_immediately');

        scenario.receive(command());

        expect(timer.delays).toEqual([]);
        expect(reports).toHaveLength(1);
        expect(reports).toEqual([
            {
                messageType: 'led.state.reported',
                deviceId: 'led-main-native',
                sequence: 1,
                reportedState: { power: 'on' },
                reportedAt: '2026-08-05T10:00:00.000Z',
            },
        ]);
    });

    it('reports matching state only after 2000 ms for confirm_delayed', () => {
        const { scenario, reports, timer } = createTestScenario('confirm_delayed');

        scenario.receive(command());
        expect(reports).toEqual([]);
        expect(timer.delays).toEqual([2_000]);

        timer.advanceBy(1_999);
        expect(reports).toEqual([]);
        timer.advanceBy(1);
        expect(reports).toEqual([
            {
                messageType: 'led.state.reported',
                deviceId: 'led-main-native',
                sequence: 1,
                reportedState: { power: 'on' },
                reportedAt: '2026-08-05T10:00:02.000Z',
            },
        ]);
    });

    it('rejects natively without a state report for reject_command', () => {
        const { scenario, rejections, reports, timer } = createTestScenario('reject_command');

        scenario.receive(command());

        expect(timer.delays).toEqual([]);
        expect(reports).toEqual([]);
        expect(rejections).toHaveLength(1);
        expect(rejections[0]).toMatchObject({ reason: 'command_rejected', commandId: 'cmd-1' });
    });

    it('does not report or reject for omit_confirmation', () => {
        const { scenario, rejections, reports, timer } = createTestScenario('omit_confirmation');

        scenario.receive(command());
        timer.advanceBy(10_000);

        expect(timer.delays).toEqual([]);
        expect(reports).toEqual([]);
        expect(rejections).toEqual([]);
    });

    it('reports matching state only after 6000 ms for report_after_timeout', () => {
        const { scenario, reports, timer } = createTestScenario('report_after_timeout', 'on');

        scenario.receive(command('off'));
        expect(timer.delays).toEqual([6_000]);

        timer.advanceBy(5_999);
        expect(reports).toEqual([]);
        timer.advanceBy(1);
        expect(reports).toEqual([
            {
                messageType: 'led.state.reported',
                deviceId: 'led-main-native',
                sequence: 1,
                reportedState: { power: 'off' },
                reportedAt: '2026-08-05T10:00:06.000Z',
            },
        ]);
    });
    it('cancels every delayed report and removes the command handler when stopped', () => {
        const { scenario, reports, timer } = createTestScenario('confirm_delayed');

        scenario.receive(command());
        scenario.receive(command('off'));
        scenario.stop();
        timer.advanceBy(2_000);
        scenario.receive(command('off'));

        expect(reports).toEqual([]);
    });
});

function createTestScenario(
    scenarioName: Parameters<typeof createLedScenario>[0]['scenario'],
    initialPower: 'on' | 'off' = 'off',
) {
    const timer = createFakeScheduler();
    const reports: LedStateReport[] = [];
    const rejections: unknown[] = [];
    const scenario = createLedScenario({
        deviceId: 'led-main-native',
        initialPower,
        scenario: scenarioName,
        clock: { now: () => timer.isoNow() },
        scheduler: timer,
    });
    scenario.onStateReport((report) => reports.push(report));
    scenario.onCommandRejection((rejection) => rejections.push(rejection));

    return { scenario, reports, rejections, timer };
}

function command(power: 'on' | 'off' = 'on'): LedSetPowerCommand {
    return {
        messageType: 'led.command.set_power',
        commandId: 'cmd-1',
        deviceId: 'led-main-native',
        commandType: 'set.power',
        requestedState: { power },
    };
}

function createFakeScheduler() {
    let now = 0;
    let nextHandle = 1;
    const scheduled = new Map<number, { dueAt: number; callback: () => void }>();

    return {
        get delays() {
            return [...scheduled.values()].map(({ dueAt }) => dueAt - now);
        },
        setTimeout(callback: () => void, delayMs: number) {
            const handle = nextHandle;
            nextHandle += 1;
            scheduled.set(handle, { dueAt: now + delayMs, callback });

            return handle;
        },
        clearTimeout(handle: number) {
            scheduled.delete(handle);
        },
        isoNow() {
            return new Date(Date.parse('2026-08-05T10:00:00Z') + now).toISOString();
        },
        advanceBy(durationMs: number) {
            const target = now + durationMs;

            while (true) {
                const next = [...scheduled.entries()]
                    .filter(([, { dueAt }]) => dueAt <= target)
                    .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];

                if (!next) {
                    now = target;

                    return;
                }

                const [handle, scheduledTimer] = next;
                scheduled.delete(handle);
                now = scheduledTimer.dueAt;
                scheduledTimer.callback();
            }
        },
    };
}
