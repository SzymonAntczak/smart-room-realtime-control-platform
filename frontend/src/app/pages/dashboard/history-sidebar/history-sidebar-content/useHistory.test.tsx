import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
