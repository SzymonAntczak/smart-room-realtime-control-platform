import { describe, expect, it } from 'vitest';

import { MockHistory } from './mock-history';
import { createHistoryItems, createHistoryPage } from './recent-feed-fixtures';

const query = (cursor?: string) =>
    new URL(
        `http://localhost/room/history/user-history?pageSize=50${cursor ? `&cursor=${cursor}` : ''}`,
    );

describe('scripted user history boundary', () => {
    it('accepts device/date filters, preserves sparse cursors and rejects unknown or invalid criteria', async () => {
        const history = new MockHistory();
        const records = createHistoryItems(3);
        const newest = records[0];
        const oldest = records[2];

        if (!newest || !oldest) {
            throw new Error('Expected both history date boundaries');
        }

        const fallback = createHistoryPage(records);
        history.setPages([createHistoryPage([], 'sparse'), fallback]);
        const url = query();
        url.searchParams.set('deviceId', 'led-main');
        url.searchParams.set('from', oldest.occurredAt);
        url.searchParams.set('to', newest.occurredAt);
        expect(await history.read(url, fallback)).toMatchObject({
            status: 200,
            body: { items: [], nextCursor: 'sparse' },
        });
        url.searchParams.set('cursor', 'sparse');
        expect(await history.read(url, fallback)).toMatchObject({
            status: 200,
            body: { items: records.slice(1), nextCursor: null },
        });
        url.searchParams.set('deviceId', 'temp-desk');
        expect(await history.read(url, fallback)).toMatchObject({ body: { items: [] } });
        url.searchParams.set('from', 'invalid');
        expect(() => history.read(url, fallback)).toThrow('Invalid mock history query');
        expect(() =>
            history.read(new URL('http://localhost/?pageSize=50&extra=1'), fallback),
        ).toThrow('Invalid mock history query');
    });
    it('continues a sparse page using its opaque cursor and rejects malformed configuration', async () => {
        const history = new MockHistory();
        const older = createHistoryPage(createHistoryItems(1));
        history.setPages([createHistoryPage([], 'opaque'), older]);
        expect(await history.read(query(), older)).toMatchObject({
            status: 200,
            body: { items: [], nextCursor: 'opaque' },
        });
        expect(await history.read(query('opaque'), older)).toEqual({ status: 200, body: older });
        expect(() => history.setPages([{ items: [] }])).toThrow('Invalid mock history pages');
        expect(() => history.setError(503, { error: 'wrong' })).toThrow(
            'Invalid mock history error',
        );
        expect(() => history.read(new URL('http://localhost/?pageSize=20'), older)).toThrow(
            'Invalid mock history query',
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
});
