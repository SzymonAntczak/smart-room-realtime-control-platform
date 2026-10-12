import type { RecentEventProjection } from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { describe, expect, it, vi } from 'vitest';

import { createRoomPublication } from './room-publication';

const snapshot = {
    roomName: 'Test room',
    updatedAt: '2026-10-12T10:00:00.000Z',
    devices: [],
    activeCommands: [],
    recentCommands: [],
    recentEvents: [],
    platform: {
        storage: {
            status: 'available',
            changedAt: '2026-10-12T10:00:00.000Z',
            historyGenerationId: 'generation-1',
            storedThroughSequence: 0,
        },
    },
} as unknown as RoomSnapshotProjection;

describe('createRoomPublication', () => {
    it('installs baseline and both audiences before invoking reentrant callbacks', () => {
        const publication = createRoomPublication({
            snapshotAt: () => snapshot,
            installedSnapshot: () => snapshot,
        });
        const lateSnapshotListener = vi.fn();
        const lateBatchListener = vi.fn();
        const seen: string[] = [];
        publication.subscribeRoomSnapshot(() => {
            seen.push(
                publication.lastPublishedSnapshot() === snapshot ? 'baseline-installed' : 'missing',
            );
            publication.subscribeRoomSnapshot(lateSnapshotListener);
            publication.subscribeRoomPublicationBatch(lateBatchListener);
        });
        publication.subscribeRoomPublicationBatch(() => seen.push('batch'));

        publication.notify('2026-10-12T10:00:00.000Z');

        expect(seen).toEqual(['baseline-installed', 'batch']);
        expect(lateSnapshotListener).not.toHaveBeenCalled();
        expect(lateBatchListener).not.toHaveBeenCalled();
    });

    it('isolates subscriber failures so later listeners receive the batch', () => {
        const publication = createRoomPublication({
            snapshotAt: () => snapshot,
            installedSnapshot: () => snapshot,
        });
        const healthyListener = vi.fn();
        publication.subscribeRoomSnapshot(() => {
            throw new Error('client failure');
        });
        publication.subscribeRoomSnapshot(healthyListener);

        expect(() => publication.notify('2026-10-12T10:00:00.000Z')).not.toThrow();
        expect(healthyListener).toHaveBeenCalledWith(snapshot);
    });

    it('publishes recovery reconciliation before the storage gap and installs the new baseline', () => {
        const gapEvent = {
            recordId: 'gap-1',
            eventType: 'storage.gap.recorded',
            occurredAt: '2026-10-12T10:01:00.000Z',
            durability: 'durable',
            storageSequence: 21,
            source: 'backend',
            payload: { outageStartedAt: '2026-10-12T09:59:00.000Z' },
        } as RecentEventProjection;
        const recoverySnapshot = {
            ...snapshot,
            updatedAt: '2026-10-12T10:01:00.000Z',
            devices: [{ deviceId: 'temp-desk', online: true }],
            recentEvents: [gapEvent],
        } as unknown as RoomSnapshotProjection;
        let installedSnapshot = snapshot;
        const publication = createRoomPublication({
            snapshotAt: () => installedSnapshot,
            installedSnapshot: () => installedSnapshot,
        });
        const received: unknown[] = [];
        publication.subscribeRoomPublicationBatch((batch) => received.push(batch));
        publication.notify('2026-10-12T10:00:00.000Z');
        installedSnapshot = recoverySnapshot;
        publication.stageRecoveryGap(gapEvent);

        publication.publishRecoveryCommit();

        const recoveredBatch = received[1] as {
            snapshot: RoomSnapshotProjection;
            deltas: { messageType: string; payload: Record<string, unknown> }[];
        };
        expect(recoveredBatch.snapshot).toBe(recoverySnapshot);
        expect(recoveredBatch.deltas.map((delta) => delta.messageType)).toEqual([
            'commands.updated',
            'platform.updated',
        ]);
        expect(recoveredBatch.deltas[0]?.payload.recentEvents).toEqual([]);
        expect(recoveredBatch.deltas[1]?.payload.recentEvents).toEqual([gapEvent]);
        expect(publication.lastPublishedSnapshot()).toBe(recoverySnapshot);
    });
});
