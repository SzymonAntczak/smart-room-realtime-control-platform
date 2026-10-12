import { describe, expect, it, vi } from 'vitest';

import { createRoomProjector } from '../read-model/room-projection';

import { initializeProjectionCheckpoint } from './room-storage-recovery';
import { createRoomRuntimeSession } from './room-storage-session';

describe('initializeProjectionCheckpoint', () => {
    it('writes the initial checkpoint and activates the owning process session atomically', () => {
        const projection = createRoomProjector({
            devices: [],
            initialUpdatedAt: '2026-10-12T10:00:00.000Z',
        });
        const runtimeSession = createRoomRuntimeSession({
            generateId: () => 'runtime-1',
            startedAt: '2026-10-12T10:00:00.000Z',
        });
        const saveLatestRoomProjection = vi.fn();
        const activateRuntimeSession = vi.fn();
        const transaction = { saveLatestRoomProjection, activateRuntimeSession };
        const transact = vi.fn((operation: (transaction: never) => unknown) => ({
            status: 'committed',
            value: operation(transaction as never),
            retention: {} as never,
        }));
        const storage = {
            transact,
            getLatestRoomProjection: vi.fn(() => undefined),
        };

        const outcome = initializeProjectionCheckpoint(
            storage as never,
            projection,
            '2026-10-12T10:00:00.000Z',
            {
                runtimeSession,
                priorUnclosedRuntimeSessions: [],
                generateEventId: () => 'event-1',
            },
        );

        expect(outcome).toMatchObject({ restored: false, volatileGuards: [], recentEvents: [] });
        expect(transact).toHaveBeenCalledTimes(2);
        expect(activateRuntimeSession).toHaveBeenCalledTimes(2);
        expect(activateRuntimeSession).toHaveBeenLastCalledWith({
            sessionId: 'runtime-1',
            sessionStartedAt: '2026-10-12T10:00:00.000Z',
            lastDurableCommitAt: '2026-10-12T10:00:00.000Z',
        });
        expect(saveLatestRoomProjection).toHaveBeenCalledOnce();
    });
});
