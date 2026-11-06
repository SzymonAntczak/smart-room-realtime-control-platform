import { describe, expect, it } from 'vitest';

import { MockHistory } from './mock-history';
import { createHistoryItems, createHistoryPage } from './recent-feed-fixtures';

const query = (cursor?: string) =>
    new URL(
        `http://localhost/room/history/user-history?pageSize=50${cursor ? `&cursor=${cursor}` : ''}`,
    );

describe('scripted user history boundary', () => {
    it('selects prepared filtered pages without filtering or scanning raw ranges', async () => {
        const history = new MockHistory();
        const records = createHistoryItems(51);
        const first = createHistoryPage(records.slice(0, 50), 'opaque');
        const last = createHistoryPage(records.slice(50));
        const fallback = createHistoryPage([]);
        history.setQueries([
            {
                criteria: { deviceId: 'led-main', from: '2026-09-20T00:00:00Z' },
                pages: [first, last],
            },
        ]);
        const url = query();
        url.searchParams.set('deviceId', 'led-main');
        url.searchParams.set('from', '2026-09-20T01:00:00+01:00');
        expect(await history.read(url, fallback)).toEqual({ status: 200, body: first });
        url.searchParams.set('cursor', 'opaque');
        expect(await history.read(url, fallback)).toEqual({ status: 200, body: last });
        expect(() => history.setPages([createHistoryPage([], 'sparse')])).toThrow(
            'Invalid mock history pages',
        );
        expect(() =>
            history.setQueries([{ criteria: { from: 'invalid' }, pages: [last] }]),
        ).toThrow('Invalid mock history queries');
        expect(() => history.read(new URL('http://localhost/?pageSize=20'), fallback)).toThrow(
            'Invalid mock history query',
        );
        expect(() =>
            history.read(new URL('http://localhost/?pageSize=50&extra=1'), fallback),
        ).toThrow('Invalid mock history query');
        expect(() => history.setError(503, { error: 'wrong' })).toThrow(
            'Invalid mock history error',
        );
    });

    it('holds an already captured response and consumes an error only once', async () => {
        const history = new MockHistory();
        const older = createHistoryPage(createHistoryItems(1));
        const unavailable = { error: 'durable_history_unavailable', message: 'Unavailable' };
        history.setError(503, unavailable);
        history.holdNext();
        const held = history.read(query(), older);
        expect(history.hasHeldResponse()).toBe(true);
        history.setPages([older]);
        history.release();
        expect(await held).toEqual({ status: 503, body: unavailable });
        expect(history.hasHeldResponse()).toBe(false);
        expect(await history.read(query(), older)).toEqual({ status: 200, body: older });
    });

    it('captures a page before holding it and releases only the pending read', async () => {
        const history = new MockHistory();
        const original = createHistoryPage(createHistoryItems(1));
        const captured = structuredClone(original);
        const replacement = createHistoryPage(createHistoryItems(1, 20000), null, 20000);
        history.setPages([original]);
        history.holdNext();
        const pending = history.read(query(), createHistoryPage([]));

        expect(history.hasHeldResponse()).toBe(true);
        original.items.length = 0;
        history.setPages([replacement]);
        await expect(history.read(query(), createHistoryPage([]))).resolves.toEqual({
            status: 200,
            body: replacement,
        });
        expect(history.hasHeldResponse()).toBe(true);
        history.release();

        await expect(pending).resolves.toEqual({ status: 200, body: captured });
        expect(history.hasHeldResponse()).toBe(false);
    });

    it('releases outstanding reads on reset and clears pages, filters, errors and pending holds', async () => {
        const history = new MockHistory();
        const page = createHistoryPage(createHistoryItems(1));
        const fallback = createHistoryPage([]);
        history.setPages([page]);
        history.setQueries([{ criteria: { deviceId: 'led-main' }, pages: [page] }]);
        history.holdNext();
        const pending = history.read(query(), fallback);
        history.holdNext();
        history.setError(400, { error: 'cursor_expired', message: 'Expired' });

        history.reset();

        await expect(pending).resolves.toEqual({ status: 200, body: page });
        expect(history.hasHeldResponse()).toBe(false);
        await expect(history.read(query(), fallback)).resolves.toEqual({
            status: 200,
            body: fallback,
        });
        const filtered = query();
        filtered.searchParams.set('deviceId', 'led-main');
        await expect(history.read(filtered, fallback)).resolves.toEqual({
            status: 200,
            body: fallback,
        });
    });

    it.each([
        ['noncanonical time', { items: [{ ...createHistoryItems(1)[0], occurredAt: 'invalid' }] }],
        ['duplicate identity', { items: [createHistoryItems(1)[0], createHistoryItems(1)[0]] }],
        ['ascending order', { items: createHistoryItems(2).reverse() }],
        ['watermark below an item', { throughSequence: 0, items: createHistoryItems(1) }],
        ['overfull page', { items: createHistoryItems(51) }],
        ['sparse continuation', { nextCursor: 'older' }],
        [
            'volatile HTTP fact',
            { items: [{ ...createHistoryItems(1)[0], durability: 'volatile' }] },
        ],
    ])('rejects a %s in both unfiltered and search fixture controls', (_, invalidFields) => {
        const history = new MockHistory();
        const invalidPage = { ...createHistoryPage([]), ...invalidFields };

        expect(() => history.setPages([invalidPage])).toThrow('Invalid mock history pages');
        expect(() =>
            history.setQueries([{ criteria: { deviceId: 'led-main' }, pages: [invalidPage] }]),
        ).toThrow('Invalid mock history queries');
    });
});
