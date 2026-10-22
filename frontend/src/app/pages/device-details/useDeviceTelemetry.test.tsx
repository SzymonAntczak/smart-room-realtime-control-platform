import { liveTelemetrySampleProjectionSchema } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { isSchema } from '@smart-room/contracts/validation';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HistoryLiveSource, HistoryLiveUpdate } from '../../features/history';

import { useDeviceTelemetry } from './useDeviceTelemetry';

const fixture = createHistoryIdentityFixtures();
const page = { ...fixture.rawTelemetryPage, pageSize: 100 };
let source: HistoryLiveSource;
let currentBaseline: Extract<HistoryLiveUpdate, { kind: 'baseline' }> | undefined;
let realtimeListeners: Set<(update: HistoryLiveUpdate) => void>;

vi.mock('../../features/room', () => ({
    useRoomConnection: () => ({ historySource: source }),
}));

function publish(update: HistoryLiveUpdate) {
    if (update.kind === 'baseline') {
        currentBaseline = update;
    } else if (update.kind === 'interrupted') {
        currentBaseline = undefined;
    } else if (update.telemetrySample) {
        expect(isSchema(liveTelemetrySampleProjectionSchema, update.telemetrySample)).toBe(true);
    }

    for (const listener of realtimeListeners) {
        listener(update);
    }
}

describe('device telemetry lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'));
        realtimeListeners = new Set();
        currentBaseline = {
            kind: 'baseline',
            history: [],
            storage: {
                status: 'available',
                historyGenerationId: page.historyGenerationId,
                storedThroughSequence: page.throughSequence,
                changedAt: page.retentionAsOf,
            },
        };
        source = {
            subscribe(listener) {
                realtimeListeners.add(listener);

                return () => {
                    realtimeListeners.delete(listener);
                };
            },
            getBaseline: () => currentBaseline,
            requestBaseline: vi.fn(),
        };
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
        expect(realtimeListeners.size).toBe(1);
        rerender({ deviceId: 'temp-other' });
        expect(realtimeListeners.size).toBe(1);
        act(() =>
            publish({
                kind: 'addition',
                storage: source.getBaseline()?.storage ?? {
                    status: 'available',
                    changedAt: page.retentionAsOf,
                    historyGenerationId: page.historyGenerationId,
                    storedThroughSequence: page.throughSequence,
                },
                telemetrySample: fixture.telemetrySample,
            }),
        );
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
        expect(realtimeListeners.size).toBe(0);
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
        expect(realtimeListeners.size).toBe(1);
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
        expect(realtimeListeners.size).toBe(0);
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

    it('subscribes before HTTP, waits for the first baseline and processes every batched addition', async () => {
        const baseline = currentBaseline;

        if (!baseline) {
            throw new Error('Missing baseline fixture');
        }

        currentBaseline = undefined;
        const duringRequest = {
            ...fixture.telemetrySample,
            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
            storageSequence: 20,
        };
        const afterRequest = {
            ...fixture.telemetrySample,
            recordId: `rec:v1:sha256:${'d'.repeat(64)}`,
            storageSequence: 21,
        };
        const fetcher = vi.fn<typeof fetch>(() => {
            expect(realtimeListeners.size).toBe(1);
            publish({
                kind: 'addition',
                storage: baseline.storage,
                telemetrySample: duringRequest,
            });

            return Promise.resolve(new Response(JSON.stringify(page)));
        });
        vi.stubGlobal('fetch', fetcher);
        const { result, unmount } = renderHook(() => useDeviceTelemetry('temp-desk'));
        expect(fetcher).not.toHaveBeenCalled();
        expect(result.current.state?.status).toBe('waiting_for_baseline');
        await act(async () => publish(baseline));
        await waitFor(() => expect(result.current.state?.status).toBe('ready'));
        act(() => {
            publish({ kind: 'addition', storage: baseline.storage, telemetrySample: afterRequest });
            publish({
                kind: 'addition',
                storage: baseline.storage,
                telemetrySample: { ...duringRequest, deviceId: 'another-sensor' },
            });
        });
        expect(result.current.state?.samples).toEqual([
            fixture.telemetrySample,
            duringRequest,
            afterRequest,
        ]);
        unmount();
        expect(realtimeListeners.size).toBe(0);
    });

    it('retains live samples through interruption and refetches after a replacement baseline', async () => {
        const baseline = currentBaseline;

        if (!baseline) {
            throw new Error('Missing baseline fixture');
        }

        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementation(async () => new Response(JSON.stringify(page)));
        vi.stubGlobal('fetch', fetcher);
        const { result } = renderHook(() => useDeviceTelemetry('temp-desk'));
        await waitFor(() => expect(result.current.state?.status).toBe('ready'));
        const live = {
            ...fixture.telemetrySample,
            recordId: `rec:v1:sha256:${'c'.repeat(64)}`,
            storageSequence: 20,
        };
        act(() => {
            publish({ kind: 'addition', storage: baseline.storage, telemetrySample: live });
            publish({ kind: 'interrupted' });
        });
        expect(result.current.state).toMatchObject({
            status: 'waiting_for_baseline',
            lastKnown: true,
        });
        vi.setSystemTime(new Date('2026-09-11T00:00:01.000Z'));
        await act(async () => publish(baseline));
        await waitFor(() => expect(result.current.state?.status).toBe('ready'));
        expect(result.current.state?.samples).toEqual([fixture.telemetrySample, live]);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(new URL(String(fetcher.mock.calls[1]?.[0])).searchParams.get('to')).toBe(
            '2026-09-11T00:00:01.000Z',
        );
    });
});
