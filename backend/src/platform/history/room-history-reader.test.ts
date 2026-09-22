import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createSqliteRoomStorage } from '../storage/sqlite-room-storage';

import { createRoomHistoryReader } from './room-history-reader';

describe('createRoomHistoryReader', () => {
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
                now: () => '2026-09-10T10:10:00.000Z',
            });

            expect(reader.readSignificantFactFirstPage({ pageSize: 1 })).toEqual({
                status: 'invalid_internal_data',
            });
        } finally {
            storage.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
