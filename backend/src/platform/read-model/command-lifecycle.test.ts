import type {
    CommandDispatchedEvent,
    CommandFailedEvent,
    CommandRequestedEvent,
    CommandTimedOutEvent,
    DeviceStateReportedEvent,
} from '@smart-room/contracts/events';
import { describe, expect, it } from 'vitest';

import { createRoomProjector, ledSetPowerTimeoutMs } from './room-projection';

describe('command lifecycle projections', () => {
    it('keeps requested state active until a matching LED report confirms it', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));

        expect(projector.getProjection().devices[0]).toEqual(
            expect.objectContaining({ reportedState: { power: 'off' }, activeCommandId: 'cmd-1' }),
        );
        expect(projector.getProjection().activeCommands).toEqual([
            expect.objectContaining({
                commandId: 'cmd-1',
                status: 'accepted',
                requestedState: { power: 'on' },
            }),
        ]);

        projector.applyCommandDispatched(dispatched('cmd-1'));
        const confirmed = projector.applyDeviceStateReported(report('on', '2026-08-05T10:00:02Z'));

        expect(confirmed.devices[0]).toEqual(
            expect.objectContaining({ reportedState: { power: 'on' } }),
        );
        expect(confirmed.devices[0]?.activeCommandId).toBeUndefined();
        expect(confirmed.activeCommands).toEqual([]);
        expect(confirmed.recentCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'confirmed' }),
        ]);
    });

    it('keeps an accepted command active when a later availability fact becomes offline', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));

        const snapshot = projector.applyDeviceAvailabilityChanged({
            eventId: 'evt-led-offline',
            eventType: 'device.availability.changed',
            occurredAt: '2026-08-05T10:00:02Z',
            source: 'simulator-adapter',
            deviceId: 'led-main',
            payload: {
                previousAvailability: 'online',
                availability: 'offline',
                reason: 'device_disconnected',
            },
        });

        expect(snapshot.devices[0]).toMatchObject({
            availability: 'offline',
            activeCommandId: 'cmd-1',
            commandAvailability: { policy: 'block', reason: 'device_offline' },
        });
        expect(snapshot.activeCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'accepted' }),
        ]);
    });

    it('rejects a competing request so its producer must emit command.failed explicitly', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));

        expect(() => projector.applyCommandRequested(requested('cmd-2', 'off'))).toThrow(
            'Device led-main already has an active command.',
        );
        expect(projector.getProjection().activeCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1' }),
        ]);
        expect(projector.getProjection().recentCommands).toEqual([]);
    });

    it('accepts a command before the device has an observed projection', () => {
        const projector = createLedProjector();

        expect(projector.applyCommandRequested(requested('cmd-1', 'on')).activeCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'accepted' }),
        ]);
    });

    it('confirms an immediate adapter report after dispatch is recorded', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));
        projector.applyDeviceStateReported(report('on', '2026-08-05T10:00:01Z'));

        const projection = projector.applyCommandDispatched(dispatched('cmd-1'));

        expect(projection.activeCommands).toEqual([]);
        expect(projection.recentCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'confirmed' }),
        ]);
    });

    it('keeps a pending command when physical state reports a nonmatching value', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));
        projector.applyCommandDispatched(dispatched('cmd-1'));

        const afterNonmatchingReport = projector.applyDeviceStateReported(
            report('off', '2026-08-05T10:00:02Z'),
        );

        expect(afterNonmatchingReport.devices[0]).toEqual(
            expect.objectContaining({ reportedState: { power: 'off' }, activeCommandId: 'cmd-1' }),
        );
        expect(afterNonmatchingReport.activeCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'pending' }),
        ]);

        const afterMatchingReport = projector.applyDeviceStateReported(
            report('on', '2026-08-05T10:00:03Z'),
        );

        expect(afterMatchingReport.recentCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'confirmed' }),
        ]);
    });

    it('ignores an older observation instead of regressing physical state', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('on', '2026-08-05T10:00:02Z'));

        const projection = projector.applyDeviceStateReported(
            report('off', '2026-08-05T10:00:01Z'),
        );

        expect(projection.devices[0]).toEqual(
            expect.objectContaining({ reportedState: { power: 'on' } }),
        );
    });

    it('keeps a timed-out command terminal when a matching report arrives late', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));
        projector.applyCommandDispatched(dispatched('cmd-1'));
        projector.applyCommandTimedOut(timedOut('cmd-1'));

        const projection = projector.applyDeviceStateReported(report('on', '2026-08-05T10:00:06Z'));

        expect(projection.devices[0]).toEqual(
            expect.objectContaining({ reportedState: { power: 'on' } }),
        );
        expect(projection.activeCommands).toEqual([]);
        expect(projection.recentCommands).toEqual([
            expect.objectContaining({ commandId: 'cmd-1', status: 'timed_out' }),
        ]);
    });

    it('moves explicit device rejection to terminal history', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));
        projector.applyCommandDispatched(dispatched('cmd-1'));

        const projection = projector.applyCommandFailed(failed('cmd-1'));

        expect(projection.activeCommands).toEqual([]);
        expect(projection.recentCommands).toEqual([
            expect.objectContaining({
                commandId: 'cmd-1',
                status: 'failed',
                reason: 'device_rejected',
            }),
        ]);
    });

    it('requires the configured 5000 ms timeout after dispatch', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));
        projector.applyCommandRequested(requested('cmd-1', 'on'));
        projector.applyCommandDispatched(dispatched('cmd-1'));

        expect(() =>
            projector.applyCommandTimedOut({
                ...timedOut('cmd-1'),
                occurredAt: '2026-08-05T10:00:05.999Z',
            }),
        ).toThrow(`Command timeout must occur at least ${ledSetPowerTimeoutMs} ms after dispatch.`);
        expect(() =>
            projector.applyCommandTimedOut({
                ...timedOut('cmd-1'),
                payload: { timeoutMs: 1, reason: 'confirmation_not_received' },
            }),
        ).toThrow(`LED set.power timeout must be ${ledSetPowerTimeoutMs} ms.`);
    });

    it('retains at most 20 newest terminal command outcomes', () => {
        const projector = createLedProjector();
        projector.applyDeviceStateReported(report('off'));

        for (let index = 1; index <= 21; index += 1) {
            const commandId = `cmd-${index}`;
            const timestamp = `2026-08-05T10:00:${String(index).padStart(2, '0')}Z`;
            projector.applyCommandRequested(requested(commandId, 'on', timestamp));
            projector.applyCommandFailed(failed(commandId, timestamp));
        }

        const recentCommands = projector.getProjection().recentCommands;
        expect(recentCommands).toHaveLength(20);
        expect(recentCommands[0]?.commandId).toBe('cmd-21');
        expect(recentCommands.at(-1)?.commandId).toBe('cmd-2');
    });
});

function createLedProjector() {
    return createRoomProjector({
        initialUpdatedAt: '2026-08-05T09:59:59Z',
        devices: [{ deviceId: 'led-main', name: 'Main LED', role: 'led-output' }],
    });
}

function report(
    power: 'on' | 'off',
    occurredAt = '2026-08-05T10:00:00Z',
): DeviceStateReportedEvent {
    return {
        eventId: `evt-report-${occurredAt}`,
        eventType: 'device.state.reported',
        occurredAt,
        source: 'simulator-adapter',
        deviceId: 'led-main',
        payload: { reportedState: { power } },
    };
}

function requested(
    commandId: string,
    power: 'on' | 'off',
    occurredAt = '2026-08-05T10:00:01Z',
): CommandRequestedEvent {
    return {
        eventId: `evt-requested-${commandId}`,
        eventType: 'command.requested',
        occurredAt,
        source: 'backend',
        deviceId: 'led-main',
        commandId,
        payload: { commandType: 'set.power', requestedState: { power }, requestedBy: 'user' },
    };
}

function dispatched(commandId: string): CommandDispatchedEvent {
    return {
        eventId: `evt-dispatched-${commandId}`,
        eventType: 'command.dispatched',
        occurredAt: '2026-08-05T10:00:01Z',
        source: 'backend',
        deviceId: 'led-main',
        commandId,
        payload: { commandType: 'set.power', target: 'simulator-adapter' },
    };
}

function failed(commandId: string, occurredAt = '2026-08-05T10:00:02Z'): CommandFailedEvent {
    return {
        eventId: `evt-failed-${commandId}`,
        eventType: 'command.failed',
        occurredAt,
        source: 'simulator-adapter',
        deviceId: 'led-main',
        commandId,
        payload: { reason: 'device_rejected', message: 'The simulated LED rejected the command.' },
    };
}

function timedOut(commandId: string): CommandTimedOutEvent {
    return {
        eventId: `evt-timeout-${commandId}`,
        eventType: 'command.timed_out',
        occurredAt: '2026-08-05T10:00:06Z',
        source: 'backend',
        deviceId: 'led-main',
        commandId,
        payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
    };
}
