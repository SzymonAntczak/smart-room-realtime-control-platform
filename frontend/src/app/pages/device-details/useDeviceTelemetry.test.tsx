import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDeviceTelemetry } from './useDeviceTelemetry';

const fixture = createHistoryIdentityFixtures();
const page = { ...fixture.rawTelemetryPage, pageSize: 100 };

describe('device telemetry lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('does not read without a confirmed sensor and aborts on selection change and unmount', async () => {
        const pending: {
            resolve: (response: Response) => void;
            signal: AbortSignal | null | undefined;
        }[] = [];
        const fetcher = vi.fn<typeof fetch>(
            (_input, init) =>
                new Promise((resolve) => {
                    pending.push({ resolve, signal: init?.signal });
                }),
        );
        vi.stubGlobal('fetch', fetcher);
        const { result, rerender, unmount } = renderHook(
            ({ deviceId }: { deviceId: string | undefined }) => useDeviceTelemetry(deviceId),
            { initialProps: { deviceId: undefined as string | undefined } },
        );
        expect(fetcher).not.toHaveBeenCalled();
        rerender({ deviceId: 'temp-desk' });
        expect(fetcher).toHaveBeenCalledOnce();
        rerender({ deviceId: 'temp-other' });
        expect(pending[0]?.signal?.aborted).toBe(true);
        expect(result.current.state?.samples).toEqual([]);
        await act(async () => {
            pending[0]?.resolve(new Response(JSON.stringify(page)));
        });
        expect(result.current.state?.deviceId).toBe('temp-other');
        expect(result.current.state?.samples).toEqual([]);
        await act(async () => {
            pending[1]?.resolve(
                new Response(
                    JSON.stringify({
                        ...page,
                        items: page.items.map((sample) => ({ ...sample, deviceId: 'temp-other' })),
                    }),
                ),
            );
        });
        await waitFor(() => expect(result.current.state?.status).toBe('ready'));
        expect(result.current.state?.samples[0]?.deviceId).toBe('temp-other');
        unmount();
        expect(pending[1]?.signal?.aborted).toBe(true);
    });

    it('releases the StrictMode rehearsal and only accepts the active session response', async () => {
        const resolvers: ((response: Response) => void)[] = [];
        const fetcher = vi.fn<typeof fetch>(
            () =>
                new Promise((resolve) => {
                    resolvers.push(resolve);
                }),
        );
        vi.stubGlobal('fetch', fetcher);
        const { result, unmount } = renderHook(() => useDeviceTelemetry('temp-desk'), {
            wrapper: StrictMode,
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        await act(async () => {
            resolvers[1]?.(new Response(JSON.stringify(page)));
        });
        await waitFor(() => expect(result.current.state?.status).toBe('ready'));
        await act(async () => {
            resolvers[0]?.(new Response(JSON.stringify({ ...page, items: [] })));
        });
        expect(result.current.state?.samples).toEqual(page.items);
        unmount();
        expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    });

    it('exposes manual retry using a new range and disables telemetry when the sensor is removed', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockRejectedValueOnce(new TypeError('Network'))
            .mockResolvedValueOnce(new Response(JSON.stringify(page)));
        vi.stubGlobal('fetch', fetcher);
        const { result, rerender } = renderHook(
            ({ deviceId }: { deviceId: string | undefined }) => useDeviceTelemetry(deviceId),
            { initialProps: { deviceId: 'temp-desk' as string | undefined } },
        );
        await waitFor(() => expect(result.current.state?.status).toBe('error'));
        vi.setSystemTime(new Date('2026-09-11T00:00:01.000Z'));
        act(() => result.current.retry());
        await waitFor(() => expect(result.current.state?.status).toBe('ready'));
        expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('to')).toBe(
            '2026-09-11T00:00:01.000Z',
        );
        rerender({ deviceId: undefined });
        expect(result.current.state).toBeNull();
        expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(true);
    });
});
