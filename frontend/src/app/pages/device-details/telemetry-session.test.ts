import { isRawTelemetryPage, type RawTelemetryPage } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import type { TelemetryHistoryClient } from '../../api/history';

import { createTelemetrySession } from './telemetry-session';

const instant = Date.parse('2026-09-11T00:00:00.000Z');

function page(
    firstSequence: number,
    count: number,
    nextCursor: string | null = null,
): RawTelemetryPage {
    const fixture = createHistoryIdentityFixtures();
    const result = {
        ...fixture.rawTelemetryPage,
        pageSize: 100,
        throughSequence: 1000,
        items: Array.from({ length: count }, (_, index) => {
            const storageSequence = firstSequence - index;

            return {
                ...fixture.telemetrySample,
                storageSequence,
                recordId: `rec:v1:sha256:${storageSequence.toString(16).padStart(64, '0')}`,
            };
        }),
        nextCursor,
    };
    expect(isRawTelemetryPage(result)).toBe(true);

    return result;
}

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    const promise = new Promise<T>((complete) => {
        resolve = complete;
    });

    return { promise, resolve };
}

type Result = Awaited<ReturnType<TelemetryHistoryClient['readPage']>>;

describe('bounded telemetry baseline', () => {
    it.each([0, 1, 100])('finishes a terminal page containing %s samples', async (count) => {
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValue({ kind: 'page', page: page(300, count) });
        const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
        await session.start();
        expect(readPage).toHaveBeenCalledOnce();
        expect(session.getState()).toMatchObject({
            status: 'ready',
            limitReached: false,
            error: null,
        });
        expect(session.getState().samples).toHaveLength(count);
        expect(session.getState().range).toEqual({
            from: '2026-08-12T00:00:00.000Z',
            to: '2026-09-11T00:00:00.000Z',
        });
    });

    it('keeps only the newest 200 samples and never requests a third page', async () => {
        const first = deferred<Result>();
        const second = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
        const loading = session.start();
        void session.start();
        expect(readPage).toHaveBeenCalledOnce();
        first.resolve({ kind: 'page', page: page(300, 100, 'second') });
        await vi.waitFor(() => expect(readPage).toHaveBeenCalledTimes(2));
        expect(session.getState()).toMatchObject({ status: 'loading' });
        expect(session.getState().samples).toHaveLength(100);
        second.resolve({ kind: 'page', page: page(200, 100, 'third') });
        await loading;
        expect(session.getState()).toMatchObject({ status: 'ready', limitReached: true });
        expect(session.getState().samples).toHaveLength(200);
        expect(readPage).toHaveBeenCalledTimes(2);
        const firstQuery = readPage.mock.calls[0]?.[0];
        expect(firstQuery).toMatchObject({
            deviceId: 'temp-desk',
            metric: 'temperature',
            pageSize: 100,
        });
        expect(readPage.mock.calls[1]?.[0]).toEqual({ ...firstQuery, cursor: 'second' });
        expect(session.getState().samples.map((sample) => sample.storageSequence)).toEqual(
            Array.from({ length: 200 }, (_, i) => 101 + i),
        );
    });

    it.each(['historyGenerationId', 'throughSequence', 'retentionAsOf', 'pageSize'] as const)(
        'rejects continuation with a different %s',
        async (field) => {
            const changed = {
                ...page(200, 1),
                [field]:
                    field === 'throughSequence'
                        ? 999
                        : field === 'pageSize'
                          ? 50
                          : field === 'retentionAsOf'
                            ? '2026-09-10T10:02:00.000Z'
                            : 'replacement',
            };
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') })
                .mockResolvedValueOnce({ kind: 'page', page: changed });
            const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
            await session.start();
            expect(session.getState()).toMatchObject({
                status: 'error',
                error: 'invalid_response',
                lastKnown: true,
            });
            expect(session.getState().samples).toHaveLength(100);
        },
    );

    it.each(['identity', 'sequence', 'order', 'cursor'] as const)(
        'rejects cross-page %s violations',
        async (violation) => {
            const first = page(300, 100, 'second');
            const next = page(
                200,
                violation === 'cursor' ? 100 : 1,
                violation === 'cursor' ? 'second' : null,
            );
            const duplicate = first.items[0];
            const sample = next.items[0];

            if (!duplicate || !sample) {
                throw new Error('Missing fixture');
            }

            if (violation === 'identity') {
                next.items = [{ ...sample, recordId: duplicate.recordId }];
            }

            if (violation === 'sequence') {
                next.items = [
                    {
                        ...sample,
                        storageSequence: duplicate.storageSequence,
                        occurredAt: '2026-09-10T09:00:00.000Z',
                    },
                ];
            }

            if (violation === 'order') {
                next.items = [{ ...sample, occurredAt: '2026-09-10T11:00:00.000Z' }];
            }

            expect(isRawTelemetryPage(next)).toBe(true);
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockResolvedValueOnce({ kind: 'page', page: first })
                .mockResolvedValueOnce({ kind: 'page', page: next });
            const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
            await session.start();
            expect(session.getState()).toMatchObject({
                status: 'error',
                error: 'invalid_response',
            });
            expect(session.getState().samples).toHaveLength(100);
        },
    );

    it.each(['cursor_expired', 'invalid_cursor', 'history_generation_changed'] as const)(
        'restarts %s once with unchanged range and replaces the old baseline',
        async (error) => {
            const replacement = { ...page(500, 1), historyGenerationId: 'new-generation' };
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') })
                .mockResolvedValueOnce({
                    kind: 'cursor_error',
                    error: { error, message: 'Restart required' },
                })
                .mockResolvedValueOnce({ kind: 'page', page: replacement });
            const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
            await session.start();
            expect(readPage.mock.calls[2]?.[0]).toEqual(readPage.mock.calls[0]?.[0]);
            expect(session.getState()).toMatchObject({
                status: 'ready',
                samples: replacement.items,
                pin: { historyGenerationId: 'new-generation' },
            });
        },
    );

    it('stops after a repeated cursor failure and never restarts a query mismatch', async () => {
        for (const error of ['cursor_expired', 'cursor_query_mismatch'] as const) {
            const readPage = vi.fn<TelemetryHistoryClient['readPage']>().mockResolvedValue({
                kind: 'cursor_error',
                error: { error, message: 'Bad cursor' },
            });
            const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
            await session.start();
            expect(readPage).toHaveBeenCalledTimes(error === 'cursor_expired' ? 2 : 1);
            expect(session.getState()).toMatchObject({ status: 'error', error: 'cursor_error' });
        }
    });

    it.each(['unavailable', 'invalid_response', 'request_failed'] as const)(
        'retains a partial baseline on %s without automatically retrying',
        async (error) => {
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') });

            if (error === 'request_failed') {
                readPage.mockRejectedValueOnce(new TypeError('Network'));
            } else if (error === 'unavailable') {
                readPage.mockResolvedValueOnce({
                    kind: error,
                    error: { error: 'durable_history_unavailable', message: 'Unavailable' },
                });
            } else {
                readPage.mockResolvedValueOnce({ kind: error });
            }

            const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
            await session.start();
            expect(readPage).toHaveBeenCalledTimes(2);
            expect(session.getState()).toMatchObject({ status: 'error', error, lastKnown: true });
            expect(session.getState().samples).toHaveLength(100);
        },
    );

    it('starts manual retries with a fresh range without accumulating old samples', async () => {
        let time = instant;
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockImplementation(async (query) => ({
                kind: 'page',
                page: query.cursor ? page(200, 100, 'third') : page(300, 100, 'second'),
            }));
        const session = createTelemetrySession('temp-desk', { readPage }, () => time);

        for (let attempt = 0; attempt < 10; attempt += 1) {
            await session.start();
            expect(session.getState().samples).toHaveLength(200);
            expect(session.getState().range?.to).toBe(new Date(time).toISOString());
            time += 1000;
        }

        expect(readPage).toHaveBeenCalledTimes(20);
    });

    it('cancels and releases a closed session and ignores a transport that resolves after abort', async () => {
        const pending = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockReturnValue(pending.promise);
        const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
        const listener = vi.fn();
        session.subscribe(listener);
        const loading = session.start();
        session.close();
        const calls = listener.mock.calls.length;
        expect(readPage.mock.calls[0]?.[1]?.aborted).toBe(true);
        pending.resolve({ kind: 'page', page: page(300, 100, 'second') });
        await loading;
        await session.start();
        expect(listener).toHaveBeenCalledTimes(calls);
        expect(session.getState()).toMatchObject({
            status: 'closed',
            samples: [],
            pin: null,
            range: null,
        });
        expect(readPage).toHaveBeenCalledOnce();
    });
});
