import {
    type DurableUserHistoryItem,
    isUserHistoryItem,
    isUserHistoryPage,
    type UserHistoryItem,
    type UserHistoryPage,
} from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import { createUserHistorySession } from './user-history-session';

const fixtures = createUserHistoryFixtures();
const baseline = {
    kind: 'baseline',
    storage: fixtures.snapshot.platform.storage,
    userHistory: [],
} as const;
const page = (
    items: UserHistoryPage['items'],
    nextCursor: string | null = null,
): UserHistoryPage => ({ ...fixtures.page, items, pageSize: 50, nextCursor });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('user history session', () => {
    it('keeps closure terminal even after overlay overflow and later public operations', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(historyPage([])));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        session.acceptRealtime({ ...baseline, kind: 'addition', userHistory: records(201) });
        expect(session.getState().overlayOverflow).toBe(true);
        session.close();
        const closed = session.getState();
        await session.refreshToNewest();
        await session.loadNextPage();
        await session.retry();
        session.updateReadingPosition({ ...fixtures.failure, offsetPx: 5 });
        session.acceptRealtime(baseline);
        expect(session.getState()).toBe(closed);
        expect(fetcher).toHaveBeenCalledOnce();
    });
    it('ignores a superseded response after a new baseline starts recovery', async () => {
        let release: (value: Response) => void = () => undefined;
        const current = records(1, 10001);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        release = resolve;
                    }),
            )
            .mockResolvedValueOnce(response(historyPage(current)));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        const oldRequest = session.loadNextPage();
        session.acceptRealtime({ kind: 'interrupted' });
        session.acceptRealtime(baseline);
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        release(response(historyPage(records(1))));
        await oldRequest;
        expect(session.getState().items).toEqual(current);
    });
    it('rejects a cursor cycle across separate older-page operations', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(historyPage([], 'a')))
            .mockResolvedValueOnce(response(historyPage([], 'b')))
            .mockResolvedValueOnce(response(historyPage([], 'a')));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        await session.loadNextPage();
        await session.loadNextPage();
        expect(session.getState().error).toBe('invalid_response');
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
    it('prefers durable HTTP evidence over a volatile live copy of the same identity', async () => {
        const durable = records(1)[0];

        if (!durable) {
            throw new Error('Missing fixture');
        }

        const volatile: UserHistoryItem = {
            kind: 'attempt_failed',
            recordId: durable.recordId,
            occurredAt: durable.occurredAt,
            source: durable.source,
            deviceId: 'led-main',
            deviceName: 'Main LED',
            durability: 'volatile',
        };
        expect(isUserHistoryItem(volatile)).toBe(true);
        const session = createUserHistorySession(
            vi.fn<typeof fetch>().mockResolvedValue(response(historyPage([durable]))),
        );
        session.acceptRealtime({ ...baseline, userHistory: [volatile] });
        await session.loadNextPage();
        session.acceptRealtime({ ...baseline, kind: 'addition', userHistory: [volatile] });
        expect(session.getState().items).toEqual([durable]);
    });

    it('rebuilds through a retained reading anchor and preserves live across reconnect', async () => {
        const items = records(70);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(historyPage(items.slice(0, 50), 'older')))
            .mockResolvedValueOnce(response(historyPage(items.slice(50))))
            .mockResolvedValueOnce(response(historyPage(items.slice(0, 50), 'new-older')))
            .mockResolvedValueOnce(response(historyPage(items.slice(50))));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        await session.loadNextPage();
        const anchor = items[60];

        if (!anchor) {
            throw new Error('Missing anchor');
        }

        session.updateReadingPosition({ ...anchor, offsetPx: -12 });
        const live = records(1, 10001);
        session.acceptRealtime({ ...baseline, kind: 'addition', userHistory: live });
        session.acceptRealtime({ kind: 'interrupted' });
        expect(session.getState().lastKnown).toBe(true);
        session.acceptRealtime(baseline);
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(fetcher).toHaveBeenCalledTimes(4);
        expect(session.getState().position).toMatchObject({
            recordId: anchor.recordId,
            offsetPx: -12,
        });
        expect(session.getState().items).toEqual(expect.arrayContaining(live));
    });

    it('selects the nearest available position when the old entry is absent', async () => {
        const items = records(50);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(historyPage(items)))
            .mockResolvedValueOnce(response(historyPage(items.slice(25))));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        const anchor = items[15];

        if (!anchor) {
            throw new Error('Missing anchor');
        }

        session.updateReadingPosition({ ...anchor, offsetPx: 4 });
        session.acceptRealtime({ kind: 'interrupted' });
        session.acceptRealtime(baseline);
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(session.getState()).toMatchObject({
            notice: 'anchor_unavailable',
            position: { recordId: items[25]?.recordId, offsetPx: 4 },
        });
    });

    it('bounds the live overlay, protects its reading anchor and refetches durable history after overflow', async () => {
        const historic = records(50);
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(historyPage(historic)));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        const live = records(1, 10001)[0];

        if (!live) {
            throw new Error('Missing live fixture');
        }

        session.acceptRealtime({ ...baseline, kind: 'addition', userHistory: [live] });
        session.updateReadingPosition({ ...live, offsetPx: 8 });

        for (const addition of records(210, 10002)) {
            session.acceptRealtime({ ...baseline, kind: 'addition', userHistory: [addition] });
        }

        expect(session.getState().items).toHaveLength(250);
        expect(session.getState().items).toEqual(expect.arrayContaining([...historic, live]));
        expect(session.getState()).toMatchObject({ overlayOverflow: true, hasNewEvents: true });
        await session.refreshToNewest();
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(session.getState()).toMatchObject({ position: null, overlayOverflow: false });
    });

    it('keeps five thousand HTTP items without evicting the read page when capacity is reached', async () => {
        const items = records(5050);
        const fetcher = vi.fn<typeof fetch>();

        for (let index = 0; index < 101; index += 1) {
            fetcher.mockResolvedValueOnce(
                response(
                    historyPage(items.slice(index * 50, (index + 1) * 50), `page-${index + 1}`),
                ),
            );
        }

        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);

        for (let index = 0; index < 100; index += 1) {
            await session.loadNextPage();
        }

        expect(session.getState().items).toHaveLength(5000);
        const anchor = session.getState().items[4000];

        if (!anchor) {
            throw new Error('Missing retained anchor');
        }

        session.updateReadingPosition({ ...anchor, offsetPx: 0 });
        await session.loadNextPage();
        expect(session.getState()).toMatchObject({ error: 'recovery_limit', endReached: false });
        expect(session.getState().items).toHaveLength(5000);
        expect(session.getState().items.some((item) => item.recordId === anchor.recordId)).toBe(
            true,
        );
    });

    it('limits a sparse rebuild to one hundred pages and preserves its labeled last-known view', async () => {
        const anchor = records(1)[0];

        if (!anchor) {
            throw new Error('Missing anchor');
        }

        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(historyPage([anchor])));

        for (let index = 0; index < 100; index += 1) {
            fetcher.mockResolvedValueOnce(response(historyPage([], `empty-${index}`)));
        }

        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        session.updateReadingPosition({ ...anchor, offsetPx: 0 });
        session.acceptRealtime({ kind: 'interrupted' });
        session.acceptRealtime(baseline);
        await vi.waitFor(() => expect(session.getState().status).toBe('error'));
        expect(fetcher).toHaveBeenCalledTimes(101);
        expect(session.getState()).toMatchObject({ error: 'recovery_limit', lastKnown: true });
        expect(session.getState().items).toEqual([anchor]);
    });

    it.each(['cursor_expired', 'invalid_cursor'] as const)(
        'restarts a rejected cursor once for %s without dropping the overlay',
        async (reason) => {
            const fetcher = vi
                .fn<typeof fetch>()
                .mockResolvedValueOnce(response(historyPage([], 'older')))
                .mockResolvedValueOnce(response({ error: reason, message: 'Rejected' }, 400))
                .mockResolvedValueOnce(response(historyPage([])));
            const session = createUserHistorySession(fetcher);
            session.acceptRealtime(baseline);
            await session.loadNextPage();
            const live = records(1, 10001);
            session.acceptRealtime({ ...baseline, kind: 'addition', userHistory: live });
            await session.loadNextPage();
            expect(fetcher).toHaveBeenCalledTimes(3);
            expect(fetcher.mock.calls[2]?.[0]).not.toContain('cursor=');
            expect(session.getState().items).toEqual(live);
        },
    );

    it('requests a new SSE baseline on HTTP generation mismatch and discards old data after replacement', async () => {
        const old = records(1);
        const replacement = records(1, 2);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(historyPage(old, 'older')))
            .mockResolvedValueOnce(
                response({ ...historyPage(replacement), historyGenerationId: 'replacement' }),
            )
            .mockResolvedValueOnce(
                response({ ...historyPage(replacement), historyGenerationId: 'replacement' }),
            );
        const requestBaseline = vi.fn();
        const session = createUserHistorySession(fetcher, requestBaseline);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        await session.loadNextPage();
        expect(requestBaseline).toHaveBeenCalledOnce();
        expect(session.getState().status).toBe('waiting_for_baseline');
        session.acceptRealtime({
            ...baseline,
            storage: {
                ...baseline.storage,
                status: 'available',
                historyGenerationId: 'replacement',
                storedThroughSequence: 10000,
            },
        });
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(session.getState().items).toEqual(replacement);
        expect(session.getState().notice).toBe('generation_changed');
    });

    it.each([
        { body: {}, status: 200, error: 'invalid_response' },
        {
            body: { ...historyPage([]), throughSequence: 9999 },
            status: 200,
            error: 'invalid_response',
        },
        {
            body: { error: 'cursor_query_mismatch', message: 'Mismatch' },
            status: 400,
            error: 'cursor_query_mismatch',
        },
        { body: historyPage([], 'older'), status: 200, error: 'invalid_response' },
    ])('preserves its view without automatic retry for $error', async ({ body, status, error }) => {
        const items = records(1);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(historyPage(items, 'older')))
            .mockResolvedValueOnce(response(body, status));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        await session.loadNextPage();
        session.acceptRealtime({ ...baseline, kind: 'addition' });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(session.getState()).toMatchObject({ error, lastKnown: true, items });
    });

    it('retries a network failure at the same cursor and rejects malformed JSON without looping', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(historyPage([], 'older')))
            .mockRejectedValueOnce(new Error('Offline'))
            .mockResolvedValueOnce(new Response('not-json'));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        await session.loadNextPage();
        expect(session.getState().error).toBe('request_failed');
        await session.retry();
        expect(fetcher.mock.calls[2]?.[0]).toBe(fetcher.mock.calls[1]?.[0]);
        expect(session.getState().error).toBe('invalid_response');
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
    it('keeps live additions before, during and between sparse pinned pages', async () => {
        let release: (value: Response) => void = () => undefined;
        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        release = resolve;
                    }),
            )
            .mockResolvedValueOnce(response(page([fixtures.failure])));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        session.acceptRealtime({ ...baseline, kind: 'addition', userHistory: [fixtures.gap] });
        const loading = session.loadNextPage();
        session.acceptRealtime({
            ...baseline,
            kind: 'addition',
            userHistory: [fixtures.powerChange],
        });
        release(response(page([], 'older')));
        await loading;
        expect(session.getState().endReached).toBe(false);
        await session.loadNextPage();
        expect(session.getState().items.map((item) => item.recordId)).toEqual(
            expect.arrayContaining([fixtures.gap.recordId, fixtures.powerChange.recordId]),
        );
        expect(new Set(session.getState().items.map((item) => item.recordId)).size).toBe(
            session.getState().items.length,
        );
        expect(fetcher.mock.calls[1]?.[0]).toContain('cursor=older');
    });

    it('shares one request across simultaneous load triggers and ignores a response after closing', async () => {
        let release: (value: Response) => void = () => undefined;
        const fetcher = vi.fn<typeof fetch>(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        );
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        const loading = session.loadNextPage();
        void session.loadNextPage();
        expect(fetcher).toHaveBeenCalledTimes(1);
        session.close();
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        release(response(page([fixtures.failure])));
        await loading;
        expect(session.getState()).toMatchObject({ status: 'closed', items: [] });
    });

    it('keeps a labeled last-known view after 503 and refetches on availability recovery', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(response(page([fixtures.failure], 'older')))
            .mockResolvedValueOnce(
                response({ error: 'durable_history_unavailable', message: 'Unavailable' }, 503),
            )
            .mockResolvedValueOnce(response(page([fixtures.failure])));
        const session = createUserHistorySession(fetcher);
        session.acceptRealtime(baseline);
        await session.loadNextPage();
        await session.loadNextPage();
        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'history_unavailable',
            lastKnown: true,
        });
        session.acceptRealtime({ kind: 'addition', storage: baseline.storage });
        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));
        expect(session.getState().lastKnown).toBe(false);
    });
});

function records(count: number, first = 1): DurableUserHistoryItem[] {
    return Array.from({ length: count }, (_, index): DurableUserHistoryItem => {
        const sequence = first + index;
        const item = {
            ...fixtures.failure,
            recordId: `rec:v1:sha256:${sequence.toString(16).padStart(64, '0')}`,
            storageSequence: sequence,
            occurredAt: new Date(
                Date.parse('2026-09-10T10:00:00.000Z') + sequence * 1000,
            ).toISOString(),
        };
        expect(isUserHistoryItem(item)).toBe(true);

        return item;
    }).reverse();
}

function historyPage(
    items: DurableUserHistoryItem[],
    nextCursor: string | null = null,
): UserHistoryPage {
    const value = { ...page(items, nextCursor), throughSequence: 20000 };
    expect(isUserHistoryPage(value)).toBe(true);

    return value;
}
