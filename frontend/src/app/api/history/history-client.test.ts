import { createUserHistoryFixtures } from '@smart-room/contracts/user-history-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHistoryClient } from './history-client';

const { page } = createUserHistoryFixtures();

describe('user history HTTP client', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('reads a validated first page from the default BFF with the requested page size', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(page)));
        const result = await createHistoryClient(fetcher).readPage({
            pageSize: 50,
            cursor: null,
        });

        expect(fetcher.mock.calls[0]?.[0]).toBe(
            'http://localhost:4310/room/history/user-history?pageSize=50',
        );
        expect(result).toEqual({ kind: 'page', page });
    });

    it('uses the configured origin, encodes opaque cursors and forwards cancellation', async () => {
        vi.stubEnv('VITE_BFF_URL', 'http://127.0.0.1:4999///');
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(page)));
        const controller = new AbortController();
        await createHistoryClient(fetcher).readPage(
            { pageSize: 50, cursor: 'opaque/+?&=' },
            controller.signal,
        );
        const url = new URL(String(fetcher.mock.calls[0]?.[0]));

        expect(url.origin).toBe('http://127.0.0.1:4999');
        expect(url.pathname).toBe('/room/history/user-history');
        expect(url.searchParams.get('cursor')).toBe('opaque/+?&=');
        expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
        controller.abort();
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });

    it.each([
        [400, { error: 'cursor_expired', message: 'Expired.' }, 'cursor_error'],
        [503, { error: 'durable_history_unavailable', message: 'Unavailable.' }, 'unavailable'],
        [200, { items: [] }, 'invalid_response'],
        [503, page, 'invalid_response'],
        [500, page, 'invalid_response'],
    ] as const)(
        'classifies status %s through strict response validation',
        async (status, body, kind) => {
            const fetcher = vi
                .fn<typeof fetch>()
                .mockResolvedValue(new Response(JSON.stringify(body), { status }));
            expect(
                await createHistoryClient(fetcher).readPage({ pageSize: 50, cursor: 'next' }),
            ).toMatchObject({ kind });
        },
    );

    it('returns invalid_response for malformed JSON and propagates network failure without retry', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(new Response('not-json'))
            .mockRejectedValueOnce(new TypeError('Network failed'));
        const client = createHistoryClient(fetcher);

        expect(await client.readPage({ pageSize: 50, cursor: null })).toEqual({
            kind: 'invalid_response',
        });
        await expect(client.readPage({ pageSize: 50, cursor: null })).rejects.toThrow(
            'Network failed',
        );
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
