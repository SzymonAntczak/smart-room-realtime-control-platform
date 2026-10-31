import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { useTelemetryList } from './useTelemetryList';

afterEach(() => vi.unstubAllGlobals());
it('isolates StrictMode sessions and aborts the active read on unmount', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>((_input, init) => {
            if (init?.signal) {
                signals.push(init.signal);
            }

            return new Promise(() => undefined);
        }),
    );
    const { unmount } = renderHook(() => useTelemetryList('temp-desk'), {
        wrapper: StrictMode,
    });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    unmount();
    expect(signals[1]?.aborted).toBe(true);
});

it('refreshes explicitly and does not react to unrelated rerenders', async () => {
    const page = {
        ...createHistoryIdentityFixtures().rawTelemetryPage,
        pageSize: 100,
        items: [],
        nextCursor: null,
    };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(page)));
    vi.stubGlobal('fetch', fetcher);
    const { result, rerender } = renderHook(() => useTelemetryList('temp-desk'));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    rerender();
    expect(fetcher).toHaveBeenCalledOnce();
    await act(async () => result.current.refresh());
    expect(fetcher).toHaveBeenCalledTimes(2);
});
