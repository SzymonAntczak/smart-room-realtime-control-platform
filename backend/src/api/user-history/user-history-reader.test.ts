import type { DurableSignificantFactProjection } from '@smart-room/contracts/history';
import { isUserHistoryPage, type UserHistoryPage } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import type {
    PinnedSignificantFactSnapshot,
    RoomHistoryReader,
    RoomHistoryReadResult,
} from '../../platform/history/room-history-reader';

import { createUserHistoryReader } from './user-history-reader';

describe('pinned user history reader', () => {
    it('fills a device page across sparse facts in one read and preserves remaining matches', () => {
        const h = createHarness([failure(1), gap(2), failure(3), gap(4), failure(5)]);
        const first = available(h.reader.readPage({ pageSize: 2, deviceId: 'led-main' }));
        expect(first.items.map((item) => item.recordId)).toEqual([
            failure(5).recordId,
            failure(3).recordId,
        ]);
        expect(h.raw).toHaveBeenCalledTimes(1);
        const second = available(
            h.reader.readPage({ pageSize: 2, deviceId: 'led-main', cursor: continuation(first) }),
        );
        expect(second.items.map((item) => item.recordId)).toEqual([failure(1).recordId]);
        expect(second.nextCursor).toBeNull();
        expect(h.raw).toHaveBeenLastCalledWith(h.value.bounds);
    });
    it('returns an empty terminal page only when no matching retained entry exists', () => {
        const h = createHarness([gap(1), gap(2)]);
        expect(available(h.reader.readPage({ pageSize: 1, deviceId: 'led-main' }))).toMatchObject({
            items: [],
            nextCursor: null,
        });
        const exact = available(h.reader.readPage({ pageSize: 2 }));
        expect(exact.items).toHaveLength(2);
        expect(exact.nextCursor).toBeNull();
    });
    it('uses the complete pinned evidence before date filtering and omits conflicting timeout targets', () => {
        const h = createHarness([request(1), timeout(3)]);
        const first = available(
            h.reader.readPage({ pageSize: 1, deviceId: 'led-main', from: common(3).occurredAt }),
        );
        expect(first.items).toMatchObject([{ kind: 'confirmation_missing', requestedPower: 'on' }]);
        const conflict = createHarness([request(1), timeout(3), request(4, 'off')]);
        expect(available(conflict.reader.readPage({ pageSize: 1 })).items).toEqual([]);

        for (const facts of [
            [timeout(3)],
            [{ ...request(1), commandId: 'other' }, timeout(3)],
            [{ ...request(1), deviceId: 'other' }, timeout(3)],
        ]) {
            expect(available(createHarness(facts).reader.readPage({ pageSize: 1 })).items).toEqual(
                [],
            );
        }
    });
    it('paginates equal timestamps using storage sequence without skipping or repeating entries', () => {
        const facts = [failure(1), failure(2), failure(3)].map((item) => ({
            ...item,
            occurredAt: common(1).occurredAt,
        }));
        const h = createHarness(facts);
        const ids: string[] = [];
        let cursor: string | undefined;

        do {
            const page = available(h.reader.readPage({ pageSize: 1, cursor }));
            ids.push(...page.items.map((item) => item.recordId));
            cursor = page.nextCursor ?? undefined;
        } while (cursor);

        expect(ids).toEqual([...facts].reverse().map((item) => item.recordId));
    });
    it('binds normalized device, date and page-size scope to the cursor', () => {
        const h = createHarness([failure(1), failure(2), failure(3)]);
        const query = { pageSize: 1, deviceId: 'led-main', from: common(1).occurredAt };
        const first = available(h.reader.readPage(query));
        const cursor = continuation(first);
        const equivalent = available(
            h.reader.readPage({ ...query, cursor, from: '2026-09-10T10:00:01+01:00' }),
        );
        expect(equivalent.items[0]?.recordId).toBe(failure(2).recordId);

        for (const changed of [
            { ...query, deviceId: 'other' },
            { ...query, from: undefined },
            { ...query, pageSize: 2 },
        ]) {
            expect(h.reader.readPage({ ...changed, cursor })).toMatchObject({
                status: 'cursor_error',
                error: { error: 'cursor_query_mismatch' },
            });
        }

        expect(h.reader.readPage({ pageSize: 1, cursor: 'old-or-forged' })).toMatchObject({
            status: 'cursor_error',
            error: { error: 'invalid_cursor' },
        });
    });
    it.each(['unavailable', 'invalid_internal_data', 'cursor_error'] as const)(
        'propagates %s without partial success',
        (status) => {
            const h = createHarness([failure(1)]);
            const failureResult: RoomHistoryReadResult<PinnedSignificantFactSnapshot> =
                status === 'cursor_error'
                    ? { status, error: { error: 'cursor_expired', message: 'Expired' } }
                    : { status };
            h.raw.mockReturnValueOnce(failureResult);
            expect(h.reader.readPage({ pageSize: 1 })).toEqual(failureResult);
        },
    );
    it('rejects malformed facts, duplicate identities, incorrect order and changed pinned bounds', () => {
        const h = createHarness([failure(1), failure(2)]);

        for (const items of [
            [{ ...failure(1), payload: { invalid: true } }],
            [failure(1), failure(1)],
            [failure(1), failure(2)],
        ]) {
            h.raw.mockReturnValueOnce({
                status: 'available',
                value: { ...h.value, items: items as DurableSignificantFactProjection[] },
            });
            expect(h.reader.readPage({ pageSize: 1 })).toEqual({ status: 'invalid_internal_data' });
        }

        const first = available(h.reader.readPage({ pageSize: 1 }));
        h.raw.mockReturnValueOnce({
            status: 'available',
            value: { ...h.value, bounds: { ...h.value.bounds, retentionRevision: 2 } },
        });
        expect(h.reader.readPage({ pageSize: 1, cursor: continuation(first) })).toEqual({
            status: 'invalid_internal_data',
        });
    });
    it('handles all 5000 retained facts in one read and rejects a violated bound', () => {
        const h = createHarness([
            request(1),
            ...Array.from({ length: 4998 }, (_, i) => gap(i + 2)),
            timeout(5000),
        ]);
        const page = available(h.reader.readPage({ pageSize: 50 }));
        expect(page.items).toHaveLength(50);
        expect(page.items[0]).toMatchObject({ kind: 'confirmation_missing' });
        expect(h.raw).toHaveBeenCalledTimes(1);
        expect(
            createHarness(Array.from({ length: 5001 }, (_, i) => gap(i + 1))).reader.readPage({
                pageSize: 50,
            }),
        ).toEqual({ status: 'invalid_internal_data' });
    });
    it('omits unevidenced changes and command progress, removed devices and out-of-range entries', () => {
        const h = createHarness([
            request(1),
            { ...failure(2), deviceId: 'removed' },
            {
                ...common(3),
                eventType: 'device.state.reported',
                deviceId: 'led-main',
                payload: { reportedState: { power: 'on' } },
            },
            failure(4),
            failure(5),
        ]);
        expect(
            available(h.reader.readPage({ pageSize: 50, to: common(5).occurredAt })).items.map(
                (item) => item.recordId,
            ),
        ).toEqual([failure(4).recordId]);
    });
});

function createHarness(facts: DurableSignificantFactProjection[]) {
    const bff = createUserHistoryFixtures().snapshot;
    const snapshot = {
        roomName: bff.roomName,
        updatedAt: bff.updatedAt,
        devices: bff.devices,
        activeCommands: bff.activeCommands,
        recentCommands: bff.recentCommands,
        platform: bff.platform,
        recentEvents: [],
    };
    const value: PinnedSignificantFactSnapshot = {
        bounds: {
            historyGenerationId: 'generation',
            throughSequence: Math.max(0, ...facts.map((f) => f.storageSequence)),
            retentionAsOf: '2026-09-10T12:00:00.000Z',
            retentionRevision: 0,
            expiresAt: '2026-09-10T12:05:00.000Z',
        },
        items: [...facts].sort(
            (a, b) =>
                Date.parse(b.occurredAt) - Date.parse(a.occurredAt) ||
                b.storageSequence - a.storageSequence,
        ),
    };
    const raw = vi.fn<RoomHistoryReader['readPinnedSignificantFactSnapshot']>(() => ({
        status: 'available',
        value,
    }));

    return {
        value,
        raw,
        reader: createUserHistoryReader({
            readPinnedSignificantFactSnapshot: raw,
            getRoomSnapshot: () => snapshot,
        }),
    };
}

function available(result: RoomHistoryReadResult<UserHistoryPage>): UserHistoryPage {
    expect(result.status).toBe('available');

    if (result.status !== 'available' || !isUserHistoryPage(result.value)) {
        throw new Error('Expected validated page');
    }

    return result.value;
}

function continuation(page: UserHistoryPage): string {
    if (page.nextCursor === null) {
        throw new Error('Expected continuation');
    }

    return page.nextCursor;
}

function common(sequence: number) {
    return {
        recordId: `rec:v1:sha256:${sequence.toString(16).padStart(64, '0')}`,
        occurredAt: new Date(
            Date.parse('2026-09-10T09:00:00.000Z') + sequence * 1000,
        ).toISOString(),
        source: 'backend',
        durability: 'durable',
        storageSequence: sequence,
    } as const;
}

function failure(
    sequence: number,
): Extract<DurableSignificantFactProjection, { eventType: 'command.failed' }> {
    return {
        ...common(sequence),
        deviceId: 'led-main',
        commandId: 'cmd',
        eventType: 'command.failed',
        payload: { reason: 'failed', message: 'Attempt failed.' },
    };
}

function timeout(
    sequence: number,
): Extract<DurableSignificantFactProjection, { eventType: 'command.timed_out' }> {
    return {
        ...common(sequence),
        deviceId: 'led-main',
        commandId: 'cmd',
        eventType: 'command.timed_out',
        payload: { timeoutMs: 5000, reason: 'confirmation_not_received' },
    };
}

function request(
    sequence: number,
    power: 'on' | 'off' = 'on',
): Extract<DurableSignificantFactProjection, { eventType: 'command.requested' }> {
    return {
        ...common(sequence),
        deviceId: 'led-main',
        commandId: 'cmd',
        eventType: 'command.requested',
        payload: { commandType: 'set.power', requestedState: { power }, requestedBy: 'user' },
    };
}

function gap(
    sequence: number,
): Extract<DurableSignificantFactProjection, { eventType: 'storage.gap.recorded' }> {
    return {
        ...common(sequence),
        eventType: 'storage.gap.recorded',
        payload: {
            outageStartedAt: common(sequence).occurredAt,
            outageEndedAt: common(sequence).occurredAt,
            failureReason: 'unavailable',
            boundaryBasis: 'same_process_first_degraded_at',
            observationsBackfilled: false,
        },
    };
}
