import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import { describe, expect, it, vi } from 'vitest';

import { createRoomHistorySession } from './room-history-session';

const fixtures = createHistoryIdentityFixtures();
const storage = {
    status: 'available' as const,
    changedAt: '2026-09-10T10:00:00.000Z',
    historyGenerationId: fixtures.significantFactPage.historyGenerationId,
    storedThroughSequence: fixtures.significantFactPage.throughSequence,
};

function response(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

function deferredResponse(): { promise: Promise<Response>; resolve(value: Response): void } {
    let resolve: (value: Response) => void = () => {
        throw new Error('Deferred response was not initialized.');
    };

    const promise = new Promise<Response>((complete) => {
        resolve = complete;
    });

    return { promise, resolve: (value) => resolve(value) };
}

describe('telemetry history session', () => {
    it('bounds telemetry additions to 100 and filters another device and out-of-range time', () => {
        const session = createRoomHistorySession({
            kind: 'telemetry',
            deviceId: 'temp-desk',
            metric: 'temperature',
            from: '2026-09-10T09:55:00.000Z',
            to: '2026-09-10T10:05:00.000Z',
        });
        session.acceptRealtime({ kind: 'baseline', storage, userHistory: [] });

        for (let index = 0; index < 101; index += 1) {
            session.acceptRealtime({
                kind: 'addition',
                storage,
                telemetrySample: {
                    ...fixtures.telemetrySample,
                    recordId: `rec:v1:sha256:${index.toString(16).padStart(64, '0')}`,
                },
            });
        }

        session.acceptRealtime({
            kind: 'addition',
            storage,
            telemetrySample: { ...fixtures.telemetrySample, deviceId: 'temp-window' },
        });
        session.acceptRealtime({
            kind: 'addition',
            storage,
            telemetrySample: {
                ...fixtures.telemetrySample,
                occurredAt: '2026-09-10T10:05:00.000Z',
            },
        });

        expect(session.getState().items).toHaveLength(100);
        expect(
            session.getState().items.some((item) => item.recordId.endsWith('0'.repeat(64))),
        ).toBe(false);
    });

    it('reads a validated telemetry page and merges its matching live sample', async () => {
        const read = vi.fn().mockResolvedValue(response(fixtures.rawTelemetryPage));
        const session = createRoomHistorySession(
            {
                kind: 'telemetry',
                deviceId: 'temp-desk',
                metric: 'temperature',
                from: '2026-09-10T09:55:00.000Z',
                to: '2026-09-10T10:05:00.000Z',
                pageSize: 1,
            },
            read as typeof fetch,
        );
        session.acceptRealtime({ kind: 'baseline', storage, userHistory: [] });
        session.acceptRealtime({
            kind: 'addition',
            storage,
            telemetrySample: fixtures.telemetrySample,
        });

        await session.loadFirstPage();

        expect(session.getState()).toMatchObject({ status: 'ready', complete: true });
        expect(session.getState().items).toEqual([fixtures.telemetrySample]);
        expect(read.mock.calls[0]?.[0]).toContain('/room/history/telemetry?');
        expect(read.mock.calls[0]?.[0]).toContain('deviceId=temp-desk');
    });

    it('refetches the same telemetry range after reconnect', async () => {
        const read = vi
            .fn()
            .mockResolvedValueOnce(response(fixtures.rawTelemetryPage))
            .mockResolvedValueOnce(response(fixtures.rawTelemetryPage));
        const session = createRoomHistorySession(
            {
                kind: 'telemetry',
                deviceId: 'temp-desk',
                metric: 'temperature',
                from: '2026-09-10T09:55:00.000Z',
                to: '2026-09-10T10:05:00.000Z',
                pageSize: 1,
            },
            read as typeof fetch,
        );
        session.acceptRealtime({ kind: 'baseline', storage, userHistory: [] });
        await session.loadFirstPage();
        session.connectionInterrupted();
        session.acceptRealtime({ kind: 'baseline', storage, userHistory: [] });

        await vi.waitFor(() => expect(session.getState().status).toBe('ready'));

        expect(read).toHaveBeenCalledTimes(2);
        expect(read.mock.calls[1]?.[0]).toContain('deviceId=temp-desk');
        expect(read.mock.calls[1]?.[0]).toContain('metric=temperature');
        expect(read.mock.calls[1]?.[0]).toContain('from=2026-09-10T09%3A55%3A00Z');
        expect(read.mock.calls[1]?.[0]).toContain('to=2026-09-10T10%3A05%3A00Z');
        expect(session.getState().items).toEqual([fixtures.telemetrySample]);
    });

    it('preserves the previous telemetry view and new samples when reconnect refetch returns 503', async () => {
        const unavailable = deferredResponse();
        const read = vi
            .fn()
            .mockResolvedValueOnce(response(fixtures.rawTelemetryPage))
            .mockReturnValueOnce(unavailable.promise);
        const session = createRoomHistorySession(
            {
                kind: 'telemetry',
                deviceId: 'temp-desk',
                metric: 'temperature',
                from: '2026-09-10T09:55:00.000Z',
                to: '2026-09-10T10:05:00.000Z',
                pageSize: 1,
            },
            read as typeof fetch,
        );
        session.acceptRealtime({ kind: 'baseline', storage, userHistory: [] });
        await session.loadFirstPage();
        session.connectionInterrupted();
        session.acceptRealtime({ kind: 'baseline', storage, userHistory: [] });

        const liveSample = {
            ...fixtures.telemetrySample,
            recordId: `rec:v1:sha256:${'f'.repeat(64)}`,
            storageSequence: fixtures.telemetrySample.storageSequence + 1,
            value: 23,
        };
        session.acceptRealtime({ kind: 'addition', storage, telemetrySample: liveSample });
        unavailable.resolve(response({ error: 'durable_history_unavailable' }, 503));
        await vi.waitFor(() => expect(session.getState().status).toBe('error'));

        expect(session.getState()).toMatchObject({ error: 'history_unavailable', complete: false });
        expect(session.getState().items.map((item) => item.recordId)).toEqual([
            liveSample.recordId,
            fixtures.telemetrySample.recordId,
        ]);
    });
});
