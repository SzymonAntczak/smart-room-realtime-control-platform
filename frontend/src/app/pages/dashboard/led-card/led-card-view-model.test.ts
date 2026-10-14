import type {
    AcceptedCommandResponse,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import { terminalCommandProjectionSchema } from '@smart-room/contracts/projections';
import { isSchema } from '@smart-room/contracts/validation';
import { describe, expect, it } from 'vitest';

import { toLedCardViewModel } from './led-card-view-model';
import type { LedDeviceProjection } from './LedCard';

describe('toLedCardViewModel', () => {
    it('keeps an accepted command loading until its realtime projection arrives', () => {
        const accepted: AcceptedCommandResponse = {
            commandId: 'cmd-1',
            status: 'accepted',
            durability: 'durable',
            lifecycleDurability: 'durable',
        };
        const unrelatedRecentCommand: TerminalCommandProjection = {
            ...createPendingCommand(),
            commandId: 'cmd-remote',
            status: 'confirmed',
            confirmedAt: '2026-08-06T12:01:00Z',
        };
        const viewModel = toLedCardViewModel({
            device: createLed(),
            recentCommand: unrelatedRecentCommand,
            admissionEvidence: accepted,
            realtimeUncertain: false,
            submitting: false,
            interactionLocked: false,
        });

        expect(viewModel.isLoading).toBe(true);
        expect(viewModel.isInteractionDisabled).toBe(true);
        expect(viewModel.alert).toEqual({
            messages: [{ kind: 'command-confirmed', time: '2026-08-06T12:01:00Z' }],
            variant: 'info',
        });
    });

    it('shows a stable timeout error alongside current device warnings', () => {
        const timedOut: TerminalCommandProjection = {
            ...createPendingCommand(),
            status: 'timed_out',
            timedOutAt: '2026-08-06T12:00:06Z',
            reason: 'confirmation_missing',
        };
        expect(isSchema(terminalCommandProjectionSchema, timedOut)).toBe(true);
        const viewModel = toLedCardViewModel({
            device: {
                ...createLed(),
                availability: 'offline',
                health: 'degraded',
                observationStatus: {
                    power: {
                        freshness: 'stale',
                        lastObservedAt: '2026-08-06T11:00:00Z',
                        durability: 'durable',
                    },
                },
            },
            recentCommand: timedOut,
            realtimeUncertain: true,
            submitting: false,
            interactionLocked: false,
        });

        expect(viewModel.alert).toEqual({
            messages: [
                { kind: 'command-timed-out', reason: 'confirmation_missing' },
                { kind: 'offline', reason: undefined },
                { kind: 'degraded', reason: undefined },
                { kind: 'stale' },
                { kind: 'realtime-reconnecting' },
            ],
            variant: 'error',
        });
        expect(viewModel.isInteractionDisabled).toBe(true);
    });

    it('lets a newer terminal command replace an older locally correlated result', () => {
        const newerTimedOut: TerminalCommandProjection = {
            ...createPendingCommand(),
            commandId: 'cmd-newer',
            status: 'timed_out',
            timedOutAt: '2026-08-06T12:01:06Z',
            reason: 'confirmation_missing',
            durability: 'volatile',
            lifecycleDurability: 'volatile',
        };
        const olderConfirmed: TerminalCommandProjection = {
            ...createPendingCommand(),
            status: 'confirmed',
            confirmedAt: '2026-08-06T12:00:06Z',
        };
        expect(isSchema(terminalCommandProjectionSchema, newerTimedOut)).toBe(true);
        expect(isSchema(terminalCommandProjectionSchema, olderConfirmed)).toBe(true);

        const viewModel = toLedCardViewModel({
            device: createLed(),
            recentCommand: newerTimedOut,
            correlatedCommand: olderConfirmed,
            realtimeUncertain: false,
            submitting: false,
            interactionLocked: false,
        });

        expect(viewModel.alert.messages).toEqual([
            { kind: 'command-timed-out', reason: 'confirmation_missing' },
        ]);
    });

    it('shows a newer active command and its volatile intent over an older local success', () => {
        const olderConfirmed: TerminalCommandProjection = {
            ...createPendingCommand(),
            status: 'confirmed',
            confirmedAt: '2026-08-06T12:00:06Z',
        };
        const newerActive = {
            ...createPendingCommand(),
            commandId: 'cmd-newer',
            durability: 'volatile',
            lifecycleDurability: 'volatile',
        } as const;

        const viewModel = toLedCardViewModel({
            device: createLed(),
            activeCommand: newerActive,
            correlatedCommand: olderConfirmed,
            realtimeUncertain: false,
            submitting: false,
            interactionLocked: false,
        });

        expect(viewModel.isLoading).toBe(true);
        expect(viewModel.alert.messages).toEqual([{ kind: 'requested', power: 'on' }]);
    });

    it('keeps the established command alert separate from durability evidence', () => {
        const viewModel = toLedCardViewModel({
            device: {
                ...createLed(),
                availabilityDurability: 'volatile',
                healthDurability: 'volatile',
                observationStatus: {
                    power: {
                        freshness: 'fresh',
                        lastObservedAt: '2026-08-06T12:00:00Z',
                        durability: 'volatile',
                    },
                },
            },
            activeCommand: {
                ...createPendingCommand(),
                durability: 'volatile',
                lifecycleDurability: 'durable',
            },
            realtimeUncertain: false,
            submitting: false,
            interactionLocked: false,
        });

        expect(viewModel.alert.messages).toEqual([{ kind: 'requested', power: 'on' }]);
        expect(viewModel.alert.variant).toBe('info');
    });

    it('disables unknown power without inventing a pressed state', () => {
        const viewModel = toLedCardViewModel({
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
        expect(viewModel.isLoading).toBe(false);
        expect(viewModel.isInteractionDisabled).toBe(true);
        expect(viewModel.alert.messages).toEqual([]);
    });
});

function createLed(): LedDeviceProjection {
    return {
        deviceId: 'led-main',
        name: 'Main LED',
        role: 'led-output',
        availability: 'online',
        availabilityChangedAt: '2026-08-06T12:00:00Z',
        availabilityDurability: 'durable',
        health: 'healthy',
        healthChangedAt: '2026-08-06T12:00:00Z',
        healthDurability: 'durable',
        reportedState: { power: 'off' },
        commandAvailability: { policy: 'allow' },
        observationStatus: {
            power: {
                freshness: 'unknown',
                lastObservedAt: '2026-08-06T12:00:00Z',
                durability: 'durable',
            },
        },
        activeCommandId: 'cmd-1',
    };
}

function createPendingCommand() {
    return {
        commandId: 'cmd-1',
        deviceId: 'led-main',
        commandType: 'set.power',
        status: 'pending',
        requestedState: { power: 'on' },
        requestedAt: '2026-08-06T12:00:00Z',
        delivery: {
            status: 'handed_off',
            dispatchedAt: '2026-08-06T12:00:01Z',
            deadlineAt: '2026-08-06T12:00:06Z',
        },
        durability: 'durable',
        lifecycleDurability: 'durable',
    } as const;
}
