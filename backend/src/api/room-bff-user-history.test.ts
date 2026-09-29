import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    type DurableSignificantFactProjection,
    isSignificantFactPage,
    type SignificantFactPage,
    type SignificantFactPageQuery,
} from '@smart-room/contracts/history';
import { isRoomSnapshotProjection } from '@smart-room/contracts/realtime';
import { isUserHistoryPage, type UserHistoryPage } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import { createHistoryCursorCodec } from '../platform/history/room-history-cursor';
import type { RoomHistoryReadResult } from '../platform/history/room-history-reader';
import { createRoomHistoryReader } from '../platform/history/room-history-reader';
import { createSqliteRoomStorage } from '../platform/storage/sqlite-room-storage';
import { StorageAvailabilityError } from '../platform/storage/storage-errors';

import { createRoomBffServer } from './room-bff';

describe('BFF user history (ST-4-06a-03)', () => {
    it('uses default 50 on first and subsequent pages and accepts explicit limits (AC-1, AC-6)', async () => {
        const history = createHarness();

        try {
            history.append(Array.from({ length: 51 }, (_, index) => gap(index + 1)));
            const first = await readPage(history, '');
            expect(first.pageSize).toBe(50);
            expect(first.items).toHaveLength(50);
            expect(first.nextCursor).toEqual(expect.any(String));
            const next = await readPage(history, cursorQuery(first));
            expect(next.pageSize).toBe(50);
            expect(next.items.map((item) => item.recordId)).toEqual([gap(1).recordId]);
            expect(next.nextCursor).toBeNull();
            const explicit = await readPage(history, `${cursorQuery(first)}&pageSize=50`);
            expect(explicit).toEqual(next);

            for (const pageSize of [1, 100]) {
                expect((await readPage(history, `pageSize=${pageSize}`)).pageSize).toBe(pageSize);
            }
        } finally {
            await history.close();
        }
    });

    it.each([
        'pageSize=',
        'pageSize=no',
        'pageSize=1.5',
        'pageSize=0',
        'pageSize=101',
        'pageSize=1&pageSize=2',
        'cursor=',
        'deviceId=led-main',
        'from=2026-09-10',
        'unexpected=true',
    ])('rejects invalid query %s before reading storage (AC-1, AC-7)', async (query) => {
        const history = createHarness();

        try {
            const read = vi.spyOn(history.storage, 'transact');
            const response = await history.server.inject({
                url: `/room/history/user-history?${query}`,
            });
            expect(response.statusCode).toBe(400);
            expect(response.json()).toMatchObject({ error: 'invalid_request' });
            expect(read).not.toHaveBeenCalled();
        } finally {
            await history.close();
        }
    });

    it('keeps user and raw cursors separate, signed and bound to effective page size (AC-6)', async () => {
        const history = createHarness();

        try {
            history.append(Array.from({ length: 21 }, (_, index) => gap(index + 1)));
            const first = await readPage(history, 'pageSize=20');
            const mismatch = await history.server.inject({
                url: `/room/history/user-history?${cursorQuery(first)}`,
            });
            expect(mismatch.statusCode).toBe(400);
            expect(mismatch.json()).toMatchObject({ error: 'cursor_query_mismatch' });
            const raw = await history.server.inject({
                url: '/room/history/significant-facts?pageSize=20',
            });
            const rawBody: unknown = raw.json();
            expect(isSignificantFactPage(rawBody)).toBe(true);

            if (
                !isSignificantFactPage(rawBody) ||
                rawBody.nextCursor === null ||
                first.nextCursor === null
            ) {
                throw new Error('Expected both cursors.');
            }

            const cursors = ['forged', rawBody.nextCursor, `${first.nextCursor}x`];

            for (const cursor of cursors) {
                const response = await history.server.inject({
                    url: `/room/history/user-history?pageSize=20&cursor=${encodeURIComponent(cursor)}`,
                });
                expect(response.statusCode).toBe(400);
                expect(response.json()).toMatchObject({ error: 'invalid_cursor' });
            }

            const cross = await history.server.inject({
                url: `/room/history/significant-facts?pageSize=20&${cursorQuery(first)}`,
            });
            expect(cross.statusCode).toBe(400);
            expect(cross.json()).toMatchObject({ error: 'invalid_cursor' });
            expect(
                (await readPage(history, `pageSize=20&${cursorQuery(first)}`)).items,
            ).toHaveLength(1);
        } finally {
            await history.close();
        }
    });

    it('preserves pinned watermark and retention membership until fixed expiry despite clock regression (AC-5)', async () => {
        const history = createHarness();

        try {
            history.append([gap(1), gap(2)]);
            const first = await readPage(history, 'pageSize=1');
            history.append([gap(3)]);
            history.setNow('2026-09-18T10:00:01.000Z');
            history.storage.transact(() => undefined, {
                retentionAsOf: '2026-09-18T10:00:01.000Z',
            });
            history.setNow('2026-09-10T10:00:01.000Z');
            const expired = await history.server.inject({
                url: `/room/history/user-history?pageSize=1&${cursorQuery(first)}`,
            });
            expect(expired.statusCode).toBe(400);
            expect(expired.json()).toMatchObject({ error: 'cursor_expired' });
        } finally {
            await history.close();
        }
    });

    it('continues a pinned page after concurrent writes and count retirement at the same millisecond (AC-5)', async () => {
        const history = createHarness();

        try {
            history.append([gap(1), gap(2)]);
            const first = await readPage(history, 'pageSize=1');
            history.append(Array.from({ length: 5000 }, (_, index) => gap(index + 3)));
            const next = await readPage(history, `pageSize=1&${cursorQuery(first)}`);
            expect(next.historyGenerationId).toBe(first.historyGenerationId);
            expect(next.throughSequence).toBe(first.throughSequence);
            expect(next.retentionAsOf).toBe(first.retentionAsOf);
            expect(next.items.map((item) => item.recordId)).toEqual([gap(1).recordId]);
            expect(next.nextCursor).toBeNull();
            expect((await readPage(history, 'pageSize=1')).items[0]?.recordId).toBe(
                gap(5002).recordId,
            );
        } finally {
            await history.close();
        }
    });

    it('rejects cursors after generation replacement and preserves 503 on unavailable reads (AC-5, AC-7)', async () => {
        const history = createHarness();

        try {
            history.append([gap(1), gap(2)]);
            const first = await readPage(history, 'pageSize=1');
            const read = vi
                .spyOn(history.storage, 'readPinnedSignificantFacts')
                .mockImplementation(() => {
                    throw new StorageAvailabilityError('Injected read failure.', null);
                });
            const unavailable = await history.server.inject({
                url: `/room/history/user-history?pageSize=1&${cursorQuery(first)}`,
            });
            expect(unavailable.statusCode).toBe(503);
            expect(unavailable.json()).toMatchObject({ error: 'durable_history_unavailable' });
            read.mockRestore();
            history.replaceGeneration();
            const changed = await history.server.inject({
                url: `/room/history/user-history?pageSize=1&${cursorQuery(first)}`,
            });
            expect(changed.statusCode).toBe(400);
            expect(changed.json()).toMatchObject({ error: 'history_generation_changed' });
        } finally {
            await history.close();
        }
    });

    it('expires at five minutes from the first page without extending on continuation (AC-5)', async () => {
        const history = createHarness();

        try {
            history.append([gap(1), gap(2), gap(3)]);
            const first = await readPage(history, 'pageSize=1');
            history.setNow('2026-09-10T12:04:59.999Z');
            const second = await readPage(history, `pageSize=1&${cursorQuery(first)}`);
            history.setNow('2026-09-10T12:05:00.000Z');
            const expired = await history.server.inject({
                url: `/room/history/user-history?pageSize=1&${cursorQuery(second)}`,
            });
            expect(expired.statusCode).toBe(400);
            expect(expired.json()).toMatchObject({ error: 'cursor_expired' });
        } finally {
            await history.close();
        }
    });

    it('joins historical timeout evidence through actual pinned SQLite reads without skipping older entries (AC-3, AC-4)', async () => {
        const history = createHarness();

        try {
            history.append([
                {
                    ...gap(1),
                    deviceId: 'led-main',
                    commandId: 'cmd',
                    eventType: 'command.requested',
                    payload: {
                        commandType: 'set.power',
                        requestedState: { power: 'off' },
                        requestedBy: 'user',
                    },
                },
                gap(2),
                {
                    ...gap(3),
                    deviceId: 'led-main',
                    commandId: 'cmd',
                    eventType: 'command.timed_out',
                    payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
                },
            ]);
            const first = await readPage(history, 'pageSize=1');
            expect(first.items).toEqual([
                {
                    recordId: gap(3).recordId,
                    occurredAt: gap(3).occurredAt,
                    storageSequence: 3,
                    source: 'backend',
                    durability: 'durable',
                    deviceId: 'led-main',
                    deviceName: 'Main LED',
                    kind: 'confirmation_missing',
                    requestedPower: 'off',
                },
            ]);
            expect(history.read).toHaveBeenCalledTimes(3);
            const second = await readPage(history, `pageSize=1&${cursorQuery(first)}`);
            expect(second.items[0]?.recordId).toBe(gap(2).recordId);
            const third = await readPage(history, `pageSize=1&${cursorQuery(second)}`);
            expect(third.items).toEqual([]);
            expect(third.nextCursor).toBeNull();
        } finally {
            await history.close();
        }
    });

    it.each([
        { result: { status: 'unavailable' }, code: 503, error: 'durable_history_unavailable' },
        {
            result: { status: 'invalid_internal_data' },
            code: 500,
            error: 'invalid_server_response',
        },
        {
            result: {
                status: 'cursor_error',
                error: { error: 'cursor_expired', message: 'Expired.' },
            },
            code: 400,
            error: 'cursor_expired',
        },
    ] satisfies {
        result: RoomHistoryReadResult<SignificantFactPage>;
        code: number;
        error: string;
    }[])(
        'returns $code without partial success on auxiliary $error (AC-7)',
        async ({ result, code, error }) => {
            const history = createHarness();

            try {
                history.append([
                    gap(1),
                    gap(2),
                    {
                        ...gap(3),
                        deviceId: 'led-main',
                        commandId: 'cmd',
                        eventType: 'command.timed_out',
                        payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
                    },
                ]);
                history.read
                    .mockImplementationOnce((query) =>
                        history.rawReader().readSignificantFactPage(query),
                    )
                    .mockReturnValueOnce(result);
                const response = await history.server.inject({
                    url: '/room/history/user-history?pageSize=2',
                });
                expect(response.statusCode).toBe(code);
                expect(response.json()).toMatchObject({ error });
                expect(response.json()).not.toHaveProperty('items');
                expect(history.read).toHaveBeenCalledTimes(2);
            } finally {
                await history.close();
            }
        },
    );

    it('distinguishes empty durable history from unavailable storage and rejects malformed raw data (AC-7)', async () => {
        const history = createHarness();

        try {
            expect((await readPage(history, '')).items).toEqual([]);
            history.read.mockReturnValueOnce({ status: 'unavailable' });
            const unavailable = await history.server.inject({ url: '/room/history/user-history' });
            expect(unavailable.statusCode).toBe(503);
            expect(unavailable.json()).toMatchObject({ error: 'durable_history_unavailable' });
            history.append([gap(1)]);
            const raw = history.rawReader().readSignificantFactPage({ pageSize: 50 });

            if (raw.status !== 'available') {
                throw new Error('Expected raw page.');
            }

            history.read.mockReturnValueOnce({
                status: 'available',
                value: {
                    ...raw.value,
                    items: [{ ...gap(1), payload: { invalid: true } }],
                } as unknown as SignificantFactPage,
            });
            const invalid = await history.server.inject({ url: '/room/history/user-history' });
            expect(invalid.statusCode).toBe(500);
            expect(invalid.json()).toMatchObject({ error: 'invalid_server_response' });
        } finally {
            await history.close();
        }
    });
});

async function readPage(
    history: ReturnType<typeof createHarness>,
    query: string,
): Promise<UserHistoryPage> {
    const response = await history.server.inject({
        url: `/room/history/user-history${query ? `?${query}` : ''}`,
    });
    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(isUserHistoryPage(body)).toBe(true);

    if (!isUserHistoryPage(body)) {
        throw new Error('Invalid user history page.');
    }

    return body;
}

function cursorQuery(page: UserHistoryPage): string {
    if (page.nextCursor === null) {
        throw new Error('Expected continuation.');
    }

    return `cursor=${encodeURIComponent(page.nextCursor)}`;
}

function gap(
    sequence: number,
): Extract<DurableSignificantFactProjection, { eventType: 'storage.gap.recorded' }> {
    const occurredAt = new Date(
        Date.parse('2026-09-10T09:00:00.000Z') + sequence * 1000,
    ).toISOString();

    return {
        recordId: `rec:v1:sha256:${sequence.toString(16).padStart(64, '0')}`,
        occurredAt,
        durability: 'durable',
        storageSequence: sequence,
        source: 'backend',
        eventType: 'storage.gap.recorded',
        payload: {
            outageStartedAt: occurredAt,
            outageEndedAt: occurredAt,
            failureReason: 'storage_unavailable',
            boundaryBasis: 'same_process_first_degraded_at',
            observationsBackfilled: false,
        },
    };
}

function createHarness() {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-user-history-'));
    const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
    const replacement = createSqliteRoomStorage({
        databasePath: join(directory, 'replacement.sqlite'),
    });
    let now = '2026-09-10T12:00:00.000Z';
    const codec = createHistoryCursorCodec({ secret: Buffer.alloc(32, 1) });
    let reader = createRoomHistoryReader({ storage, cursorCodec: codec, now: () => now });
    const projection = createUserHistoryFixtures().snapshot;
    const snapshot = {
        roomName: projection.roomName,
        updatedAt: projection.updatedAt,
        devices: projection.devices,
        activeCommands: projection.activeCommands,
        recentCommands: projection.recentCommands,
        platform: projection.platform,
        recentEvents: [],
    };

    if (!isRoomSnapshotProjection(snapshot)) {
        throw new Error('Invalid room fixture.');
    }

    const read = vi.fn((query: SignificantFactPageQuery) => reader.readSignificantFactPage(query));
    const server = createRoomBffServer({
        getRoomSnapshot: () => snapshot,
        getDiagnosticsSnapshot() {
            throw new Error('Diagnostics are outside this test boundary.');
        },
        subscribeRoomPublicationBatch: () => () => undefined,
        readSignificantFactPage: read,
    });

    return {
        server,
        storage,
        read,
        rawReader: () => reader,
        append(facts: DurableSignificantFactProjection[]) {
            const outcome = storage.transact(
                (transaction) => {
                    for (const fact of facts) {
                        transaction.appendSignificantFact(fact);
                    }
                },
                { retentionAsOf: now },
            );

            if (outcome.status !== 'committed') {
                throw outcome.error;
            }
        },
        setNow(value: string) {
            now = value;
        },
        replaceGeneration() {
            reader = createRoomHistoryReader({
                storage: replacement,
                cursorCodec: codec,
                now: () => now,
            });
        },
        async close() {
            await server.close();
            storage.close();
            replacement.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
}
