import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RoomHistoryRealtimeUpdate } from '../../room-history-update';
import { useHistorySearch } from '../history-search-modal/useHistorySearch';

import { useHistory } from './useHistory';

type RoomHistorySource = Parameters<typeof useHistory>[0];
type HistoryBaseline = ReturnType<RoomHistorySource['getBaseline']>;

const fixtures = createUserHistoryFixtures();

function historySource(): RoomHistorySource {
    const baseline: HistoryBaseline = {
        kind: 'baseline',
        storage: fixtures.snapshot.platform.storage,
        history: [fixtures.gap],
    } as const;

    return {
        subscribe: () => () => undefined,
        getBaseline: () => baseline,
        requestBaseline: () => undefined,
    };
}

function emptyHistorySource(): RoomHistorySource {
    return {
        subscribe: () => () => undefined,
        getBaseline: () => undefined,
        requestBaseline: () => undefined,
    };
}

function publishingHistorySource() {
    const listeners = new Set<(update: RoomHistoryRealtimeUpdate) => void>();
    const source: RoomHistorySource = {
        subscribe(listener) {
            listeners.add(listener);

            return () => listeners.delete(listener);
        },
        getBaseline: () => ({
            kind: 'baseline',
            storage: fixtures.snapshot.platform.storage,
            history: [fixtures.gap],
        }),
        requestBaseline: () => undefined,
    };

    return {
        source,
        publish(update: RoomHistoryRealtimeUpdate) {
            for (const listener of listeners) {
                listener(update);
            }
        },
    };
}

function deferredResponse() {
    let resolve: (value: Response) => void = () => {
        throw new Error('Deferred response is not initialized.');
    };

    const promise = new Promise<Response>((complete) => {
        resolve = complete;
    });

    return { promise, resolve: (value: Response) => resolve(value) };
}

function pageResponse(nextCursor: string | null = null) {
    return new Response(JSON.stringify({ ...fixtures.page, pageSize: 50, nextCursor }));
}

describe('useHistory', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('clears the previous source and ignores its late page when the replacement has no baseline', async () => {
        const pending = deferredResponse();
        const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
        vi.stubGlobal('fetch', fetcher);
        const { result, rerender } = renderHook(({ source }) => useHistory(source), {
            initialProps: { source: historySource() },
        });
        expect(result.current.state.status).toBe('loading');
        expect(result.current.state.items).toEqual([fixtures.gap]);
        const signal = fetcher.mock.calls[0]?.[1]?.signal;

        rerender({ source: emptyHistorySource() });
        expect(signal?.aborted).toBe(true);
        expect(result.current.state.status).toBe('waiting_for_baseline');
        expect(result.current.state.items).toEqual([]);

        await act(async () => pending.resolve(pageResponse()));
        expect(result.current.state.status).toBe('waiting_for_baseline');
        expect(result.current.state.items).toEqual([]);
    });

    it('reopens a fresh session after StrictMode cleanup and releases its pending request on unmount', async () => {
        const abandoned = deferredResponse();
        const current = deferredResponse();
        const fetcher = vi
            .fn<typeof fetch>()
            .mockReturnValueOnce(abandoned.promise)
            .mockReturnValueOnce(current.promise);
        vi.stubGlobal('fetch', fetcher);
        const source = historySource();
        const { result, unmount } = renderHook(() => useHistory(source), { wrapper: StrictMode });
        const abandonedSignal = fetcher.mock.calls[0]?.[1]?.signal;
        const currentSignal = fetcher.mock.calls[1]?.[1]?.signal;
        expect(abandonedSignal?.aborted).toBe(true);
        expect(currentSignal?.aborted).toBe(false);

        await act(async () => abandoned.resolve(pageResponse()));
        expect(result.current.state.status).toBe('loading');
        expect(result.current.state.items).toEqual([fixtures.gap]);

        await act(async () => current.resolve(pageResponse('next-page')));
        await waitFor(() => expect(result.current.state.status).toBe('ready'));
        expect(result.current.state.items).toEqual(
            expect.arrayContaining([fixtures.powerChange, fixtures.gap]),
        );

        const next = deferredResponse();
        fetcher.mockReturnValueOnce(next.promise);
        act(() => result.current.loadOlder());
        const nextSignal = fetcher.mock.calls.at(-1)?.[1]?.signal;
        expect(result.current.state.status).toBe('loading');
        expect(nextSignal?.aborted).toBe(false);
        unmount();
        expect(nextSignal?.aborted).toBe(true);
        await act(async () => next.resolve(pageResponse()));
    });

    it('keeps static search results unchanged when the Dashboard receives a live addition', async () => {
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => pageResponse());
        vi.stubGlobal('fetch', fetcher);
        const { source, publish } = publishingHistorySource();
        const { result } = renderHook(() => ({
            dashboard: useHistory(source),
            search: useHistorySearch(),
        }));
        await waitFor(() => expect(result.current.dashboard.state.status).toBe('ready'));

        const readingPosition = {
            recordId: fixtures.gap.recordId,
            occurredAt: fixtures.gap.occurredAt,
            offsetPx: 12,
        };
        act(() => result.current.dashboard.updateReadingPosition(readingPosition));

        await act(async () => result.current.search.search({ deviceId: 'led-main' }));
        await act(async () => result.current.search.refresh());
        const searchItems = result.current.search.state.items;
        expect(result.current.dashboard.state).toMatchObject({
            position: readingPosition,
            status: 'ready',
            items: expect.arrayContaining([fixtures.powerChange, fixtures.gap]),
        });
        const addition = {
            ...fixtures.availabilityChange,
            recordId: `rec:v1:sha256:${'d'.repeat(64)}`,
            storageSequence: 8,
        };

        act(() =>
            publish({
                kind: 'addition',
                storage: {
                    status: 'available',
                    historyGenerationId: fixtures.page.historyGenerationId,
                    changedAt: fixtures.snapshot.platform.storage.changedAt,
                    storedThroughSequence: 8,
                },
                history: [addition],
            }),
        );

        expect(result.current.dashboard.state.items).toEqual(
            expect.arrayContaining([fixtures.powerChange, addition]),
        );
        expect(result.current.search.state.items).toBe(searchItems);
        expect(result.current.search.state.items).toEqual([fixtures.powerChange]);

        act(() => publish({ kind: 'interrupted' }));
        expect(result.current.dashboard.state.status).toBe('waiting_for_baseline');
        fetcher.mockResolvedValueOnce(
            new Response(
                JSON.stringify({ error: 'durable_history_unavailable', message: 'Unavailable.' }),
                { status: 503 },
            ),
        );
        act(() =>
            publish({
                kind: 'baseline',
                storage: {
                    status: 'degraded',
                    reason: 'temporarily_unavailable',
                    historyGenerationId: null,
                    changedAt: fixtures.snapshot.platform.storage.changedAt,
                    storedThroughSequence: null,
                },
                lastKnownHistoryGenerationId: fixtures.page.historyGenerationId,
                history: [],
            }),
        );
        await waitFor(() => expect(result.current.dashboard.state.status).toBe('error'));
        expect(result.current.search.state.items).toBe(searchItems);

        act(() =>
            publish({
                kind: 'addition',
                storage: {
                    status: 'available',
                    historyGenerationId: fixtures.page.historyGenerationId,
                    changedAt: fixtures.snapshot.platform.storage.changedAt,
                    storedThroughSequence: 8,
                },
                history: [],
            }),
        );
        await waitFor(() => expect(result.current.dashboard.state.status).toBe('ready'));
        expect(result.current.dashboard.state.position).toEqual(readingPosition);
        expect(result.current.search.state.items).toBe(searchItems);
    });
});
