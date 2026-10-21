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
});
