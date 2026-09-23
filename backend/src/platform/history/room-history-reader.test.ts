import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RoomStorage } from '../storage/room-storage';
import { createSqliteRoomStorage } from '../storage/sqlite-room-storage';
import { StorageAvailabilityError } from '../storage/storage-errors';

import { createHistoryCursorCodec } from './room-history-cursor';
import { createRoomHistoryReader } from './room-history-reader';

describe('createRoomHistoryReader', () => {
    it('expires a later page at the fixed cursor deadline', () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-history-reader-'));
        const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
        let now = '2026-09-10T10:10:00.000Z';

        try {
            const outcome = storage.transact(
                (transaction) => {
                    transaction.appendSignificantFact({
                        recordId: `rec:v1:sha256:${'b'.repeat(64)}`,
                        eventType: 'storage.gap.recorded',
                        source: 'backend',
                        occurredAt: '2026-09-10T10:01:00.000Z',
                        payload: storageGapPayload('2026-09-10T10:01:00.000Z'),
                    });
                    transaction.appendSignificantFact({
                        recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
                        eventType: 'storage.gap.recorded',
                        source: 'backend',
                        occurredAt: '2026-09-10T10:02:00.000Z',
                        payload: storageGapPayload('2026-09-10T10:02:00.000Z'),
                    });
                },
                { retentionAsOf: now },
            );

            if (outcome.status !== 'committed') {
                throw outcome.error;
            }

            const reader = createRoomHistoryReader({
                storage,
                cursorCodec: createHistoryCursorCodec({ secret: Buffer.alloc(32, 2) }),
                now: () => now,
            });
            const firstPage = reader.readSignificantFactPage({ pageSize: 1 });

            expect(firstPage.status).toBe('available');

            if (firstPage.status !== 'available' || firstPage.value.nextCursor === null) {
                throw new Error('Expected a cursor for the second page.');
            }

            now = '2026-09-10T10:15:00.000Z';

            expect(
                reader.readSignificantFactPage({ pageSize: 1, cursor: firstPage.value.nextCursor }),
            ).toEqual({
                status: 'cursor_error',
                error: {
                    error: 'cursor_expired',
                    message: 'The pagination cursor has expired.',
                },
            });
        } finally {
            storage.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('returns an unavailable result when a continuation read loses storage', () => {
        const error = new StorageAvailabilityError('SQLite became unavailable.', new Error('EIO'));
        const codec = createHistoryCursorCodec({ secret: Buffer.alloc(32, 3) });
        const reader = createRoomHistoryReader({
            storage: {
                readPinnedSignificantFacts() {
                    throw error;
                },
            } as unknown as RoomStorage,
            cursorCodec: codec,
            now: () => '2026-09-10T10:11:00.000Z',
        });
        const cursor = codec.encode({
            version: 1,
            scope: {
                dataset: 'significant_facts',
                order: 'occurred_at_desc',
                pageSize: 1,
            },
            bounds: {
                historyGenerationId: 'generation-1',
                throughSequence: 2,
                retentionAsOf: '2026-09-10T10:10:00.000Z',
                retentionRevision: 1,
                expiresAt: '2026-09-10T10:15:00.000Z',
            },
            position: {
                occurredAt: '2026-09-10T10:02:00.000Z',
                storageSequence: 2,
            },
        });

        expect(reader.readSignificantFactPage({ pageSize: 1, cursor })).toEqual({
            status: 'unavailable',
            error,
        });
    });

    it('does not expose a stored fact that cannot validate against the shared durable schema', () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-history-reader-'));
        const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });

        try {
            const outcome = storage.transact(
                (transaction) => {
                    transaction.appendSignificantFact({
                        recordId: `rec:v1:sha256:${'a'.repeat(64)}`,
                        eventType: 'unsupported.fact',
                        occurredAt: '2026-09-10T10:00:00.000Z',
                        payload: {},
                    });
                },
                { retentionAsOf: '2026-09-10T10:10:00.000Z' },
            );

            if (outcome.status !== 'committed') {
                throw outcome.error;
            }

            const reader = createRoomHistoryReader({
                storage,
                cursorCodec: createHistoryCursorCodec({ secret: Buffer.alloc(32, 1) }),
                now: () => '2026-09-10T10:10:00.000Z',
            });

            expect(reader.readSignificantFactPage({ pageSize: 1 })).toEqual({
                status: 'invalid_internal_data',
            });
        } finally {
            storage.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});

function storageGapPayload(outageEndedAt: string) {
    return {
        outageStartedAt: '2026-09-10T09:59:00.000Z',
        outageEndedAt,
        failureReason: 'storage_unavailable',
        boundaryBasis: 'same_process_first_degraded_at' as const,
        observationsBackfilled: false as const,
    };
}
