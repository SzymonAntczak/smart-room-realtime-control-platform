import { describe, expect, it, vi } from 'vitest';

import { createRoomRuntimeSession, createRoomStorageSession } from './room-storage-session';

describe('createRoomStorageSession', () => {
    it('replaces the storage handle and generation through session operations', () => {
        const firstStorage = {} as never;
        const nextStorage = {} as never;
        const runtimeSession = createRoomRuntimeSession({
            generateId: () => 'runtime-1',
            startedAt: '2026-10-12T10:00:00.000Z',
        });
        const session = createRoomStorageSession({
            runtimeSession,
            storage: firstStorage,
            status: {
                status: 'available',
                changedAt: '2026-10-12T10:00:00.000Z',
                historyGenerationId: 'generation-1',
                storedThroughSequence: 10,
            },
            verifiedHistoryGenerationId: 'generation-1',
        });

        session.installStorage(nextStorage);
        session.installVerifiedHistoryGenerationId('generation-2');
        session.installStatus({
            status: 'recovering',
            changedAt: '2026-10-12T10:00:01.000Z',
            reason: 'storage_recovering',
            historyGenerationId: 'generation-2',
            storedThroughSequence: 12,
        });

        expect(session.storage).toBe(nextStorage);
        expect(session.verifiedHistoryGenerationId).toBe('generation-2');
        expect(session.status).toMatchObject({
            status: 'recovering',
            historyGenerationId: 'generation-2',
            storedThroughSequence: 12,
        });
    });

    it('owns process session activation and close transactions', () => {
        const closeRuntimeSession = vi.fn();
        const transact = vi.fn((operation: (transaction: never) => unknown) => {
            operation({ closeRuntimeSession } as never);

            return { status: 'committed', value: undefined, retention: {} as never } as never;
        });
        const runtimeSession = createRoomRuntimeSession({
            generateId: () => 'runtime-2',
            startedAt: '2026-10-12T10:00:00.000Z',
        });
        const session = createRoomStorageSession({
            runtimeSession,
            storage: { transact } as never,
            status: {
                status: 'available',
                changedAt: '2026-10-12T10:00:00.000Z',
                historyGenerationId: 'generation-1',
                storedThroughSequence: 10,
            },
            verifiedHistoryGenerationId: 'generation-1',
        });
        const activateRuntimeSession = vi.fn();

        session.activateRuntimeSession(
            { activateRuntimeSession } as never,
            '2026-10-12T10:00:05.000Z',
        );
        const outcome = session.closeRuntimeSession('2026-10-12T10:00:10.000Z');

        expect(activateRuntimeSession).toHaveBeenCalledWith({
            sessionId: 'runtime-2',
            sessionStartedAt: '2026-10-12T10:00:00.000Z',
            lastDurableCommitAt: '2026-10-12T10:00:05.000Z',
        });
        expect(transact).toHaveBeenCalledWith(expect.any(Function), {
            retentionAsOf: '2026-10-12T10:00:10.000Z',
        });
        expect(closeRuntimeSession).toHaveBeenCalledWith({
            sessionId: 'runtime-2',
            closedAt: '2026-10-12T10:00:10.000Z',
        });
        expect(outcome).toMatchObject({ status: 'committed' });
    });
});
