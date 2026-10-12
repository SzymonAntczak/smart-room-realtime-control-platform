import type { RecentEventProjection } from '@smart-room/contracts/history';
import { describe, expect, it, vi } from 'vitest';

import { createRoomState, type PendingStartupVolatileCommandFailure } from './room-state';

describe('createRoomState', () => {
    it('captures and installs recovery state through one bounded operation', () => {
        const getProjection = vi.fn(() => ({ roomName: 'living-room' }));
        const getEvidence = vi.fn(() => ({ evidence: 'current' }));
        const listVolatileIdentities = vi.fn(() => []);
        const installProjection = vi.fn();
        const projector = { getProjection, getEvidence, installProjection };
        const processor = {
            listVolatileIdentities,
            rememberDurableIdentity: vi.fn(),
            rememberVolatileIdentity: vi.fn(),
            forgetDurableIdentities: vi.fn(),
        };
        const state = createRoomState({
            projector: projector as never,
            processor: processor as never,
            diagnostics: {} as never,
            initialRecentEvents: [],
        });

        const captured = state.captureRecoveryState('2026-10-12T10:00:00.000Z');
        expect(captured.projection).toEqual({ roomName: 'living-room' });
        expect(captured.projectionEvidence).toEqual({ evidence: 'current' });
        expect(captured.volatileGuards).toEqual([]);

        state.installRecoveredState({
            projection: { roomName: 'recovered-room' },
            evaluatedAt: '2026-10-12T10:01:00.000Z',
            projectionEvidence: { evidence: 'recovered' },
            recentEvents: [],
            durableIdentities: [],
            startupCommandFailures: [],
            volatileGuards: [],
            retiredIdentityEventIds: [],
        } as never);

        expect(installProjection).toHaveBeenCalledOnce();
        expect(installProjection).toHaveBeenCalledWith(
            { roomName: 'recovered-room' },
            '2026-10-12T10:01:00.000Z',
            { evidence: 'recovered' },
        );
        expect(processor.rememberDurableIdentity).not.toHaveBeenCalled();
        expect(processor.rememberVolatileIdentity).not.toHaveBeenCalled();
    });

    it('owns history snapshots and returns copies to callers', () => {
        const state = createRoomState({
            projector: {} as never,
            processor: {} as never,
            diagnostics: {} as never,
            initialRecentEvents: [],
        });
        const supplied = [
            {
                recordId: 'record-1',
                eventType: 'storage.gap.recorded',
                occurredAt: '2026-10-12T10:00:00.000Z',
                durability: 'durable' as const,
                storageSequence: 1,
                source: 'backend',
                payload: {},
            },
        ] as unknown as RecentEventProjection[];

        state.installRecentEvents(supplied);
        supplied.length = 0;
        const read = state.recentEvents();
        read.length = 0;

        expect(state.recentEvents()).toHaveLength(1);
    });

    it('retains startup command failures until recovery consumes them', () => {
        const state = createRoomState({
            projector: {} as never,
            processor: {} as never,
            diagnostics: {} as never,
            initialRecentEvents: [],
        });
        const failure = {
            event: {
                eventId: 'lost-command',
                eventType: 'command.failed',
                occurredAt: '2026-10-12T10:00:00.000Z',
                source: 'backend',
                deviceId: 'led-main',
                commandId: 'command-1',
                payload: { reason: 'volatile_command_lost_on_restart', message: 'lost' },
            },
            acceptedAt: '2026-10-12T10:00:00.000Z',
            processingEvidence: {
                version: 1 as const,
                kind: 'command_intent' as const,
                intent: {
                    commandType: 'set.power' as const,
                    requestedState: { power: 'on' as const },
                },
            },
        } as PendingStartupVolatileCommandFailure;

        state.recordStartupCommandFailure(failure);
        expect(state.pendingStartupCommandFailures()).toEqual([failure]);
        state.clearStartupCommandFailures();
        expect(state.pendingStartupCommandFailures()).toEqual([]);
    });
});
