import { type RawTelemetryPageQuery } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTelemetryHistoryClient } from './telemetry-client';

const query: RawTelemetryPageQuery = {
    deviceId: 'temp-desk',
    metric: 'temperature',
    pageSize: 100,
    from: '2026-09-10T00:00:00.000Z',
    to: '2026-09-11T00:00:00.000Z',
};
const page = { ...createHistoryIdentityFixtures().rawTelemetryPage, pageSize: 100 };

describe('telemetry history HTTP client', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('reads a validated first page using the default BFF and exact query scope', async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(page)));
        expect(await createTelemetryHistoryClient(fetcher).readPage(query)).toEqual({
            kind: 'page',
            page,
        });
        const url = new URL(String(fetcher.mock.calls[0]?.[0]));
        expect(url.origin).toBe('http://localhost:4310');
        expect(url.pathname).toBe('/room/history/telemetry');
        expect(Object.fromEntries(url.searchParams)).toEqual({ ...query, pageSize: '100' });
    });

    it('encodes an opaque continuation cursor and forwards the configured origin and cancellation', async () => {
        vi.stubEnv('VITE_BFF_URL', 'http://127.0.0.1:4999///');
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(page)));
        const controller = new AbortController();
        await createTelemetryHistoryClient(fetcher).readPage(
            { ...query, cursor: 'opaque/+?&=' },
            controller.signal,
        );
        const url = new URL(String(fetcher.mock.calls[0]?.[0]));
        expect(url.origin).toBe('http://127.0.0.1:4999');
        expect(url.searchParams.get('cursor')).toBe('opaque/+?&=');
        expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    });

    it.each([
        ['device', { deviceId: 'another-sensor' }],
        ['metric', { metric: 'humidity' }],
        ['lower range', { occurredAt: '2026-09-09T23:59:59.999Z' }],
        ['exclusive upper range', { occurredAt: query.to }],
    ])('rejects a sample outside the requested %s', async (_name, change) => {
        const body = { ...page, items: page.items.map((sample) => ({ ...sample, ...change })) };
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
        expect(await createTelemetryHistoryClient(fetcher).readPage(query)).toEqual({
            kind: 'invalid_response',
        });
    });

    it.each([
        [200, { ...page, items: [] }, 'page'],
        [200, { ...page, pageSize: 50 }, 'invalid_response'],
        [200, { items: [] }, 'invalid_response'],
        [400, { error: 'cursor_expired', message: 'Expired.' }, 'cursor_error'],
        [503, { error: 'durable_history_unavailable', message: 'Unavailable.' }, 'unavailable'],
        [503, page, 'invalid_response'],
        [500, page, 'invalid_response'],
    ] as const)('validates HTTP status %s and its response shape', async (status, body, kind) => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify(body), { status }));
        expect(await createTelemetryHistoryClient(fetcher).readPage(query)).toMatchObject({ kind });
    });

    it('accepts the inclusive lower boundary and rejects malformed JSON without retrying network errors', async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        ...page,
                        items: [{ ...page.items[0], occurredAt: query.from }],
                    }),
                ),
            )
            .mockResolvedValueOnce(new Response('not-json'))
            .mockRejectedValueOnce(new TypeError('Network failed'));
        const client = createTelemetryHistoryClient(fetcher);
        expect(await client.readPage(query)).toMatchObject({ kind: 'page' });
        expect(await client.readPage(query)).toEqual({ kind: 'invalid_response' });
        await expect(client.readPage(query)).rejects.toThrow('Network failed');
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
});
