import {
    isRawTelemetryPage,
    type LiveTelemetrySampleProjection,
    liveTelemetrySampleProjectionSchema,
    type RawTelemetryPage,
} from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { platformStorageProjectionSchema } from '@smart-room/contracts/projections';
import { isSchema } from '@smart-room/contracts/validation';
import { describe, expect, it, vi } from 'vitest';

import type { TelemetryHistoryClient } from '../../api/history';
import type { HistoryLiveUpdate } from '../../features/history';

import { createTelemetrySession } from './telemetry-session';

const instant = Date.parse('2026-09-11T00:00:00.000Z');

function realtimeBaseline(
    historyGenerationId = createHistoryIdentityFixtures().rawTelemetryPage.historyGenerationId,
): Extract<HistoryLiveUpdate, { kind: 'baseline' }> {
    const update = {
        kind: 'baseline',
        history: [],
        storage: {
            status: 'available',
            changedAt: new Date(instant).toISOString(),
            historyGenerationId,
            storedThroughSequence: 1000,
        },
    } as const;
    expect(isSchema(platformStorageProjectionSchema, update.storage)).toBe(true);

    return update;
}

function degradedStorage() {
    const storage = {
        status: 'degraded',
        changedAt: new Date(instant).toISOString(),
        reason: 'storage_unavailable',
        historyGenerationId: null,
        storedThroughSequence: null,
    } as const;
    expect(isSchema(platformStorageProjectionSchema, storage)).toBe(true);

    return storage;
}

function createSession(...args: Parameters<typeof createTelemetrySession>) {
    const session = createTelemetrySession(...args);
    session.acceptRealtime(realtimeBaseline());

    return session;
}

function live(
    sequence: number,
    durability: 'durable' | 'volatile' = 'durable',
    occurredAt = '2026-09-10T10:00:00.000Z',
): LiveTelemetrySampleProjection {
    const sample = {
        ...createHistoryIdentityFixtures().telemetrySample,
        recordId: `rec:v1:sha256:${sequence.toString(16).padStart(64, '0')}`,
        occurredAt,
        storageSequence: sequence,
    };

    return durability === 'durable'
        ? sample
        : {
              recordId: sample.recordId,
              deviceId: sample.deviceId,
              metric: sample.metric,
              value: sample.value,
              unit: sample.unit,
              occurredAt,
              durability,
          };
}

function addition(telemetrySample?: LiveTelemetrySampleProjection): HistoryLiveUpdate {
    if (telemetrySample) {
        expect(isSchema(liveTelemetrySampleProjectionSchema, telemetrySample)).toBe(true);
    }

    return { kind: 'addition', storage: realtimeBaseline().storage, telemetrySample };
}

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
        const session = createSession('temp-desk', { readPage }, () => instant);
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
        const session = createSession('temp-desk', { readPage }, () => instant);
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
        expect(
            session
                .getState()
                .samples.map((sample) =>
                    sample.durability === 'durable' ? sample.storageSequence : null,
                ),
        ).toEqual(Array.from({ length: 200 }, (_, i) => 101 + i));
    });

    it.each(['throughSequence', 'retentionAsOf', 'pageSize'] as const)(
        'rejects continuation with a different %s',
        async (field) => {
            const changed = {
                ...page(200, 1),
                [field]:
                    field === 'throughSequence'
                        ? 999
                        : field === 'pageSize'
                          ? 50
                          : '2026-09-10T10:02:00.000Z',
            };
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') })
                .mockResolvedValueOnce({ kind: 'page', page: changed });
            const session = createSession('temp-desk', { readPage }, () => instant);
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
            const session = createSession('temp-desk', { readPage }, () => instant);
            await session.start();
            expect(session.getState()).toMatchObject({
                status: 'error',
                error: 'invalid_response',
            });
            expect(session.getState().samples).toHaveLength(100);
        },
    );

    it.each(['cursor_expired', 'invalid_cursor'] as const)(
        'restarts %s once with unchanged range and replaces the old baseline',
        async (error) => {
            const replacement = page(500, 1);
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') })
                .mockResolvedValueOnce({
                    kind: 'cursor_error',
                    error: { error, message: 'Restart required' },
                })
                .mockResolvedValueOnce({ kind: 'page', page: replacement });
            const session = createSession('temp-desk', { readPage }, () => instant);
            await session.start();
            expect(readPage.mock.calls[2]?.[0]).toEqual(readPage.mock.calls[0]?.[0]);
            expect(session.getState()).toMatchObject({
                status: 'ready',
                samples: replacement.items,
                pin: { historyGenerationId: replacement.historyGenerationId },
            });
        },
    );

    it('stops after a repeated cursor failure and never restarts a query mismatch', async () => {
        for (const error of ['cursor_expired', 'cursor_query_mismatch'] as const) {
            const readPage = vi.fn<TelemetryHistoryClient['readPage']>().mockResolvedValue({
                kind: 'cursor_error',
                error: { error, message: 'Bad cursor' },
            });
            const session = createSession('temp-desk', { readPage }, () => instant);
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

            const session = createSession('temp-desk', { readPage }, () => instant);
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
        const session = createSession('temp-desk', { readPage }, () => time);

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
        const session = createSession('temp-desk', { readPage }, () => instant);
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

describe('live telemetry merge and recovery', () => {
    it('waits for a room baseline before making the first HTTP read', async () => {
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValue({ kind: 'page', page: page(300, 1) });
        const session = createTelemetrySession('temp-desk', { readPage }, () => instant);
        await session.start();
        expect(readPage).not.toHaveBeenCalled();
        expect(session.getState().status).toBe('waiting_for_baseline');
        session.acceptRealtime(realtimeBaseline());
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(readPage).toHaveBeenCalledOnce();
    });

    it('merges additions before, between and after HTTP pages without confusing live overlap with invalid pagination', async () => {
        const first = deferred<Result>();
        const second = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const session = createSession('temp-desk', { readPage }, () => instant);
        const loading = session.start();
        session.acceptRealtime(addition(live(300)));
        session.acceptRealtime(addition(live(1001)));
        session.acceptRealtime(addition(live(50, 'volatile', '2026-07-01T00:00:00.000Z')));
        first.resolve({ kind: 'page', page: page(300, 100, 'second') });
        await vi.waitFor(() => expect(readPage).toHaveBeenCalledTimes(2));
        session.acceptRealtime(addition(live(1002, 'durable', '2026-09-12T00:00:00.000Z')));
        second.resolve({ kind: 'page', page: page(200, 2) });
        await loading;
        session.acceptRealtime(addition(live(1003)));
        session.acceptRealtime(addition({ ...live(1004), deviceId: 'another-sensor' }));
        session.acceptRealtime(addition());
        expect(session.getState()).toMatchObject({ status: 'ready', error: null });
        expect(session.getState().samples).toHaveLength(106);
        expect(
            session.getState().samples.filter((sample) => sample.recordId === live(300).recordId),
        ).toHaveLength(1);
        expect(session.getState().samples).toContainEqual(live(1001));
        expect(session.getState().samples[0]).toEqual(
            live(50, 'volatile', '2026-07-01T00:00:00.000Z'),
        );
        expect(session.getState().samples.at(-1)).toEqual(
            live(1002, 'durable', '2026-09-12T00:00:00.000Z'),
        );
        expect(session.getState().samples).not.toContainEqual({
            ...live(1004),
            deviceId: 'another-sensor',
        });
        expect(readPage).toHaveBeenCalledTimes(2);
    });

    it('does not let additions during paging consume the two-page HTTP capacity', async () => {
        const first = deferred<Result>();
        const second = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        const session = createSession('temp-desk', { readPage }, () => instant);
        const loading = session.start();
        session.acceptRealtime(addition(live(1001)));
        first.resolve({ kind: 'page', page: page(300, 100, 'second') });
        await vi.waitFor(() => expect(readPage).toHaveBeenCalledTimes(2));
        session.acceptRealtime(addition(live(1002)));
        second.resolve({ kind: 'page', page: page(200, 100, 'third') });
        await loading;
        expect(session.getState()).toMatchObject({
            status: 'ready',
            error: null,
            limitReached: true,
        });
        expect(session.getState().samples.map((sample) => sample.recordId)).toEqual([
            ...Array.from({ length: 198 }, (_, index) => live(103 + index).recordId),
            live(1001).recordId,
            live(1002).recordId,
        ]);
        expect(readPage).toHaveBeenCalledTimes(2);
    });

    it.each(['http-first', 'live-first'] as const)(
        'prefers durable identity across %s delivery, late volatile copies and refetch',
        async (order) => {
            const response = deferred<Result>();
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockReturnValueOnce(response.promise)
                .mockResolvedValue({ kind: 'page', page: page(1, 0) });
            const session = createSession('temp-desk', { readPage }, () => instant);
            const loading = session.start();

            if (order === 'live-first') {
                session.acceptRealtime(addition(live(300, 'volatile')));
            }

            response.resolve({ kind: 'page', page: page(300, 1) });
            await loading;
            session.acceptRealtime(addition(live(300, 'volatile')));
            session.acceptRealtime(addition(live(300)));
            session.acceptRealtime(addition(live(300, 'volatile')));
            expect(session.getState().samples).toEqual([live(300)]);
            await session.start();
            expect(session.getState().samples).toEqual([live(300)]);
        },
    );

    it('evicts oldest timestamps and then record identities from the bounded mixed view and overlay', async () => {
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce({ kind: 'page', page: page(200, 100, 'second') })
            .mockResolvedValueOnce({ kind: 'page', page: page(100, 100) })
            .mockResolvedValue({ kind: 'page', page: page(1, 0) });
        const session = createSession('temp-desk', { readPage }, () => instant);
        await session.start();

        for (let id = 400; id >= 201; id -= 1) {
            session.acceptRealtime(addition(live(id, id % 2 ? 'volatile' : 'durable')));
        }

        session.acceptRealtime(addition(live(500, 'volatile', '2026-09-09T00:00:00.000Z')));
        expect(session.getState().samples.map((sample) => sample.recordId)).toEqual(
            Array.from({ length: 200 }, (_, index) => live(201 + index).recordId),
        );
        expect(session.getState().limitReached).toBe(true);
        await session.start();
        // An empty replacement baseline exposes only the overlay's retained bound.
        expect(session.getState().samples).toHaveLength(200);
        expect(session.getState().samples[0]?.recordId).toBe(live(201).recordId);
        expect(session.getState().samples.at(-1)?.recordId).toBe(live(400).recordId);
    });

    it('keeps the live overlay across cursor expiry and a replacement first page', async () => {
        const replacement = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') })
            .mockResolvedValueOnce({
                kind: 'cursor_error',
                error: { error: 'cursor_expired', message: 'Expired' },
            })
            .mockReturnValueOnce(replacement.promise);
        const session = createSession('temp-desk', { readPage }, () => instant);
        const loading = session.start();
        session.acceptRealtime(addition(live(1001)));
        await vi.waitFor(() => expect(readPage).toHaveBeenCalledTimes(3));
        session.acceptRealtime(addition(live(1002, 'volatile')));
        replacement.resolve({ kind: 'page', page: page(500, 1) });
        await loading;
        expect(session.getState().samples).toEqual([live(500), live(1001), live(1002, 'volatile')]);
        expect(readPage.mock.calls[2]?.[0]).toEqual(readPage.mock.calls[0]?.[0]);
    });

    it('refetches a new range after reconnect, retains the overlay and ignores a superseded HTTP response', async () => {
        let time = instant;
        const superseded = deferred<Result>();
        const replacement = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce({ kind: 'page', page: page(300, 1) })
            .mockReturnValueOnce(superseded.promise)
            .mockReturnValueOnce(replacement.promise);
        const session = createSession('temp-desk', { readPage }, () => time);
        await session.start();
        session.acceptRealtime(addition(live(1001)));
        const previousRead = session.start();
        session.acceptRealtime({ kind: 'interrupted' });
        expect(readPage.mock.calls[1]?.[1]?.aborted).toBe(true);
        expect(session.getState()).toMatchObject({
            status: 'waiting_for_baseline',
            lastKnown: true,
        });
        time += 1000;
        session.acceptRealtime(realtimeBaseline());
        session.acceptRealtime(addition(live(1002)));
        superseded.resolve({ kind: 'page', page: page(500, 1) });
        await previousRead;
        expect(session.getState().status).toBe('loading');
        expect(session.getState().samples).not.toContainEqual(live(500));
        replacement.resolve({ kind: 'page', page: page(600, 1) });
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(session.getState().samples).toEqual([live(600), live(1001), live(1002)]);
        expect(readPage.mock.calls[2]?.[0].to).toBe(new Date(time).toISOString());
    });

    it('retains the last non-null generation through degradation and never mixes replacement-generation records', async () => {
        const sameGeneration = deferred<Result>();
        const replacement = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce({ kind: 'page', page: page(300, 1) })
            .mockReturnValueOnce(sameGeneration.promise)
            .mockReturnValueOnce(replacement.promise);
        const session = createSession('temp-desk', { readPage }, () => instant);
        await session.start();
        session.acceptRealtime(addition(live(1001)));
        session.acceptRealtime({
            kind: 'addition',
            storage: degradedStorage(),
        });
        session.acceptRealtime(realtimeBaseline());
        expect(session.getState().samples).toEqual([live(300), live(1001)]);
        session.acceptRealtime({
            kind: 'addition',
            storage: degradedStorage(),
        });
        session.acceptRealtime(realtimeBaseline('replacement'));
        session.acceptRealtime({
            kind: 'addition',
            telemetrySample: live(2001),
            storage: realtimeBaseline('replacement').storage,
        });
        expect(session.getState()).toMatchObject({
            status: 'loading',
            lastKnown: true,
            samples: [live(300), live(1001)],
        });
        sameGeneration.resolve({ kind: 'page', page: page(500, 1) });
        replacement.resolve({
            kind: 'page',
            page: { ...page(5, 1), historyGenerationId: 'replacement' },
        });
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(session.getState().samples).toEqual([live(5), live(2001)]);
    });

    it.each(['first-page', 'continuation', 'cursor'] as const)(
        'requests the shared baseline for a generation disagreement in a %s',
        async (boundary) => {
            const requestBaseline = vi.fn();
            const replacement = { ...page(5, 1), historyGenerationId: 'replacement' };
            const readPage = vi.fn<TelemetryHistoryClient['readPage']>();

            if (boundary !== 'first-page') {
                readPage.mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') });
            }

            readPage.mockResolvedValueOnce(
                boundary === 'cursor'
                    ? {
                          kind: 'cursor_error',
                          error: { error: 'history_generation_changed', message: 'Replaced' },
                      }
                    : { kind: 'page', page: replacement },
            );
            readPage.mockResolvedValueOnce({ kind: 'page', page: replacement });
            const session = createSession(
                'temp-desk',
                { readPage },
                () => instant,
                requestBaseline,
            );
            session.acceptRealtime(addition(live(1001)));
            await session.start();
            expect(requestBaseline).toHaveBeenCalledOnce();
            expect(session.getState()).toMatchObject({
                status: 'waiting_for_baseline',
                lastKnown: true,
                pin: null,
            });
            expect(session.getState().samples).not.toContainEqual(live(5));
            session.acceptRealtime(realtimeBaseline('replacement'));
            await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
            expect(session.getState().samples).toEqual(replacement.items);
        },
    );

    it('keeps volatile additions visible after a 503 and refetches once when storage becomes available', async () => {
        const recovery = deferred<Result>();
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce({ kind: 'page', page: page(300, 100, 'second') })
            .mockResolvedValueOnce({
                kind: 'unavailable',
                error: { error: 'durable_history_unavailable', message: 'Unavailable' },
            })
            .mockReturnValueOnce(recovery.promise);
        const session = createSession('temp-desk', { readPage }, () => instant);
        await session.start();
        const volatile = live(1001, 'volatile');
        session.acceptRealtime({
            kind: 'addition',
            storage: degradedStorage(),
            telemetrySample: volatile,
        });
        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'unavailable',
            lastKnown: true,
        });
        expect(session.getState().samples).toContainEqual(volatile);
        session.acceptRealtime(addition());
        session.acceptRealtime(addition());
        expect(readPage).toHaveBeenCalledTimes(3);
        recovery.resolve({ kind: 'page', page: page(500, 1) });
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(session.getState()).toMatchObject({
            error: null,
            lastKnown: false,
            samples: [live(500), volatile],
        });
    });

    it('does not turn repeated available updates after a racing 503 into an automatic retry loop', async () => {
        const readPage = vi.fn<TelemetryHistoryClient['readPage']>().mockResolvedValue({
            kind: 'unavailable',
            error: { error: 'durable_history_unavailable', message: 'Unavailable' },
        });
        const session = createSession('temp-desk', { readPage }, () => instant);
        await session.start();
        session.acceptRealtime(addition());
        await vi.waitFor(() => expect(session.getState().status).toBe('error'));
        session.acceptRealtime(addition());
        session.acceptRealtime(addition());
        expect(readPage).toHaveBeenCalledTimes(2);
    });
});
