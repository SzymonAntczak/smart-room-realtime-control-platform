import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import { describe, expect, it } from 'vitest';

import { buildPublicationDeltas, sameJson } from './room-publication-policy';

describe('room publication policy', () => {
    it('publishes no deltas until a client has an installed baseline', () => {
        expect(buildPublicationDeltas(undefined, snapshot('available'), false, [])).toEqual([]);
    });

    it('publishes storage degradation before the volatile outcome and recovery after it', () => {
        const before = snapshot('available');
        const degraded = snapshot('degraded');
        const recovered = snapshot('available', '2026-09-10T10:00:02.000Z');

        expect(
            buildPublicationDeltas(before, degraded, true, []).map((delta) => delta.messageType),
        ).toEqual(['platform.updated']);
        expect(
            buildPublicationDeltas(degraded, recovered, false, []).map(
                (delta) => delta.messageType,
            ),
        ).toEqual(['platform.updated']);
    });

    it('compares JSON values by their serialized structural representation', () => {
        expect(sameJson({ room: ['a', 'b'] }, { room: ['a', 'b'] })).toBe(true);
        expect(sameJson({ room: ['a', 'b'] }, { room: ['b', 'a'] })).toBe(false);
    });
});

function snapshot(
    status: 'available' | 'degraded',
    changedAt = '2026-09-10T10:00:00.000Z',
): RoomSnapshotProjection {
    return {
        roomName: 'Test room',
        updatedAt: changedAt,
        devices: [],
        activeCommands: [],
        recentCommands: [],
        recentEvents: [],
        platform: {
            storage:
                status === 'available'
                    ? {
                          status,
                          changedAt,
                          historyGenerationId: 'generation-1',
                          storedThroughSequence: 0,
                      }
                    : {
                          status,
                          changedAt,
                          reason: 'storage_write_failed',
                          historyGenerationId: 'generation-1',
                          storedThroughSequence: 0,
                      },
        },
    };
}
