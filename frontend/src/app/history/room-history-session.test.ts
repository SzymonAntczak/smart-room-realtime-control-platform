import type {
    DurableSignificantFactProjection,
    RecentEventProjection,
    SignificantFactPage,
} from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import { createRoomHistorySession } from './room-history-session';

const fixtures = createHistoryIdentityFixtures();
const storage = {
    status: 'available' as const,
    changedAt: '2026-09-10T10:00:00.000Z',
    historyGenerationId: fixtures.significantFactPage.historyGenerationId,
    storedThroughSequence: fixtures.significantFactPage.throughSequence,
};

function fact(digit: string): DurableSignificantFactProjection {
    if (fixtures.recentEvent.durability !== 'durable') {
        throw new Error('Fixture must contain a durable fact.');
    }

    return { ...fixtures.recentEvent, recordId: `rec:v1:sha256:${digit.repeat(64)}` };
}

function page(
    items: DurableSignificantFactProjection[],
    nextCursor: string | null,
): SignificantFactPage {
    return { ...fixtures.significantFactPage, pageSize: 1, items, nextCursor };
}

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

function deferredResponse(): { promise: Promise<Response>; resolve(value: Response): void } {
    let resolve: (value: Response) => void = () => {
        throw new Error('Deferred response was not initialized.');
    };

    const promise = new Promise<Response>((complete) => {
        resolve = complete;
    });

    return { promise, resolve: (value) => resolve(value) };
}

describe('room history session', () => {
    it('retains additions before, during and between HTTP pages', async () => {
        const first = deferredResponse();
        const second = deferredResponse();
        const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const session = createRoomHistorySession(
            { kind: 'significant-facts', pageSize: 1 },
            read as typeof fetch,
        );

        session.acceptRealtime({ kind: 'baseline', storage, recentEvents: [] });
        session.acceptRealtime({ kind: 'addition', storage, recentEvents: [fact('b')] });
        const firstLoad = session.loadFirstPage();
        expect(session.getState().items.map((item) => item.recordId)).toContain(fact('b').recordId);
        session.acceptRealtime({ kind: 'addition', storage, recentEvents: [fact('c')] });
        first.resolve(response(page([fact('a')], 'second-page')));
        await firstLoad;
        expect(session.getState().complete).toBe(false);

        session.acceptRealtime({ kind: 'addition', storage, recentEvents: [fact('d')] });
        const secondLoad = session.loadNextPage();
        session.acceptRealtime({ kind: 'addition', storage, recentEvents: [fact('e')] });
        second.resolve(response(page([fact('9')], null)));
        await secondLoad;

        expect(session.getState().status).toBe('ready');
        expect(session.getState().complete).toBe(true);
        expect(session.getState().items.map((item) => item.recordId)).toEqual(
            ['e', 'd', 'c', 'b', 'a', '9'].map((digit) => fact(digit).recordId),
        );
        expect(read.mock.calls[1]?.[0]).toContain('cursor=second-page');
    });

    it('collapses HTTP and SSE identity while retaining above-bound and volatile additions', async () => {
        const read = vi.fn().mockResolvedValue(response(page([fact('a')], null)));
        const session = createRoomHistorySession(
            { kind: 'significant-facts', pageSize: 1 },
            read as typeof fetch,
        );
        session.acceptRealtime({ kind: 'baseline', storage, recentEvents: [] });
        const { storageSequence, ...withoutSequence } = fact('a');
        void storageSequence;
        const volatile: RecentEventProjection = { ...withoutSequence, durability: 'volatile' };
        const separateVolatile: RecentEventProjection = {
            ...volatile,
            recordId: fact('c').recordId,
        };
        const aboveBound = { ...fact('b'), storageSequence: 9 };
        session.acceptRealtime({
            kind: 'addition',
            storage,
            recentEvents: [volatile, separateVolatile, aboveBound],
        });

        await session.loadFirstPage();

        expect(session.getState().items).toHaveLength(3);
        expect(
            session.getState().items.find((item) => item.recordId === fact('a').recordId)
                ?.durability,
        ).toBe('durable');
        expect(session.getState().throughSequence).toBe(
            fixtures.significantFactPage.throughSequence,
        );
        expect(aboveBound.storageSequence).toBeGreaterThan(
            fixtures.significantFactPage.throughSequence,
        );
        expect(session.getState().items).toContainEqual(aboveBound);
        expect('storageSequence' in separateVolatile).toBe(false);
        expect(session.getState().items).toContainEqual(separateVolatile);
    });

    it('bounds telemetry additions to 100 and filters another device and out-of-range time', () => {
        const session = createRoomHistorySession({
            kind: 'telemetry',
            deviceId: 'temp-desk',
            metric: 'temperature',
            from: '2026-09-10T09:55:00.000Z',
            to: '2026-09-10T10:05:00.000Z',
        });
        session.acceptRealtime({ kind: 'baseline', storage, recentEvents: [] });

        for (let index = 0; index < 101; index += 1) {
            session.acceptRealtime({
                kind: 'addition',
                storage,
                telemetrySample: {
                    ...fixtures.telemetrySample,
                    recordId: `rec:v1:sha256:${index.toString(16).padStart(64, '0')}`,
                },
            });
        }

        session.acceptRealtime({
            kind: 'addition',
            storage,
            telemetrySample: { ...fixtures.telemetrySample, deviceId: 'temp-window' },
        });
        session.acceptRealtime({
            kind: 'addition',
            storage,
            telemetrySample: {
                ...fixtures.telemetrySample,
                occurredAt: '2026-09-10T10:05:00.000Z',
            },
        });

        expect(session.getState().items).toHaveLength(100);
        expect(
            session.getState().items.some((item) => item.recordId.endsWith('0'.repeat(64))),
        ).toBe(false);
    });

    it('bounds the significant-fact overlay to the newest 20 records', () => {
        const session = createRoomHistorySession({ kind: 'significant-facts' });
        session.acceptRealtime({ kind: 'baseline', storage, recentEvents: [] });

        for (let index = 0; index < 21; index += 1) {
            const digit = index.toString(16).padStart(2, '0');
            session.acceptRealtime({
                kind: 'addition',
                storage,
                recentEvents: [{ ...fact('a'), recordId: `rec:v1:sha256:${digit.repeat(32)}` }],
            });
        }

        expect(session.getState().items).toHaveLength(20);
        expect(
            session.getState().items.some((item) => item.recordId.endsWith('00'.repeat(32))),
        ).toBe(false);
    });

    it('reads a validated telemetry page and merges its matching live sample', async () => {
        const read = vi.fn().mockResolvedValue(response(fixtures.rawTelemetryPage));
        const session = createRoomHistorySession(
            {
                kind: 'telemetry',
                deviceId: 'temp-desk',
                metric: 'temperature',
                from: '2026-09-10T09:55:00.000Z',
                to: '2026-09-10T10:05:00.000Z',
                pageSize: 1,
            },
            read as typeof fetch,
        );
        session.acceptRealtime({ kind: 'baseline', storage, recentEvents: [] });
        session.acceptRealtime({
            kind: 'addition',
            storage,
            telemetrySample: fixtures.telemetrySample,
        });

        await session.loadFirstPage();

        expect(session.getState()).toMatchObject({ status: 'ready', complete: true });
        expect(session.getState().items).toEqual([fixtures.telemetrySample]);
        expect(read.mock.calls[0]?.[0]).toContain('/room/history/telemetry?');
        expect(read.mock.calls[0]?.[0]).toContain('deviceId=temp-desk');
    });

    it('rejects a page from another generation without claiming completeness', async () => {
        const read = vi
            .fn()
            .mockResolvedValue(
                response({ ...page([fact('a')], null), historyGenerationId: 'replacement' }),
            );
        const session = createRoomHistorySession(
            { kind: 'significant-facts', pageSize: 1 },
            read as typeof fetch,
        );
        session.acceptRealtime({ kind: 'baseline', storage, recentEvents: [] });

        await session.loadFirstPage();

        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'generation_changed',
            complete: false,
        });
    });

    it('preserves live additions but does not mark a 503 history read complete', async () => {
        const read = vi
            .fn()
            .mockResolvedValue(response({ error: 'durable_history_unavailable' }, 503));
        const session = createRoomHistorySession(
            { kind: 'significant-facts', pageSize: 1 },
            read as typeof fetch,
        );
        session.acceptRealtime({ kind: 'baseline', storage, recentEvents: [fact('b')] });

        await session.loadFirstPage();
        session.acceptRealtime({ kind: 'addition', storage, recentEvents: [fact('c')] });

        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'history_unavailable',
            complete: false,
        });
        expect(session.getState().items.map((item) => item.recordId)).toEqual([
            fact('c').recordId,
            fact('b').recordId,
        ]);
    });
});
