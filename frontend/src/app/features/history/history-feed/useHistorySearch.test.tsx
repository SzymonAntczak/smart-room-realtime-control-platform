import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHistorySearch } from './useHistorySearch';

const fixtures = createUserHistoryFixtures();

function response(nextCursor: string | null = null) {
    return new Response(JSON.stringify({ ...fixtures.page, pageSize: 50, nextCursor }));
}

function deferredResponse() {
    let resolve: (value: Response) => void = () => {
        throw new Error('Deferred response is not initialized.');
    };

    const promise = new Promise<Response>((complete) => {
        resolve = complete;
    });

    return { promise, resolve };
}

describe('useHistorySearch', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('does not fetch on mount and exposes explicit search and refresh actions', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response('older'))
            .mockResolvedValueOnce(response())
            .mockResolvedValueOnce(response());
        vi.stubGlobal('fetch', fetcher);
        const { result } = renderHook(() => useHistorySearch());
        await waitFor(() => expect(result.current.state.status).toBe('idle'));
        expect(fetcher).not.toHaveBeenCalled();

        await act(async () => {
            await result.current.search({ deviceId: 'led-main' });
        });
        await act(async () => result.current.loadOlder());
        await act(async () => result.current.refresh());

        expect(fetcher).toHaveBeenCalledTimes(3);
        const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
        expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([null, 'older', null]);
        expect(urls.every((url) => url.searchParams.get('deviceId') === 'led-main')).toBe(true);
    });

    it('aborts an in-flight request on StrictMode unmount and ignores its late response', async () => {
        const pending = deferredResponse();
        const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(pending.promise);
        vi.stubGlobal('fetch', fetcher);
        const { result, unmount } = renderHook(() => useHistorySearch(), { wrapper: StrictMode });

        await act(async () => {
            void result.current.search({ deviceId: 'led-main' });
        });
        const signal = fetcher.mock.calls[0]?.[1]?.signal;
        unmount();
        expect(signal?.aborted).toBe(true);

        await act(async () => pending.resolve(response()));
    });
});
