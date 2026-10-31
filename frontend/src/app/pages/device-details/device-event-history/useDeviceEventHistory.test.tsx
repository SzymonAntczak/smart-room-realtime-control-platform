import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDeviceEventHistory } from './useDeviceEventHistory';
describe('device event-history session lifecycle', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('retains its session for the same device and aborts requests on identity replacement or unmount', async () => {
        const signals: AbortSignal[] = [];
        const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
            if (init?.signal) {
                signals.push(init.signal);
            }

            return new Promise(() => undefined);
        });
        vi.stubGlobal('fetch', fetcher);
        const { rerender, unmount } = renderHook(({ id }) => useDeviceEventHistory(id), {
            initialProps: { id: 'led-main' },
        });
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        rerender({ id: 'led-main' });
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(signals[0]?.aborted).toBe(false);
        rerender({ id: 'led-other' });
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        expect(signals[0]?.aborted).toBe(true);
        expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('deviceId')).toBe(
            'led-other',
        );
        unmount();
        expect(signals[1]?.aborted).toBe(true);
    });

    it('closes the discarded StrictMode query and keeps the replacement query active', async () => {
        const signals: AbortSignal[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockImplementation((_url, init) => {
                if (init?.signal) {
                    signals.push(init.signal);
                }

                return new Promise(() => undefined);
            }),
        );
        const { unmount } = renderHook(() => useDeviceEventHistory('led-main'), {
            wrapper: StrictMode,
        });
        await waitFor(() => expect(signals).toHaveLength(2));
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        act(() => unmount());
        expect(signals.every((signal) => signal.aborted)).toBe(true);
    });
});
