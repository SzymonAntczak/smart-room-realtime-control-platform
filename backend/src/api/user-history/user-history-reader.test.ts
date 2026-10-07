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

import type { RoomHistoryReadResult } from '../../platform/history/room-history-reader';

import { createUserHistoryCursorCodec } from './user-history-cursor';
import { createUserHistoryReader } from './user-history-reader';

type RawRead = (query: SignificantFactPageQuery) => RoomHistoryReadResult<SignificantFactPage>;

describe('pinned user history reader', () => {
    it('derives failures and gaps only from durable facts, omitting device state and command progress', () => {
        const facts: DurableSignificantFactProjection[] = [
            {
                ...common(1),
                deviceId: 'led-main',
                eventType: 'device.state.reported',
                payload: { reportedState: { power: 'on' } },
            },
            {
                ...common(2),
                deviceId: 'led-main',
                eventType: 'device.availability.changed',
                payload: {
                    previousAvailability: 'online',
                    availability: 'offline',
                    reason: 'disconnect',
                },
            },
            {
                ...common(3),
                deviceId: 'led-main',
                eventType: 'device.health.changed',
                payload: { previousHealth: 'healthy', health: 'degraded', reason: 'fault' },
            },
            request(4),
            {
                ...common(5),
                deviceId: 'led-main',
                commandId: 'cmd',
                eventType: 'command.dispatched',
                payload: { commandType: 'set.power', target: 'simulator-adapter' },
            },
            {
                ...common(6),
                deviceId: 'led-main',
                commandId: 'cmd',
                eventType: 'command.delivery_uncertain',
                payload: {
                    commandType: 'set.power',
                    target: 'simulator-adapter',
                    reason: 'uncertain',
                },
            },
            {
                ...common(7),
                deviceId: 'led-main',
                commandId: 'cmd',
                eventType: 'command.confirmed',
                payload: { sourceEventId: 'event', confirmedAt: common(7).occurredAt },
            },
            failure(8),
            {
                ...failure(9),
                payload: {
                    reason: 'rejected',
                    message: 'Rejected attempt',
                    commandType: 'set.power',
                    requestedState: { power: 'off' },
                },
            },
            gap(10),
            { ...failure(11), deviceId: 'removed-device' },
        ];
        const harness = createHarness(facts);
        const page = available(harness.reader.readPage({ pageSize: 20 }));
        expect(page.items).toEqual([
            {
                ...identity(10),
                source: 'backend',
                kind: 'history_gap',
                outageStartedAt: common(10).occurredAt,
                outageEndedAt: common(10).occurredAt,
            },
            {
                ...identity(9),
                kind: 'attempt_failed',
                deviceId: 'led-main',
                deviceName: 'Main LED',
                requestedPower: 'off',
            },
            {
                ...identity(8),
                kind: 'attempt_failed',
                deviceId: 'led-main',
                deviceName: 'Main LED',
            },
        ]);
        expect(harness.raw).toHaveBeenCalledTimes(1);
    });

    it('looks through older pages for timeout evidence without consuming those entries in pagination', () => {
        const harness = createHarness([request(1), gap(2), failure(3), timeout(4)]);
        const first = available(harness.reader.readPage({ pageSize: 1 }));
        expect(first.items).toEqual([
            {
                ...identity(4),
                kind: 'confirmation_missing',
                deviceId: 'led-main',
                deviceName: 'Main LED',
                requestedPower: 'on',
            },
        ]);
        expect(harness.raw.mock.calls.map(([query]) => query)).toEqual([
            { pageSize: 1 },
            { pageSize: 1, cursor: 'raw:1' },
            { pageSize: 1, cursor: 'raw:2' },
            { pageSize: 1, cursor: 'raw:3' },
        ]);
        const second = available(
            harness.reader.readPage({ pageSize: 1, cursor: continuation(first) }),
        );
        expect(second.items[0]?.recordId).toBe(failure(3).recordId);
        expect(harness.raw).toHaveBeenLastCalledWith({ pageSize: 1, cursor: 'raw:1' });
    });

    it('returns empty pages with a continuation and recognizes timeout evidence on the same page', () => {
        const harness = createHarness([
            request(1),
            timeout(2),
            {
                ...common(3),
                deviceId: 'led-main',
                eventType: 'device.state.reported',
                payload: { reportedState: { power: 'on' } },
            },
        ]);
        const empty = available(harness.reader.readPage({ pageSize: 1 }));
        expect(empty.items).toEqual([]);
        expect(empty.nextCursor).not.toBeNull();
        expect(harness.raw).toHaveBeenCalledTimes(1);
        const timeoutPage = available(
            harness.reader.readPage({ pageSize: 1, cursor: continuation(empty) }),
        );
        expect(timeoutPage.items.map((item) => item.kind)).toEqual(['confirmation_missing']);
        const onePage = createHarness([request(1), timeout(2)]);
        expect(
            available(onePage.reader.readPage({ pageSize: 2 })).items.map((item) => item.kind),
        ).toEqual(['confirmation_missing']);
        expect(onePage.raw).toHaveBeenCalledTimes(1);
    });

    it('applies device and half-open event-time filters after transforming the main raw page', () => {
        const harness = createHarness([gap(1), failure(2), failure(3), failure(4)]);
        const from = common(2).occurredAt;
        const to = common(4).occurredAt;

        expect(
            available(
                harness.reader.readPage({ pageSize: 10, deviceId: 'led-main', from, to }),
            ).items.map((item) => item.recordId),
        ).toEqual([failure(3).recordId, failure(2).recordId]);
        expect(
            available(harness.reader.readPage({ pageSize: 10, from: common(3).occurredAt })).items,
        ).toEqual([
            expect.objectContaining({ recordId: failure(4).recordId }),
            expect.objectContaining({ recordId: failure(3).recordId }),
        ]);
        expect(
            available(
                harness.reader.readPage({ pageSize: 10, to: common(3).occurredAt }),
            ).items.map((item) => item.recordId),
        ).toEqual([failure(2).recordId, gap(1).recordId]);
        expect(
            available(harness.reader.readPage({ pageSize: 10, deviceId: 'missing-device' })).items,
        ).toEqual([]);
        expect(
            available(harness.reader.readPage({ pageSize: 10, deviceId: 'led-main' })).items.every(
                (item) => 'deviceId' in item && item.deviceId === 'led-main',
            ),
        ).toBe(true);
    });

    it('binds continuations to normalized filters and keeps timeout evidence outside the date range', () => {
        const harness = createHarness([request(1), failure(2), timeout(3)]);
        const from = common(3).occurredAt;
        const first = available(
            harness.reader.readPage({ pageSize: 1, deviceId: 'led-main', from }),
        );
        expect(first.items).toMatchObject([
            { recordId: timeout(3).recordId, kind: 'confirmation_missing', requestedPower: 'on' },
        ]);
        expect(harness.raw).toHaveBeenCalledWith({ pageSize: 1, cursor: 'raw:1' });

        const conflicting = createHarness([request(1, 'off'), request(2, 'on'), timeout(3)]);
        expect(
            available(
                conflicting.reader.readPage({
                    pageSize: 1,
                    deviceId: 'led-main',
                    from: common(3).occurredAt,
                }),
            ).items,
        ).toEqual([]);
        expect(conflicting.raw).toHaveBeenCalledTimes(3);

        const equivalent = available(
            harness.reader.readPage({
                pageSize: 1,
                cursor: continuation(first),
                deviceId: 'led-main',
                from: '2026-09-10T10:00:03+01:00',
            }),
        );
        expect(equivalent.items).toEqual([]);
        expect(equivalent.nextCursor).not.toBeNull();
        const exhausted = available(
            harness.reader.readPage({
                pageSize: 1,
                cursor: continuation(equivalent),
                deviceId: 'led-main',
                from: '2026-09-10T10:00:03+01:00',
            }),
        );
        expect(exhausted.items).toEqual([]);
        expect(exhausted.nextCursor).toBeNull();

        for (const changed of [
            { pageSize: 1, cursor: continuation(first), deviceId: 'other-device', from },
            { pageSize: 1, cursor: continuation(first), deviceId: 'led-main' },
            { pageSize: 2, cursor: continuation(first), deviceId: 'led-main', from },
        ]) {
            expect(harness.reader.readPage(changed)).toMatchObject({
                status: 'cursor_error',
                error: { error: 'cursor_query_mismatch' },
            });
        }
    });

    it('preserves empty intermediate pages when the selected device has no entry on a raw page', () => {
        const harness = createHarness([failure(1), gap(2), gap(3)]);
        const first = available(harness.reader.readPage({ pageSize: 1, deviceId: 'led-main' }));
        expect(first.items).toEqual([]);
        expect(first.nextCursor).not.toBeNull();
        const second = available(
            harness.reader.readPage({
                pageSize: 1,
                cursor: continuation(first),
                deviceId: 'led-main',
            }),
        );
        expect(second.items).toEqual([]);
        expect(second.nextCursor).not.toBeNull();
        const third = available(
            harness.reader.readPage({
                pageSize: 1,
                cursor: continuation(second),
                deviceId: 'led-main',
            }),
        );
        expect(third.items.map((item) => item.recordId)).toEqual([failure(1).recordId]);
        expect(third.nextCursor).toBeNull();
    });

    it.each(['missing', 'conflicting', 'wrong-device', 'wrong-command'] as const)(
        'omits timeout when retained request evidence is %s',
        (kind) => {
            const requests =
                kind === 'missing'
                    ? []
                    : kind === 'conflicting'
                      ? [request(1, 'on'), request(2, 'off')]
                      : [
                            {
                                ...request(1),
                                ...(kind === 'wrong-device'
                                    ? { deviceId: 'other-device' }
                                    : { commandId: 'other-command' }),
                            },
                        ];
            const harness = createHarness([...requests, timeout(3)]);
            expect(available(harness.reader.readPage({ pageSize: 1 })).items).toEqual([]);
        },
    );

    it('detects conflicting evidence after finding a target and permits repeated consistent targets', () => {
        const conflict = createHarness([request(1, 'off'), request(2, 'on'), timeout(3)]);
        expect(available(conflict.reader.readPage({ pageSize: 1 })).items).toEqual([]);
        expect(conflict.raw).toHaveBeenCalledTimes(3);
        const consistent = createHarness([request(1), request(2), timeout(3)]);
        expect(available(consistent.reader.readPage({ pageSize: 1 })).items[0]).toMatchObject({
            kind: 'confirmation_missing',
            requestedPower: 'on',
        });
    });

    it('preserves storage order for equal timestamps instead of sorting by record ID', () => {
        const lower = { ...failure(1), recordId: `rec:v1:sha256:${'f'.repeat(64)}` };
        const upper = { ...failure(2), occurredAt: lower.occurredAt };
        const harness = createHarness([lower, upper]);
        expect(
            available(harness.reader.readPage({ pageSize: 2 })).items.map((item) => item.recordId),
        ).toEqual([upper.recordId, lower.recordId]);
    });

    it.each([
        { status: 'unavailable', failure: 'confirmed_rolled_back' },
        { status: 'invalid_internal_data' },
        { status: 'cursor_error', error: { error: 'cursor_expired', message: 'Expired.' } },
        {
            status: 'cursor_error',
            error: { error: 'history_generation_changed', message: 'Changed.' },
        },
    ] satisfies RoomHistoryReadResult<SignificantFactPage>[])(
        'propagates auxiliary failure $status without returning partial entries',
        (failureResult) => {
            const harness = createHarness([request(1), gap(2), timeout(3)]);
            harness.raw.mockReturnValueOnce(harness.page(0, 2)).mockReturnValueOnce(failureResult);
            expect(harness.reader.readPage({ pageSize: 2 })).toEqual(failureResult);
        },
    );

    it.each(['generation', 'watermark', 'retention', 'size', 'order', 'payload'] as const)(
        'rejects invalid auxiliary %s page evidence',
        (fault) => {
            const harness = createHarness([request(1), timeout(2)]);
            const main = harness.page(0, 1);
            const auxiliary = harness.page(1, 1);

            if (auxiliary.status !== 'available') {
                throw new Error('Expected raw page.');
            }

            const valid = auxiliary.value;
            const broken =
                fault === 'generation'
                    ? { ...valid, historyGenerationId: 'changed' }
                    : fault === 'watermark'
                      ? { ...valid, throughSequence: 3 }
                      : fault === 'retention'
                        ? { ...valid, retentionAsOf: '2026-09-10T11:00:00.000Z' }
                        : fault === 'size'
                          ? { ...valid, pageSize: 2 }
                          : fault === 'order'
                            ? { ...valid, items: [timeout(2)] }
                            : { ...valid, items: [{ ...request(1), payload: { invalid: true } }] };
            // Simulates an adapter violating its declared port; the reader must validate it.
            harness.raw
                .mockReturnValueOnce(main)
                .mockReturnValueOnce({ status: 'available', value: broken as SignificantFactPage });
            expect(harness.reader.readPage({ pageSize: 1 })).toEqual({
                status: 'invalid_internal_data',
            });
        },
    );

    it('rejects invalid main pages and snapshots before classifying history entries', () => {
        const harness = createHarness([failure(1)]);
        const invalid = {
            status: 'available',
            value: { ...rawPage([failure(1)], 1), pageSize: 2 },
        } as const;
        harness.raw.mockReturnValueOnce(invalid);
        expect(harness.reader.readPage({ pageSize: 1 })).toEqual({
            status: 'invalid_internal_data',
        });
        const reader = createUserHistoryReader({
            readSignificantFactPage: harness.raw,
            getRoomSnapshot: () =>
                ({
                    ...snapshot(),
                    devices: [],
                    activeCommands: [{ invalid: true }],
                }) as unknown as ReturnType<typeof snapshot>,
        });
        expect(reader.readPage({ pageSize: 1 })).toEqual({ status: 'invalid_internal_data' });
    });

    it('scans the maximum retained evidence with bounded reads and emits only the requested page', () => {
        const facts = Array.from({ length: 4998 }, (_, index) => gap(index + 2));
        const harness = createHarness([request(1), ...facts, timeout(5000)]);
        const page = available(harness.reader.readPage({ pageSize: 50 }));
        expect(page.items).toHaveLength(50);
        expect(page.items[0]).toMatchObject({
            recordId: timeout(5000).recordId,
            kind: 'confirmation_missing',
        });
        expect(harness.raw).toHaveBeenCalledTimes(100);
    });
});

function snapshot() {
    const projection = createUserHistoryFixtures().snapshot;
    const value = {
        roomName: projection.roomName,
        updatedAt: projection.updatedAt,
        devices: projection.devices,
        activeCommands: projection.activeCommands,
        recentCommands: projection.recentCommands,
        platform: projection.platform,
        recentEvents: [],
    };

    if (!isRoomSnapshotProjection(value)) {
        throw new Error('Invalid room fixture.');
    }

    return value;
}

function createHarness(facts: DurableSignificantFactProjection[]) {
    const ordered = [...facts].sort(
        (left, right) =>
            Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
            right.storageSequence - left.storageSequence,
    );

    const page = (offset: number, pageSize: number): RoomHistoryReadResult<SignificantFactPage> => {
        const value = rawPage(
            ordered.slice(offset, offset + pageSize),
            pageSize,
            offset + pageSize < ordered.length ? `raw:${offset + pageSize}` : null,
        );
        value.throughSequence = Math.max(0, ...facts.map((fact) => fact.storageSequence));

        if (!isSignificantFactPage(value)) {
            throw new Error('Invalid raw fixture.');
        }

        return { status: 'available', value };
    };

    const raw = vi.fn<RawRead>((query) =>
        page(query.cursor === undefined ? 0 : Number(query.cursor.slice(4)), query.pageSize),
    );
    const reader = createUserHistoryReader({
        readSignificantFactPage: raw,
        getRoomSnapshot: snapshot,
        cursorCodec: createUserHistoryCursorCodec({ secret: Buffer.alloc(32, 2) }),
    });

    return { reader, raw, page };
}

function rawPage(
    items: DurableSignificantFactProjection[],
    pageSize: number,
    nextCursor: string | null = null,
): SignificantFactPage {
    return {
        items,
        pageSize,
        nextCursor,
        historyGenerationId: 'generation',
        throughSequence: Math.max(0, ...items.map((fact) => fact.storageSequence)),
        retentionAsOf: '2026-09-10T12:00:00.000Z',
    };
}

function available(result: RoomHistoryReadResult<UserHistoryPage>): UserHistoryPage {
    expect(result.status).toBe('available');

    if (result.status !== 'available' || !isUserHistoryPage(result.value)) {
        throw new Error('Expected validated page.');
    }

    return result.value;
}

function continuation(page: UserHistoryPage): string {
    if (page.nextCursor === null) {
        throw new Error('Expected cursor.');
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

function identity(sequence: number) {
    return common(sequence);
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
