import type { PlatformEvent } from '@smart-room/contracts/events';
import type {
    LedAvailabilityListener,
    LedAvailabilityReport,
    LedCommandRejection,
    LedCommandRejectionListener,
    LedHealthListener,
    LedHealthReport,
    LedSetPowerCommand,
    LedStateReport,
    LedStateReportListener,
} from '@smart-room/simulator';
import { createLedScenario } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { createEventProcessor } from '../../../platform/event-processing/event-processor';
import { createRoomProjector } from '../../../platform/read-model/room-projection';

import { createSimulatorLedAdapter, type LedCommandTransport } from './led-adapter';

describe('createSimulatorLedAdapter', () => {
    it('translates a simulator bootstrap state report into an adapter-identified platform event', () => {
        const led = createLedScenario({
            deviceId: 'led-native',
            initialPower: 'off',
            scenario: 'omit_confirmation',
            clock: { now: () => at },
            scheduler: { setTimeout: () => 1, clearTimeout: () => undefined },
            generateMessageId: () => 'bootstrap-1',
        });
        const events: PlatformEvent[] = [];
        createSimulatorLedAdapter({
            led,
            nativeLedId: 'led-native',
            platformDeviceId: 'led-platform',
            emitEvent: (event) => events.push(event),
        });

        led.reportCurrentState(at);

        expect(events).toEqual([
            {
                eventId: 'simulator-adapter:led-native:bootstrap-1',
                eventType: 'device.state.reported',
                occurredAt: at,
                source: 'simulator-adapter',
                deviceId: 'led-platform',
                payload: { reportedState: { power: 'off' } },
            },
        ]);
    });

    it('lets the processor deduplicate replayed LED facts', () => {
        const led = controllableLed();
        const devices = [{ deviceId: 'led-platform', name: 'LED', role: 'led-output' }] as const;
        const processor = createEventProcessor({
            devices: [...devices],
            roomProjector: createRoomProjector({
                devices: [...devices],
                initialUpdatedAt: '2026-08-05T09:59:57Z',
            }),
            clock: { now: () => at },
        });
        const results: ReturnType<typeof processor.processEvent>[] = [];
        createSimulatorLedAdapter({
            led: led.transport,
            nativeLedId: 'led-native',
            platformDeviceId: 'led-platform',
            emitEvent: (event) => results.push(processor.processEvent(event)),
        });
        const state = report('report-1');
        const availabilityFact = availability('availability-1');
        const healthFact = health('health-1');
        led.emitReport(state);
        led.emitReport(state);
        led.emitAvailability(availabilityFact);
        led.emitAvailability(availabilityFact);
        led.emitHealth(healthFact);
        led.emitHealth(healthFact);

        expect(results.map((result) => result.status)).toEqual([
            'accepted',
            'ignored',
            'accepted',
            'ignored',
            'accepted',
            'ignored',
        ]);
        expect(
            results
                .filter((result) => result.status === 'ignored')
                .every((result) => result.reason === 'duplicate_event'),
        ).toBe(true);
    });

    it('maps a platform command to a native command', () => {
        const led = controllableLed();
        let currentTime = '2026-08-05T10:00:00.000Z';
        const adapter = createSimulatorLedAdapter({
            led: {
                ...led.transport,
                receive(command) {
                    led.transport.receive(command);
                    currentTime = '2026-08-05T10:00:00.123Z';
                },
            },
            nativeLedId: 'led-native',
            platformDeviceId: 'led-platform',
            clock: { now: () => currentTime },
            emitEvent: () => undefined,
        });
        const result = adapter.dispatch(
            {
                commandId: 'cmd-1',
                deviceId: 'led-platform',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            },
            '2026-08-05T10:00:00.000Z',
        );
        expect(led.commands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', deviceId: 'led-native' }),
        ]);
        expect(result).toEqual({
            status: 'handed_off',
            handedOffAt: '2026-08-05T10:00:00.000Z',
        });
    });

    it('translates all native facts through the required sink', () => {
        const led = controllableLed();
        const events: PlatformEvent[] = [];
        createSimulatorLedAdapter({
            led: led.transport,
            nativeLedId: 'led-native',
            platformDeviceId: 'led-platform',
            emitEvent: (event) => events.push(event),
        });
        led.emitReport(report('report-1'));
        led.emitRejection(rejection('rejection-1'));
        led.emitAvailability(availability('availability-1'));
        led.emitHealth(health('health-1'));
        expect(events).toEqual([
            {
                eventId: 'simulator-adapter:led-native:report-1',
                eventType: 'device.state.reported',
                occurredAt: at,
                source: 'simulator-adapter',
                deviceId: 'led-platform',
                payload: { reportedState: { power: 'on' } },
            },
            {
                eventId: 'simulator-adapter:led-native:rejection-1',
                eventType: 'command.failed',
                occurredAt: at,
                source: 'simulator-adapter',
                deviceId: 'led-platform',
                commandId: 'cmd-1',
                payload: {
                    reason: 'command_rejected',
                    message: 'The simulated LED rejected the command.',
                },
            },
            {
                eventId: 'simulator-adapter:led-native:availability-1',
                eventType: 'device.availability.changed',
                occurredAt: at,
                source: 'simulator-adapter',
                deviceId: 'led-platform',
                payload: {
                    previousAvailability: 'unknown',
                    availability: 'online',
                    reason: 'simulator_reported',
                },
            },
            {
                eventId: 'simulator-adapter:led-native:health-1',
                eventType: 'device.health.changed',
                occurredAt: at,
                source: 'simulator-adapter',
                deviceId: 'led-platform',
                payload: { previousHealth: 'unknown', health: 'healthy', reason: 'recovered' },
            },
        ]);
    });

    it('preserves an earlier native report identity after later reports', () => {
        const led = controllableLed();
        const events: PlatformEvent[] = [];
        createSimulatorLedAdapter({
            led: led.transport,
            nativeLedId: 'led-native',
            platformDeviceId: 'led-platform',
            emitEvent: (event) => events.push(event),
        });
        const first = report('report-1', 1);
        led.emitReport(first);
        led.emitReport(report('report-2', 2));
        led.emitReport(report('report-3', 3));
        led.emitReport(report('report-4', 4));
        led.emitReport(first);
        expect(events.map((event) => event.eventId)).toEqual([
            'simulator-adapter:led-native:report-1',
            'simulator-adapter:led-native:report-2',
            'simulator-adapter:led-native:report-3',
            'simulator-adapter:led-native:report-4',
            'simulator-adapter:led-native:report-1',
        ]);
    });

    it('rejects foreign native facts', () => {
        const led = controllableLed();
        const events: PlatformEvent[] = [];
        createSimulatorLedAdapter({
            led: led.transport,
            nativeLedId: 'led-native',
            platformDeviceId: 'led-platform',
            emitEvent: (event) => events.push(event),
        });
        led.emitReport({ ...report('report-1'), deviceId: 'foreign' });
        led.emitRejection({ ...rejection('rejection-1'), deviceId: 'foreign' });
        led.emitAvailability({ ...availability('availability-1'), deviceId: 'foreign' });
        led.emitHealth({ ...health('health-1'), deviceId: 'foreign' });
        expect(events).toEqual([]);
    });

    it('unsubscribes every stream and rejects dispatch after stop or for a wrong device', () => {
        const led = controllableLed();
        const events: PlatformEvent[] = [];
        const adapter = createSimulatorLedAdapter({
            led: led.transport,
            nativeLedId: 'led-native',
            platformDeviceId: 'led-platform',
            emitEvent: (event) => events.push(event),
        });
        expect(() =>
            adapter.dispatch({
                commandId: 'cmd-1',
                deviceId: 'other',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toThrow('led-platform');
        adapter.stop();
        led.emitReport(report('report-1'));
        led.emitRejection(rejection('rejection-1'));
        led.emitAvailability(availability('availability-1'));
        led.emitHealth(health('health-1'));
        expect(events).toEqual([]);
        expect(() =>
            adapter.dispatch({
                commandId: 'cmd-1',
                deviceId: 'led-platform',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        ).toThrow('stopped');
    });
});

function controllableLed(): {
    transport: LedCommandTransport;
    commands: LedSetPowerCommand[];
    emitReport(report: LedStateReport): void;
    emitRejection(rejection: LedCommandRejection): void;
    emitAvailability(report: LedAvailabilityReport): void;
    emitHealth(report: LedHealthReport): void;
} {
    const reports = new Set<LedStateReportListener>(),
        rejections = new Set<LedCommandRejectionListener>(),
        availabilities = new Set<LedAvailabilityListener>(),
        healths = new Set<LedHealthListener>();
    const commands: LedSetPowerCommand[] = [];

    return {
        transport: {
            onStateReport(listener) {
                reports.add(listener);

                return () => reports.delete(listener);
            },
            onCommandRejection(listener) {
                rejections.add(listener);

                return () => rejections.delete(listener);
            },
            onAvailability(listener) {
                availabilities.add(listener);

                return () => availabilities.delete(listener);
            },
            onHealth(listener) {
                healths.add(listener);

                return () => healths.delete(listener);
            },
            receive(command) {
                commands.push(command);
            },
        },
        commands,
        emitReport(message) {
            for (const listener of reports) {
                listener(message);
            }
        },
        emitRejection(message) {
            for (const listener of rejections) {
                listener(message);
            }
        },
        emitAvailability(message) {
            for (const listener of availabilities) {
                listener(message);
            }
        },
        emitHealth(message) {
            for (const listener of healths) {
                listener(message);
            }
        },
    };
}

const at = '2026-08-05T10:00:00Z';

function report(messageId: string, sequence = 1): LedStateReport {
    return {
        messageId,
        messageType: 'led.state.reported',
        deviceId: 'led-native',
        sequence,
        reportedState: { power: 'on' },
        reportedAt: at,
    };
}

function rejection(messageId: string): LedCommandRejection {
    return {
        messageId,
        messageType: 'led.command.rejected',
        commandId: 'cmd-1',
        deviceId: 'led-native',
        reason: 'command_rejected',
        rejectedAt: at,
    };
}

function availability(messageId: string): LedAvailabilityReport {
    return {
        messageId,
        messageType: 'led.availability.changed',
        deviceId: 'led-native',
        previousAvailability: 'unknown',
        availability: 'online',
        reportedAt: at,
    };
}

function health(messageId: string): LedHealthReport {
    return {
        messageId,
        messageType: 'led.health.changed',
        deviceId: 'led-native',
        previousHealth: 'unknown',
        health: 'healthy',
        reason: 'recovered',
        reportedAt: at,
    };
}
