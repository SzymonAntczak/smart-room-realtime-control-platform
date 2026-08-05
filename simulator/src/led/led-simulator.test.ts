import { describe, expect, it } from 'vitest';

import { createLedSimulator, type LedSetPowerCommand } from './led-simulator';

describe('createLedSimulator', () => {
    it('accepts a native set.power command and exposes it to a native listener', () => {
        const simulator = createSimulator();
        const commands: LedSetPowerCommand[] = [];
        simulator.onCommand((command) => commands.push(command));

        simulator.receive(command('on'));

        expect(commands).toEqual([command('on')]);
    });

    it('rejects a command with an unsupported native message type', () => {
        const simulator = createSimulator();
        const malformedCommand = { ...command('on'), messageType: 'other.command' };

        expect(() => simulator.receive(malformedCommand as LedSetPowerCommand)).toThrow(
            'LED command messageType must be led.command.set_power.',
        );
    });

    it('updates observed state only when it emits a native state report', () => {
        const simulator = createSimulator();
        const reports: unknown[] = [];
        simulator.onStateReport((report) => reports.push(report));

        simulator.receive(command('on'));
        expect(simulator.getObservedPower()).toBe('off');

        simulator.reportState('on', '2026-08-05T10:00:00Z');

        expect(simulator.getObservedPower()).toBe('on');
        expect(reports).toEqual([
            {
                messageType: 'led.state.reported',
                deviceId: 'led-main-native',
                reportedState: { power: 'on' },
                reportedAt: '2026-08-05T10:00:00Z',
            },
        ]);
    });

    it('emits a native rejection without a state report', () => {
        const simulator = createSimulator();
        const rejections: unknown[] = [];
        const reports: unknown[] = [];
        simulator.onCommandRejection((rejection) => rejections.push(rejection));
        simulator.onStateReport((report) => reports.push(report));

        simulator.rejectCommand(command('on'), '2026-08-05T10:00:00Z');

        expect(rejections).toEqual([
            {
                messageType: 'led.command.rejected',
                commandId: 'cmd-1',
                deviceId: 'led-main-native',
                reason: 'command_rejected',
                rejectedAt: '2026-08-05T10:00:00Z',
            },
        ]);
        expect(reports).toEqual([]);
        expect(simulator.getObservedPower()).toBe('off');
    });
});

function createSimulator() {
    return createLedSimulator({ deviceId: 'led-main-native', initialPower: 'off' });
}

function command(power: 'on' | 'off'): LedSetPowerCommand {
    return {
        messageType: 'led.command.set_power',
        commandId: 'cmd-1',
        deviceId: 'led-main-native',
        commandType: 'set.power',
        requestedState: { power },
    };
}
