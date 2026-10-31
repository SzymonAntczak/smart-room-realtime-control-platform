import { isRawTelemetryPage, type RawTelemetryPage } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import type { TelemetryHistoryClient } from '../../api/history';

import { createTelemetrySearchSession, resolveTelemetryRange } from './telemetry-search-session';

const instant = Date.parse('2026-09-11T00:00:00.000Z');

function page(
    first = 200,
    count = 100,
    nextCursor: string | null = 'older',
    overrides: Partial<RawTelemetryPage> = {},
) {
    const fixture = createHistoryIdentityFixtures();
    const value = {
        ...fixture.rawTelemetryPage,
        pageSize: 100,
        throughSequence: 10000,
        items: Array.from({ length: count }, (_, i) => ({
            ...fixture.telemetrySample,
            recordId: `rec:v1:sha256:${(first - i).toString(16).padStart(64, '0')}`,
            storageSequence: first - i,
        })),
        nextCursor,
        ...overrides,
    };
    expect(isRawTelemetryPage(value)).toBe(true);

    return { kind: 'page' as const, page: value };
}

describe('static telemetry adapter', () => {
    it('pins query bounds and metadata and recomputes omitted dates only on explicit refresh', async () => {
        let clock = instant;
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce(page())
            .mockResolvedValueOnce(page(100, 1, null))
            .mockResolvedValueOnce(page(300, 1, null));
        const session = createTelemetrySearchSession('temp-desk', { readPage }, () => clock);
        await session.search({ deviceId: 'ignored' });
        clock += 60000;
        await session.loadMore();
        expect(readPage.mock.calls[0]?.[0]).toEqual({
            deviceId: 'temp-desk',
            metric: 'temperature',
            pageSize: 100,
            from: '2026-08-12T00:00:00.000Z',
            to: '2026-09-11T00:00:00.000Z',
        });
        expect(readPage.mock.calls[1]?.[0]).toEqual({
            ...readPage.mock.calls[0]?.[0],
            cursor: 'older',
        });
        await session.refresh();
        expect(readPage.mock.calls[2]?.[0].to).toBe('2026-09-11T00:01:00.000Z');
        expect(session.getState()).toMatchObject({ endReached: true, lastKnown: false });
    });
    it('rejects empty effective ranges and supports one-sided criteria', async () => {
        const readPage = vi.fn<TelemetryHistoryClient['readPage']>();
        const session = createTelemetrySearchSession('temp-desk', { readPage }, () => instant);
        expect(await session.search({ from: '2026-09-12T00:00:00Z' })).toBe(false);
        expect(readPage).not.toHaveBeenCalled();
        expect(resolveTelemetryRange({ to: '2026-08-01T00:00:00Z' }, instant)).toEqual({
            from: '2026-07-02T00:00:00.000Z',
            to: '2026-08-01T00:00:00Z',
        });
    });
    it.each(['historyGenerationId', 'throughSequence', 'retentionAsOf'] as const)(
        'requires refresh after changed %s',
        async (field) => {
            const changed =
                field === 'throughSequence'
                    ? 10001
                    : field === 'retentionAsOf'
                      ? '2026-09-12T00:00:00Z'
                      : 'replacement-generation';
            const readPage = vi
                .fn<TelemetryHistoryClient['readPage']>()
                .mockResolvedValueOnce(page())
                .mockResolvedValueOnce(page(100, 1, null, { [field]: changed }));
            const session = createTelemetrySearchSession('temp-desk', { readPage }, () => instant);
            await session.search({});
            await session.loadMore();
            await session.retry();
            expect(session.getState()).toMatchObject({
                status: 'error',
                error: 'invalid_response',
                refreshRequired: true,
            });
            expect(readPage).toHaveBeenCalledTimes(2);
        },
    );
    it('rejects duplicate or out-of-order continuation records', async () => {
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce(page())
            .mockResolvedValueOnce(page(200, 1, null));
        const session = createTelemetrySearchSession('temp-desk', { readPage }, () => instant);
        await session.search({});
        await session.loadMore();
        expect(session.getState()).toMatchObject({ status: 'error', error: 'invalid_response' });
        expect(session.getState().items).toHaveLength(100);
    });
    it('retries a transient failure but requires explicit refresh for an expired cursor', async () => {
        const readPage = vi
            .fn<TelemetryHistoryClient['readPage']>()
            .mockResolvedValueOnce(page())
            .mockResolvedValueOnce({
                kind: 'unavailable',
                error: { error: 'durable_history_unavailable', message: 'offline' },
            })
            .mockResolvedValueOnce({
                kind: 'cursor_error',
                error: { error: 'cursor_expired', message: 'expired' },
            })
            .mockResolvedValueOnce(page(300, 1, null));
        const session = createTelemetrySearchSession('temp-desk', { readPage }, () => instant);
        await session.search({});
        await session.loadMore();
        await session.retry();
        await session.retry();
        expect(readPage).toHaveBeenCalledTimes(3);
        expect(session.getState().refreshRequired).toBe(true);
        await session.refresh();
        expect(session.getState().status).toBe('ready');
    });
    it('bounds the durable cache to 10,000 samples without claiming a remote end', async () => {
        let number = 0;
        const readPage = vi.fn<TelemetryHistoryClient['readPage']>(async () =>
            page(10000 - 100 * number++, 100, `cursor-${number}`),
        );
        const session = createTelemetrySearchSession('temp-desk', { readPage }, () => instant);
        await session.search({});

        for (let i = 1; i < 101; i++) {
            await session.loadMore();
        }

        expect(readPage).toHaveBeenCalledTimes(100);
        expect(session.getState()).toMatchObject({ limitReached: true, endReached: false });
        expect(session.getState().items).toHaveLength(10000);
    });
});
