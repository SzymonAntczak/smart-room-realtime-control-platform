import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { DeviceProjection } from '@smart-room/contracts/projections';
import { describe, expect, it } from 'vitest';

import { toLedControlViewModel } from './led-control-view-model';

describe('toLedControlViewModel', () => {
    it('orders errors, warnings, and command progress while retaining error severity', () => {
        const viewModel = toLedControlViewModel({
            device: {
                ...createLed(),
                availability: 'offline',
                availabilityReason: 'device_unreachable',
                health: 'degraded',
                healthReason: 'partial_data',
                observationStatus: {
                    power: { freshness: 'stale', lastObservedAt: '2026-08-06T11:00:00Z' },
                },
            },
            activeCommand: createPendingCommand(),
            recentCommand: createTimedOutCommand(),
            transportError: 'Could not submit LED command.',
            realtimeUncertain: true,
            submitting: true,
            interactionLocked: false,
        });

        expect(viewModel.alert).toEqual({
            messages: [
                { kind: 'raw', message: 'Could not submit LED command.' },
                { kind: 'command-timed-out', reason: 'confirmation_missing' },
                { kind: 'offline', reason: 'device_unreachable' },
                { kind: 'degraded', reason: 'partial_data' },
                { kind: 'stale' },
                { kind: 'realtime-reconnecting' },
                { kind: 'submitting' },
                { kind: 'requested', power: 'on' },
            ],
            variant: 'error',
        });
    });

    it('keeps reported power distinct from a requested active command', () => {
        const viewModel = toLedControlViewModel({
            device: createLed(),
            activeCommand: createPendingCommand(),
            realtimeUncertain: false,
            submitting: false,
            interactionLocked: false,
        });

        expect(viewModel.hasReportedPower).toBe(true);
        expect(viewModel.isOn).toBe(false);
        expect(viewModel.isInteractionDisabled).toBe(true);
        expect(viewModel.alert).toEqual({
            messages: [{ kind: 'requested', power: 'on' }],
            variant: 'info',
        });
    });

    it('keeps an unknown bootstrap state disabled without an alert', () => {
        const viewModel = toLedControlViewModel({
            device: {
                ...createLed(),
                availability: 'unknown',
                health: 'unknown',
                reportedState: {},
                observationStatus: {},
                commandAvailability: { policy: 'block', reason: 'availability_unknown' },
            },
            realtimeUncertain: false,
            submitting: false,
            interactionLocked: false,
        });

        expect(viewModel.hasReportedPower).toBe(false);
        expect(viewModel.isInteractionDisabled).toBe(true);
        expect(viewModel.alert).toEqual({ messages: [] });
    });
});

function createLed(): DeviceProjection {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-08-06T12:00:00Z',
        health: 'healthy',
        healthChangedAt: '2026-08-06T12:00:00Z',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: { freshness: 'unknown', lastObservedAt: '2026-08-06T12:00:00Z' },
        },
        activeCommandId: 'cmd-1',
    };
}

function createPendingCommand(): ActiveCommandProjection {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: '2026-08-06T12:00:00Z',
        dispatchedAt: '2026-08-06T12:00:01Z',
    };
}

function createTimedOutCommand(): TerminalCommandProjection {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'timed_out',
        requestedState: { power: 'on' },
        requestedAt: '2026-08-06T12:00:00Z',
        dispatchedAt: '2026-08-06T12:00:01Z',
        timedOutAt: '2026-08-06T12:00:06Z',
        reason: 'confirmation_missing',
    };
}
