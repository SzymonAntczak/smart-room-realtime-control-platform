import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHistoryContext } from './history-context';
import { HistoryProvider } from './HistoryProvider';

const fixture = createUserHistoryFixtures();

describe('HistoryProvider', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('keeps two search sessions independent and aborts only the unmounted session', async () => {
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
        const wrapper = ({ children }: { children: ReactNode }) => (
            <HistoryProvider mode="search" devices={[]}>
                {children}
            </HistoryProvider>
        );
        const first = renderHook(useHistoryContext, { wrapper });
        const second = renderHook(useHistoryContext, { wrapper });
        act(() => {
            if (first.result.current.mode === 'search') {
                void first.result.current.search.search({ deviceId: 'led-main' });
            }
        });
        await waitFor(() => expect(signals).toHaveLength(1));

        if (second.result.current.mode !== 'search') {
            throw new Error('Expected search context');
        }

        expect(second.result.current.search.state.status).toBe('idle');
        act(() => {
            if (second.result.current.mode === 'search') {
                void second.result.current.search.search({ from: '2026-10-01T00:00:00Z' });
            }
        });
        await waitFor(() => expect(signals).toHaveLength(2));
        first.unmount();
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        second.unmount();
        expect(signals[1]?.aborted).toBe(true);
    });

    it('subscribes before reading the live baseline and releases the source on unmount', async () => {
        const calls: string[] = [];
        const unsubscribe = vi.fn();
        const source = {
            subscribe: () => {
                calls.push('subscribe');

                return unsubscribe;
            },
            getBaseline: () => {
                calls.push('baseline');

                return {
                    kind: 'baseline' as const,
                    storage: fixture.snapshot.platform.storage,
                    history: fixture.snapshot.userHistory,
                };
            },
            requestBaseline: vi.fn(),
        };
        const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
            calls.push('http');

            return new Response(
                JSON.stringify({ ...fixture.page, pageSize: 50, nextCursor: null }),
            );
        });
        vi.stubGlobal('fetch', fetcher);
        const wrapper = ({ children }: { children: ReactNode }) => (
            <HistoryProvider
                mode="live"
                source={source}
                devices={[]}
                waitingForRoom={false}
                realtimeUncertain={false}
            >
                {children}
            </HistoryProvider>
        );
        const { unmount } = renderHook(useHistoryContext, { wrapper });
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        expect(calls).toEqual(['subscribe', 'baseline', 'http']);
        unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });
});
