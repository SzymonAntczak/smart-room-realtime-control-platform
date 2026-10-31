import { describe, expect, it, vi } from 'vitest';

import { createInfiniteSession, type InfiniteSource } from './infinite-session';

type Source = InfiniteSource<{ id: string }, { scope: string }, string>;

function create(duplicates: 'ignore' | 'reject' = 'ignore', maxItems = 2) {
    return createInfiniteSession<{ id: string }, { scope: string }, string>({
        getItemKey: (item) => item.id,
        maxItems,
        maxPages: 2,
        duplicates,
        errors: { invalidResponse: 'invalid', requestFailed: 'transport', limit: 'limit' },
    });
}

function page(
    ids: string[],
    nextCursor: string | null = null,
): Awaited<ReturnType<Source['readPage']>> {
    return {
        kind: 'page',
        items: ids.map((id) => ({ id })),
        metadata: { scope: 'scope' },
        nextCursor,
    };
}

describe('bounded infinite cursor session', () => {
    it('shares one in-flight operation and separates a cache limit from the dataset end', async () => {
        let finish: (value: Awaited<ReturnType<Source['readPage']>>) => void = () => undefined;
        const readPage = vi
            .fn<Source['readPage']>()
            .mockResolvedValueOnce(page(['a'], 'older'))
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        finish = resolve;
                    }),
            );
        const session = create();
        await session.start(() => ({ readPage }));
        const first = session.loadMore();
        expect(session.loadMore()).toBe(first);
        finish(page(['b'], 'oldest'));
        await first;
        await session.loadMore();
        expect(readPage).toHaveBeenCalledTimes(2);
        expect(session.getState()).toMatchObject({
            limitReached: true,
            endReached: false,
            items: [{ id: 'a' }, { id: 'b' }],
        });
    });
    it.each(['ignore', 'reject'] as const)(
        'applies the consumer duplicate policy %s atomically',
        async (duplicates) => {
            const session = create(duplicates);
            const readPage = vi
                .fn<Source['readPage']>()
                .mockResolvedValueOnce(page(['a'], 'older'))
                .mockResolvedValueOnce(page(['a', 'b']));
            await session.start(() => ({ readPage }));
            await session.loadMore();
            expect(session.getState()).toMatchObject(
                duplicates === 'reject'
                    ? { status: 'error', error: 'invalid', items: [{ id: 'a' }] }
                    : { status: 'ready', endReached: true, items: [{ id: 'a' }, { id: 'b' }] },
            );
        },
    );
    it('rejects a cursor cycle spanning multiple pages', async () => {
        const session = create('ignore', 10);
        const readPage = vi
            .fn<Source['readPage']>()
            .mockResolvedValueOnce(page(['a'], 'one'))
            .mockResolvedValueOnce(page(['b'], 'one'));
        await session.start(() => ({ readPage }));
        await session.loadMore();
        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'invalid',
            items: [{ id: 'a' }],
        });
    });
    it('retries only the failed cursor and creates a fresh source on refresh', async () => {
        const readPage = vi
            .fn<Source['readPage']>()
            .mockResolvedValueOnce(page(['a'], 'older'))
            .mockResolvedValueOnce({ kind: 'error', error: 'offline', recovery: 'retry' })
            .mockResolvedValueOnce(page(['b']))
            .mockResolvedValueOnce(page(['c']));
        const factory = vi.fn(() => ({ readPage }));
        const session = create();
        await session.start(factory);
        await session.loadMore();
        await session.retry();
        expect(readPage.mock.calls.map(([request]) => request.cursor)).toEqual([
            null,
            'older',
            'older',
        ]);
        await session.refresh();
        expect(factory).toHaveBeenCalledTimes(2);
        expect(session.getState()).toMatchObject({
            items: [{ id: 'c' }],
            lastKnown: false,
            sessionRevision: 2,
        });
    });
    it('does not retry errors requiring refresh', async () => {
        const readPage = vi
            .fn<Source['readPage']>()
            .mockResolvedValue({ kind: 'error', error: 'expired', recovery: 'refresh' });
        const session = create();
        await session.start(() => ({ readPage }));
        await session.retry();
        expect(readPage).toHaveBeenCalledTimes(1);
        expect(session.getState().refreshRequired).toBe(true);
    });
    it('aborts replacement requests and ignores late success or failure after clearing and closing', async () => {
        let finish: (value: Awaited<ReturnType<Source['readPage']>>) => void = () => undefined;
        const readPage = vi.fn<Source['readPage']>().mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        );
        const session = create();
        const pending = session.start(() => ({ readPage }));
        session.clear();
        expect(readPage.mock.calls[0]?.[0].signal.aborted).toBe(true);
        finish(page(['late']));
        await pending;
        expect(session.getState()).toMatchObject({ status: 'idle', items: [], metadata: null });
        const late = session.start(() => ({ readPage }));
        session.close();
        finish(page(['late']));
        await late;
        expect(session.getState()).toMatchObject({ status: 'closed', items: [] });
    });
});
