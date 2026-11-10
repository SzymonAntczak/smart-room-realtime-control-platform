import { isRawTelemetryPage } from '@smart-room/contracts/history';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { describe, expect, it } from 'vitest';

import { MockTelemetryHistory } from './mock-telemetry-history';

const { rawTelemetryPage: baseline, telemetrySample } = createHistoryIdentityFixtures();
const first = { ...baseline, nextCursor: 'older' };
const last = {
    ...baseline,
    items: [
        {
            ...telemetrySample,
            recordId: `rec:v1:sha256:${'d'.repeat(64)}`,
            storageSequence: 6,
            occurredAt: '2026-09-10T09:58:00.000Z',
        },
    ],
};
const cursorError = { error: 'cursor_expired', message: 'Expired' };

function query(options: Record<string, string> = {}) {
    const url = new URL('http://localhost/room/history/telemetry');
    url.search = new URLSearchParams({
        deviceId: 'temp-desk',
        metric: 'temperature',
        from: '2026-09-10T09:55:00Z',
        to: '2026-09-10T10:05:00Z',
        pageSize: '1',
        ...options,
    }).toString();

    return url;
}

describe('scripted telemetry history boundary', () => {
    it('serves the scripted cursor chain and validates its requested scope', async () => {
        const history = new MockTelemetryHistory();
        history.configure({ pages: [first, last] });

        await expect(history.read(query(), baseline)).resolves.toEqual({
            status: 200,
            body: first,
        });
        await expect(history.read(query({ cursor: 'older' }), baseline)).resolves.toEqual({
            status: 200,
            body: last,
        });
        expect(() => history.read(query({ cursor: 'unknown' }), baseline)).toThrow(
            'requested scope',
        );
        expect(() => history.read(query({ deviceId: 'temp-window' }), baseline)).toThrow(
            'requested scope',
        );
        expect(() => history.read(query({ to: '2026-09-10T10:00:00Z' }), baseline)).toThrow(
            'requested scope',
        );
        expect(() => history.read(query({ metric: 'power' }), baseline)).toThrow('history query');
        const duplicate = query();
        duplicate.searchParams.append('pageSize', '1');
        expect(() => history.read(duplicate, baseline)).toThrow('history query');
    });

    it('rejects invalid pages, inconsistent continuation pins and invalid cursor errors', () => {
        const history = new MockTelemetryHistory();

        expect(() => history.configure({ pages: [{ ...first, items: [] }, last] })).toThrow(
            'Invalid mock telemetry history pages',
        );
        expect(() =>
            history.configure({ pages: [first, { ...last, throughSequence: 99 }] }),
        ).toThrow('Inconsistent mock telemetry history pages');
        expect(() => history.configure({ pages: [first] })).toThrow(
            'Inconsistent mock telemetry history pages',
        );
        expect(() => history.configure({ error: { error: 'unexpected' } })).toThrow(
            'Invalid mock telemetry history error',
        );
    });

    it('holds captured responses, arms the next hold before release and consumes errors once', async () => {
        const history = new MockTelemetryHistory();
        history.configure({ pages: [first, last], hold: true });
        const pending = history.read(query(), baseline);
        expect(history.hasHeldResponse()).toBe(true);

        history.configure({ pages: [baseline], error: cursorError, hold: true, release: true });
        await expect(pending).resolves.toEqual({ status: 200, body: first });
        expect(history.hasHeldResponse()).toBe(false);

        const next = history.read(query({ cursor: 'older' }), baseline);
        expect(history.hasHeldResponse()).toBe(true);
        history.configure({ release: true });
        await expect(next).resolves.toEqual({ status: 400, body: cursorError });
        await expect(history.read(query(), baseline)).resolves.toEqual({
            status: 200,
            body: baseline,
        });
    });

    it('releases pending reads on reset and provides a contract-valid empty baseline', async () => {
        const history = new MockTelemetryHistory();
        history.configure({ pages: [baseline], hold: true });
        const pending = history.read(query(), baseline);
        history.configure({ error: cursorError, hold: true });
        history.reset();

        await expect(pending).resolves.toEqual({ status: 200, body: baseline });
        expect(history.hasHeldResponse()).toBe(false);
        const response = await history.read(query({ pageSize: '100' }), {
            historyGenerationId: baseline.historyGenerationId,
            throughSequence: baseline.throughSequence,
        });
        expect(response.status).toBe(200);
        expect(isRawTelemetryPage(response.body)).toBe(true);
        expect(response.body).toMatchObject({ items: [], pageSize: 100, nextCursor: null });
    });
});
