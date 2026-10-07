import type { UserHistoryPage } from '@smart-room/contracts/user-history';
import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import type { HistoryClient } from '../../../../api/history';
import type { HistoryResponseResult } from '../../../../api/history/history-response';

import { createHistorySearchSession, type HistorySearchCriteria } from './history-search-session';

const fixtures = createUserHistoryFixtures();
const criteria = { deviceId: 'led-main', from: '2026-09-10T10:00:00.000Z' } as const;
const normalizedCriteria = { deviceId: 'led-main', from: '2026-09-10T10:00:00Z' } as const;
const olderItem = {
    ...fixtures.availabilityChange,
    recordId: `rec:v1:sha256:${'d'.repeat(64)}`,
    storageSequence: 6,
};

function page(
    overrides: Partial<UserHistoryPage> = {},
): Extract<HistoryResponseResult, { kind: 'page' }> {
    return {
        kind: 'page',
        page: { ...fixtures.page, pageSize: 50, nextCursor: null, ...overrides },
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {
        throw new Error('Deferred request is not initialized.');
    };

    let reject: (reason: unknown) => void = () => {
        throw new Error('Deferred request is not initialized.');
    };

    const promise = new Promise<T>((complete, fail) => {
        resolve = complete;
        reject = fail;
    });

    return { promise, resolve, reject };
}

function clientFor(...results: HistoryResponseResult[]): HistoryClient {
    return { readPage: vi.fn().mockImplementation(async () => results.shift() ?? page()) };
}

describe('static history search session', () => {
    it('does not fetch before an explicit valid search and freezes criteria for paging and refresh', async () => {
        const readPage = vi
            .fn<HistoryClient['readPage']>()
            .mockResolvedValueOnce(page({ nextCursor: 'older' }))
            .mockResolvedValueOnce(page())
            .mockResolvedValueOnce(page());
        const session = createHistorySearchSession({ readPage });
        const mutableCriteria: HistorySearchCriteria = { ...criteria };

        expect(session.getState().status).toBe('idle');
        expect(await session.search({})).toBe(false);
        expect(
            await session.search({
                ...criteria,
                from: '2026-09-11T00:00:00.000Z',
                to: criteria.from,
            }),
        ).toBe(false);
        expect(readPage).not.toHaveBeenCalled();

        await session.search(mutableCriteria);
        mutableCriteria.deviceId = 'other-device';
        await session.loadOlder();
        await session.refresh();

        expect(readPage.mock.calls.map(([query]) => query)).toEqual([
            { pageSize: 50, cursor: null, ...normalizedCriteria },
            { pageSize: 50, cursor: 'older', ...normalizedCriteria },
            { pageSize: 50, cursor: null, ...normalizedCriteria },
        ]);
        expect(session.getState().sessionRevision).toBe(2);
    });

    it('walks empty intermediate pages without declaring the search complete', async () => {
        const session = createHistorySearchSession(
            clientFor(
                page({ nextCursor: 'empty-1' }),
                page({ items: [], nextCursor: 'match' }),
                page({ items: [olderItem], nextCursor: null }),
            ),
        );

        await session.search(criteria);
        await session.loadOlder();

        expect(session.getState()).toMatchObject({
            status: 'ready',
            endReached: true,
            items: [fixtures.powerChange, olderItem],
            completeness: 'retained_evidence_only',
        });
    });

    it('deduplicates records that reappear across paged results', async () => {
        const session = createHistorySearchSession(
            clientFor(page({ nextCursor: 'duplicate' }), page()),
        );
        await session.search(criteria);
        await session.loadOlder();

        expect(session.getState().items).toEqual([fixtures.powerChange]);
    });

    it('prevents duplicate paging and keeps a previous view labeled when a replacement fails', async () => {
        const older = deferred<HistoryResponseResult>();
        const replacement = deferred<HistoryResponseResult>();
        const readPage = vi
            .fn<HistoryClient['readPage']>()
            .mockResolvedValueOnce(page({ nextCursor: 'older' }))
            .mockReturnValueOnce(older.promise)
            .mockReturnValueOnce(replacement.promise);
        const session = createHistorySearchSession({ readPage });
        await session.search(criteria);

        const first = session.loadOlder();
        const second = session.loadOlder();
        expect(first).toBe(second);
        older.resolve(page({ items: [], nextCursor: null }));
        await first;

        const replacementSearch = session.search({ deviceId: 'another-device' });
        expect(session.getState()).toMatchObject({
            status: 'loading',
            items: [fixtures.powerChange],
            displayedCriteria: normalizedCriteria,
            appliedCriteria: { deviceId: 'another-device' },
        });
        replacement.resolve({
            kind: 'unavailable',
            error: { error: 'durable_history_unavailable', message: 'Unavailable.' },
        });
        await replacementSearch;

        expect(session.getState()).toMatchObject({
            status: 'error',
            items: [fixtures.powerChange],
            displayedCriteria: normalizedCriteria,
            appliedCriteria: { deviceId: 'another-device' },
            lastKnown: true,
            error: 'history_unavailable',
        });
    });

    it('ignores late responses after clear and aborts the old request', async () => {
        const pending = deferred<HistoryResponseResult>();
        const readPage = vi.fn<HistoryClient['readPage']>().mockReturnValue(pending.promise);
        const session = createHistorySearchSession({ readPage });
        const search = session.search(criteria);
        const signal = readPage.mock.calls[0]?.[1];

        session.clear();
        pending.resolve(page());
        await search;

        expect(signal?.aborted).toBe(true);
        expect(session.getState()).toMatchObject({
            status: 'idle',
            items: [],
            appliedCriteria: null,
        });
    });

    it('ignores a late rejected request after a replacement search starts', async () => {
        const oldRequest = deferred<HistoryResponseResult>();
        const newRequest = deferred<HistoryResponseResult>();
        const readPage = vi
            .fn<HistoryClient['readPage']>()
            .mockReturnValueOnce(oldRequest.promise)
            .mockReturnValueOnce(newRequest.promise);
        const session = createHistorySearchSession({ readPage });
        const oldSearch = session.search(criteria);
        const newSearch = session.search({ deviceId: 'another-device' });

        oldRequest.reject(new Error('Late failure'));
        await oldSearch;
        expect(session.getState()).toMatchObject({
            status: 'loading',
            appliedCriteria: { deviceId: 'another-device' },
            error: null,
        });

        newRequest.resolve(page());
        await newSearch;
        expect(session.getState()).toMatchObject({
            status: 'ready',
            appliedCriteria: { deviceId: 'another-device' },
            items: [fixtures.powerChange],
        });
    });

    it('bounds cached items after 100 accepted pages without implying end of history', async () => {
        let pageNumber = 0;
        const readPage = vi.fn<HistoryClient['readPage']>(async () => {
            pageNumber += 1;
            const firstSequence = 5000 - (pageNumber - 1) * 50;
            const pageItems = Array.from({ length: 50 }, (_, index) => {
                const storageSequence = firstSequence - index;

                return {
                    ...fixtures.powerChange,
                    recordId: `rec:v1:sha256:${storageSequence.toString(16).padStart(64, '0')}`,
                    storageSequence,
                };
            });

            return page({
                items: pageItems,
                throughSequence: 5000,
                nextCursor: `cursor-${pageNumber}`,
            });
        });
        const session = createHistorySearchSession({ readPage });

        await session.search(criteria);

        for (let pageIndex = 1; pageIndex < 100; pageIndex += 1) {
            await session.loadOlder();
        }

        expect(readPage).toHaveBeenCalledTimes(100);
        expect(session.getState()).toMatchObject({
            status: 'ready',
            endReached: false,
            limitReached: true,
            nextCursor: 'cursor-100',
            error: null,
        });
        expect(session.getState().items).toHaveLength(5000);
    });

    it('bounds sparse empty-page traversal without treating it as end of history', async () => {
        let pageNumber = 0;
        const readPage = vi.fn<HistoryClient['readPage']>(async () => {
            pageNumber += 1;

            return page({ items: [], nextCursor: `cursor-${pageNumber}` });
        });
        const session = createHistorySearchSession({ readPage });

        await session.search(criteria);

        expect(readPage).toHaveBeenCalledTimes(100);
        expect(session.getState()).toMatchObject({
            status: 'ready',
            items: [],
            endReached: false,
            limitReached: true,
            nextCursor: 'cursor-100',
            error: null,
        });
    });

    it.each([
        'cursor_expired',
        'invalid_cursor',
        'cursor_query_mismatch',
        'history_generation_changed',
    ] as const)('requires an explicit refresh after %s', async (reason) => {
        const readPage = vi
            .fn<HistoryClient['readPage']>()
            .mockResolvedValueOnce(page({ nextCursor: 'older' }))
            .mockResolvedValueOnce({
                kind: 'cursor_error',
                error: { error: reason, message: 'Rejected.' },
            });
        const session = createHistorySearchSession({ readPage });
        await session.search(criteria);
        await session.loadOlder();
        await session.retry();

        expect(session.getState()).toMatchObject({
            status: 'error',
            refreshRequired: true,
            error: reason,
        });
        expect(readPage).toHaveBeenCalledTimes(2);
        await session.refresh();
        expect(readPage).toHaveBeenCalledTimes(3);
        expect(readPage.mock.calls[2]?.[0]).toMatchObject({
            cursor: null,
            ...normalizedCriteria,
        });
    });

    it('requires refresh when a continuation page changes its pin', async () => {
        const session = createHistorySearchSession(
            clientFor(
                page({ nextCursor: 'older' }),
                page({ throughSequence: fixtures.page.throughSequence + 1 }),
            ),
        );
        await session.search(criteria);
        await session.loadOlder();

        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'invalid_response',
            refreshRequired: true,
            items: [fixtures.powerChange],
        });
    });

    it('replaces the previous criteria and results on the first valid sparse page', async () => {
        const readPage = vi
            .fn<HistoryClient['readPage']>()
            .mockResolvedValueOnce(page())
            .mockResolvedValueOnce(page({ items: [], nextCursor: 'sparse' }))
            .mockResolvedValueOnce(page({ items: [olderItem] }));
        const session = createHistorySearchSession({ readPage });
        await session.search(criteria);
        const observed: ReturnType<typeof session.getState>[] = [];
        session.subscribe(() => observed.push(session.getState()));

        await session.search({ deviceId: 'another-device' });

        expect(observed).toContainEqual(
            expect.objectContaining({
                status: 'loading',
                items: [],
                displayedCriteria: { deviceId: 'another-device' },
                lastKnown: false,
            }),
        );
        expect(session.getState()).toMatchObject({
            status: 'ready',
            items: [olderItem],
            displayedCriteria: { deviceId: 'another-device' },
        });
    });

    it('retries transient reads from the failed cursor while preserving current results', async () => {
        const readPage = vi
            .fn<HistoryClient['readPage']>()
            .mockResolvedValueOnce(page({ nextCursor: 'older' }))
            .mockResolvedValueOnce({
                kind: 'unavailable',
                error: { error: 'durable_history_unavailable', message: 'Unavailable.' },
            })
            .mockResolvedValueOnce(page());
        const session = createHistorySearchSession({ readPage });
        await session.search(criteria);
        await session.loadOlder();

        expect(session.getState()).toMatchObject({
            status: 'error',
            lastKnown: true,
            items: [fixtures.powerChange],
            refreshRequired: false,
        });
        await session.retry();

        expect(readPage.mock.calls[2]?.[0]).toMatchObject({ cursor: 'older' });
        expect(session.getState()).toMatchObject({ status: 'ready', lastKnown: false });
    });

    it('rejects cursor cycles without retrying automatically', async () => {
        const session = createHistorySearchSession(
            clientFor(page({ nextCursor: 'cycle' }), page({ nextCursor: 'cycle' })),
        );
        await session.search(criteria);
        await session.loadOlder();

        expect(session.getState()).toMatchObject({ status: 'error', error: 'invalid_response' });
    });

    it('releases requests and results when closed', async () => {
        const pending = deferred<HistoryResponseResult>();
        const readPage = vi.fn<HistoryClient['readPage']>().mockReturnValue(pending.promise);
        const session = createHistorySearchSession({ readPage });
        const search = session.search(criteria);
        const listener = vi.fn();
        session.subscribe(listener);
        session.close();
        pending.resolve(page());
        await search;

        expect(readPage.mock.calls[0]?.[1]?.aborted).toBe(true);
        expect(session.getState()).toMatchObject({
            status: 'closed',
            items: [],
            appliedCriteria: null,
        });
        expect(session.search(criteria)).resolves.toBe(false);
    });
});
