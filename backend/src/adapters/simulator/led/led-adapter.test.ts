import type { DeviceStateReportedEvent, PlatformEvent } from '@smart-room/contracts/events';
import {
    createLedSimulator,
    type LedCommandRejection,
    type LedCommandRejectionListener,
    type LedSetPowerCommand,
    type LedSimulator,
    type LedStateReport,
    type LedStateReportListener,
} from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { createSimulatorLedAdapter } from './led-adapter';

describe('createSimulatorLedAdapter', () => {
    it('translates a platform set.power command to a native LED command', () => {
        const led = createLedSimulator({ deviceId: 'led-main-native', initialPower: 'off' });
        const receivedCommands: LedSetPowerCommand[] = [];
        led.onCommand((command) => receivedCommands.push(command));
        const adapter = createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            generateEventId: () => 'evt-1',
            emitEvent: () => undefined,
        });

        adapter.dispatch({
            commandId: 'cmd-1',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });

        expect(receivedCommands).toEqual([
            {
                messageType: 'led.command.set_power',
                commandId: 'cmd-1',
                deviceId: 'led-main-native',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            },
        ]);
    });

    it('translates a matching native state report to a platform event', () => {
        const led = createLedSimulator({ deviceId: 'led-main-native', initialPower: 'off' });
        const events: PlatformEvent[] = [];
        createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            generateEventId: () => 'evt-1',
            emitEvent: (event) => events.push(event),
        });

        led.reportState('on', '2026-08-05T10:00:00Z');

        expect(events).toEqual([
            {
                eventId: 'evt-1',
                eventType: 'device.state.reported',
                occurredAt: '2026-08-05T10:00:00Z',
                source: 'simulator-adapter',
                deviceId: 'led-main',
                payload: {
                    reportedState: { power: 'on' },
                    reportedAt: '2026-08-05T10:00:00Z',
                },
            } satisfies DeviceStateReportedEvent,
        ]);
    });

    it('ignores reports and rejections from a different native LED', () => {
        const led = createControllableLed();
        const events: PlatformEvent[] = [];
        createSimulatorLedAdapter({
            led: led.simulator,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            generateEventId: () => 'evt-1',
            emitEvent: (event) => events.push(event),
        });

        led.emitReport({
            messageType: 'led.state.reported',
            deviceId: 'other-led-native',
            sequence: 1,
            reportedState: { power: 'on' },
            reportedAt: '2026-08-05T10:00:00Z',
        });
        led.emitRejection({
            messageType: 'led.command.rejected',
            commandId: 'cmd-1',
            deviceId: 'other-led-native',
            reason: 'command_rejected',
            rejectedAt: '2026-08-05T10:00:00Z',
        });

        expect(events).toEqual([]);
    });

    it('emits a correlated failure event for a matching native rejection', () => {
        const led = createLedSimulator({ deviceId: 'led-main-native', initialPower: 'off' });
        const events: PlatformEvent[] = [];
        const adapter = createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            generateEventId: () => 'evt-rejection',
            emitEvent: (event) => events.push(event),
        });

        const command = {
            commandId: 'cmd-1',
            deviceId: 'led-main',
            commandType: 'set.power' as const,
            requestedState: { power: 'on' as const },
        };
        adapter.dispatch(command);
        led.rejectCommand(
            {
                messageType: 'led.command.set_power',
                ...command,
                deviceId: 'led-main-native',
            },
            '2026-08-05T10:00:00Z',
        );

        expect(events).toEqual([
            expect.objectContaining({
                eventId: 'evt-rejection',
                eventType: 'command.failed',
                deviceId: 'led-main',
                commandId: 'cmd-1',
                payload: {
                    reason: 'command_rejected',
                    message: 'The simulated LED rejected the command.',
                },
            }),
        ]);
    });

    it('stops forwarding native messages after stop', () => {
        const led = createLedSimulator({ deviceId: 'led-main-native', initialPower: 'off' });
        const events: PlatformEvent[] = [];
        const adapter = createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            generateEventId: () => 'evt-1',
            emitEvent: (event) => events.push(event),
        });

        adapter.stop();
        led.reportState('on', '2026-08-05T10:00:00Z');

        expect(events).toEqual([]);
        expect(() =>
            adapter.dispatch({
                commandId: 'cmd-1',
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toThrow('Simulator LED adapter has been stopped.');
    });

    it('reuses the original platform event for a replayed native report', () => {
        const led = createControllableLed();
        const events: PlatformEvent[] = [];
        createSimulatorLedAdapter({
            led: led.simulator,
            nativeLedId: 'led-main-native',
            platformDeviceId: 'led-main',
            generateEventId: () => `evt-${events.length + 1}`,
            emitEvent: (event) => events.push(event),
        });
        const report: LedStateReport = {
            messageType: 'led.state.reported',
            deviceId: 'led-main-native',
            sequence: 3,
            reportedState: { power: 'on' },
            reportedAt: '2026-08-05T10:00:00Z',
        };

        led.emitReport(report);
        led.emitReport(report);

        expect(events).toHaveLength(2);
        expect(events[1]).toBe(events[0]);
    });
});

function createControllableLed(): {
    simulator: LedSimulator;
    emitReport(report: LedStateReport): void;
    emitRejection(rejection: LedCommandRejection): void;
} {
    const reportListeners = new Set<LedStateReportListener>();
    const rejectionListeners = new Set<LedCommandRejectionListener>();

    return {
        simulator: {
            onCommand() {
                return () => undefined;
            },
            onStateReport(listener) {
                reportListeners.add(listener);
                return () => reportListeners.delete(listener);
            },
            onCommandRejection(listener) {
                rejectionListeners.add(listener);
                return () => rejectionListeners.delete(listener);
            },
            onAvailability() {
                return () => undefined;
            },
            onHealth() {
                return () => undefined;
            },
            receive() {},
            reportState() {
                throw new Error('Not used by this test double.');
            },
            rejectCommand() {
                throw new Error('Not used by this test double.');
            },
            reportAvailability() {
                throw new Error('Not used by this test double.');
            },
            reportHealth() {
                throw new Error('Not used by this test double.');
            },
            getObservedPower() {
                return 'off';
            },
        },
        emitReport(report) {
            for (const listener of reportListeners) listener(report);
        },
        emitRejection(rejection) {
            for (const listener of rejectionListeners) listener(rejection);
        },
    };
}
