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
                messageId: expect.any(String),
                messageType: 'led.state.reported',
                deviceId: 'led-main-native',
                sequence: 1,
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
                messageId: expect.any(String),
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

    it('emits explicit availability and health facts with truthful previous values', () => {
        const simulator = createSimulator();
        const availability: unknown[] = [];
        const health: unknown[] = [];
        simulator.onAvailability((report) => availability.push(report));
        simulator.onHealth((report) => health.push(report));

        simulator.reportAvailability('online', '2026-08-05T10:00:00Z');
        simulator.reportAvailability('offline', '2026-08-05T10:00:01Z');
        simulator.reportHealth('degraded', 'partial_data', '2026-08-05T10:00:02Z');
        simulator.reportHealth('healthy', 'recovered', '2026-08-05T10:00:03Z');

        expect(availability).toMatchObject([
            { previousAvailability: 'unknown', availability: 'online' },
            { previousAvailability: 'online', availability: 'offline' },
        ]);
        expect(health).toMatchObject([
            { previousHealth: 'unknown', health: 'degraded' },
            { previousHealth: 'degraded', health: 'healthy' },
        ]);
    });

    it('accepts RFC 3339 timestamps and rejects non-RFC 3339 timestamps', () => {
        const simulator = createSimulator();

        expect(() => simulator.reportState('on', '2026-08-05T12:00:00+02:00')).not.toThrow();
        expect(() => simulator.reportState('on', '2026-08-05 10:00:00Z')).toThrow(
            'LED state report reportedAt must be an RFC 3339 timestamp with a UTC offset.',
        );
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
