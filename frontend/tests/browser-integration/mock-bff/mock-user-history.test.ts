import { describe, expect, it } from 'vitest';

import { MockUserHistory } from './mock-user-history';
import { createHistoryItems, createHistoryPage } from './recent-feed-fixtures';

const query = (cursor?: string) =>
    new URL(
        `http://localhost/room/history/user-history?pageSize=50${cursor ? `&cursor=${cursor}` : ''}`,
    );

describe('scripted user history boundary', () => {
    it('continues a sparse page using its opaque cursor and rejects malformed configuration', async () => {
        const history = new MockUserHistory();
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
        const history = new MockUserHistory();
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
