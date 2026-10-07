import { isRawTelemetryPage } from '@smart-room/contracts/history';
import type { RoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';
import { isUserHistoryPage, type UserHistoryItem } from '@smart-room/contracts/user-history';
import { describe, expect, it } from 'vitest';

import {
    type BackendIntegrationRuntime,
    createBackendIntegrationRuntime,
} from './backend-integration-runtime';

describe('native-source history through backend SQLite and HTTP/SSE', () => {
    it('keeps HTTP pages pinned while SSE delivers native outcomes before, during and between page reads', async () => {
        const backend = await createBackendIntegrationRuntime();
        await seedAttempts(backend, 51);
        const stream = await backend.connectSse();
        await rejectAttempt(backend);
        const before = await liveAttempt(stream, 0);
        const response = await fetch(`${backend.baseUrl}/room/history/user-history`);
        const mark = stream.messages.length;
        await rejectAttempt(backend);
        const during = await liveAttempt(stream, mark);
        const body: unknown = await response.json();
        expect(response.status).toBe(200);

        if (!isUserHistoryPage(body) || !body.nextCursor) {
            throw new Error('Expected a pinned first page');
        }

        const betweenMark = stream.messages.length;
        await rejectAttempt(backend);
        const between = await liveAttempt(stream, betweenMark);
        const next = await userPage(backend, body.nextCursor);
        expect(next).toMatchObject({
            historyGenerationId: body.historyGenerationId,
            throughSequence: body.throughSequence,
            retentionAsOf: body.retentionAsOf,
        });
        const records = body.items.concat(next.items);
        expect(new Set(records.map((item) => item.recordId)).size).toBe(records.length);
        expect(records.find((item) => item.recordId === before.recordId)).toEqual(before);
        expect(
            records.some(
                (item) => item.recordId === during.recordId || item.recordId === between.recordId,
            ),
        ).toBe(false);
        expect(new Set([before.recordId, during.recordId, between.recordId]).size).toBe(3);
        expect(before.durability).toBe('durable');
    });

    it('rejects a fixed expired cursor and serves a fresh pinned baseline', async () => {
        const backend = await createBackendIntegrationRuntime();
        await seedAttempts(backend, 51);
        const first = await userPage(backend);

        if (!first.nextCursor) {
            throw new Error('Expected continuation cursor');
        }

        backend.clock.advanceBy(300001);
        const expired = await backend.request(
            `/room/history/user-history?cursor=${encodeURIComponent(first.nextCursor)}`,
        );
        expect(expired).toMatchObject({ status: 400, body: { error: 'cursor_expired' } });
        const fresh = await userPage(backend);
        expect(fresh.historyGenerationId).toBe(first.historyGenerationId);
        expect(fresh.retentionAsOf).not.toBe(first.retentionAsOf);
    });

    it('gives a same-generation reconnect a current revision-zero baseline and subsequent contiguous updates', async () => {
        const backend = await createBackendIntegrationRuntime();
        const first = await backend.connectSse();
        backend.clock.advanceBy(1000);
        backend.sources.desk.read(25, backend.clock.now());
        await first.waitFor((message) => message.messageType === 'device.updated');
        await first.close();
        const reconnected = await backend.connectSse();
        expect(reconnected.messages[0]).toMatchObject({
            messageType: 'room.snapshot',
            revision: 0,
            payload: {
                platform: { storage: { historyGenerationId: backend.historyGenerationId } },
            },
        });
        expect(reconnected.messages[0]?.payload).toEqual(await backend.snapshot());
        backend.clock.advanceBy(1000);
        backend.sources.window.read(19, backend.clock.now());
        expect(
            await reconnected.waitFor((message) => message.messageType === 'device.updated'),
        ).toMatchObject({
            previousRevision: 0,
            revision: 1,
            payload: { deviceId: 'temp-window' },
        });
    });

    it('rejects an old-generation cursor and exposes only replacement evidence in HTTP and SSE', async () => {
        const original = await createBackendIntegrationRuntime();
        await seedAttempts(original, 51);
        const old = await userPage(original);

        if (!old.nextCursor) {
            throw new Error('Expected original cursor');
        }

        const replacement = await createBackendIntegrationRuntime();
        await seedAttempts(replacement, 2);
        const next = await userPage(replacement);
        const rejected = await replacement.request(
            `/room/history/user-history?cursor=${encodeURIComponent(old.nextCursor)}`,
        );
        expect(rejected.status).toBe(400);
        expect(next.historyGenerationId).not.toBe(old.historyGenerationId);
        const ids = new Set(old.items.map((item) => item.recordId));
        expect(next.items.some((item) => ids.has(item.recordId))).toBe(false);
        const stream = await replacement.connectSse();
        expect(stream.messages[0]).toMatchObject({
            messageType: 'room.snapshot',
            payload: { platform: { storage: { historyGenerationId: next.historyGenerationId } } },
        });
        expect(historyEntries(stream.messages[0]).some((item) => ids.has(item.recordId))).toBe(
            false,
        );
    });

    it('returns 503 after a continuation read failure, publishes degradation and serves history after recovery', async () => {
        const backend = await createBackendIntegrationRuntime();
        await seedAttempts(backend, 51);
        const stream = await backend.connectSse();
        const first = await userPage(backend);

        if (!first.nextCursor) {
            throw new Error('Expected continuation cursor');
        }

        backend.setReadsFailing(true);
        const failed = await backend.request(
            `/room/history/user-history?cursor=${encodeURIComponent(first.nextCursor)}`,
        );
        expect(failed).toMatchObject({
            status: 503,
            body: { error: 'durable_history_unavailable' },
        });
        await stream.waitFor(
            (message) =>
                message.messageType === 'platform.updated' &&
                message.payload.storage.status === 'degraded',
        );
        expect((await backend.request('/room/history/user-history')).status).toBe(503);
        backend.setReadsFailing(false);
        backend.clock.advanceBy(1000);
        backend.runStorageRecovery();
        await stream.waitFor(
            (message) =>
                message.messageType === 'platform.updated' &&
                message.payload.storage.status === 'available',
        );
        const recovered = await userPage(backend);
        expect(recovered.historyGenerationId).toBe(first.historyGenerationId);
        const continuation = recovered.nextCursor
            ? await userPage(backend, recovered.nextCursor)
            : null;
        expect(
            recovered.items.concat(continuation?.items ?? []).map((item) => item.recordId),
        ).toEqual(expect.arrayContaining(first.items.map((item) => item.recordId)));
    });

    it('continues volatile native observations through storage failure and publishes a durable recovery gap', async () => {
        const backend = await createBackendIntegrationRuntime();
        const stream = await backend.connectSse();
        backend.setStorageFailing(true);
        backend.clock.advanceBy(1000);
        backend.led().scenario.reportAvailability('offline', backend.clock.now());
        const volatile = await stream.waitFor((message) =>
            historyEntries(message).some((item) => item.durability === 'volatile'),
        );
        expect(historyEntries(volatile).every((item) => item.durability === 'volatile')).toBe(true);
        expect((await backend.request('/room/history/user-history')).status).toBe(503);
        backend.setStorageFailing(false);
        backend.clock.advanceBy(1000);
        backend.runStorageRecovery();
        const available = await stream.waitFor(
            (message) =>
                message.messageType === 'platform.updated' &&
                message.payload.storage.status === 'available',
        );
        expect(historyEntries(available)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'history_gap', durability: 'durable' }),
            ]),
        );
        const page = await userPage(backend);
        expect(page.historyGenerationId).toBe(backend.historyGenerationId);
        expect(page.items).toEqual(
            expect.arrayContaining([expect.objectContaining({ kind: 'history_gap' })]),
        );
        const volatileIds = new Set(historyEntries(volatile).map((item) => item.recordId));
        expect(page.items.some((item) => volatileIds.has(item.recordId))).toBe(false);
        expect(page.throughSequence).toBeGreaterThan(0);
    });

    it('keeps telemetry HTTP/SSE identities and pinned bounds through native updates, outage and recovery', async () => {
        const backend = await createBackendIntegrationRuntime();
        const stream = await backend.connectSse();

        const emit = async () => {
            const after = stream.messages.length;
            backend.clock.advanceBy(1000);
            backend.sources.desk.read(25, backend.clock.now());
            const message = await stream.waitFor(
                (candidate) =>
                    candidate.messageType === 'device.updated' && 'telemetrySample' in candidate,
                after,
            );

            if (message.messageType !== 'device.updated' || !('telemetrySample' in message)) {
                throw new Error('Expected live telemetry');
            }

            return message.telemetrySample;
        };

        const read = async (cursor?: string) => {
            const query = new URLSearchParams({
                deviceId: 'temp-desk',
                metric: 'temperature',
                pageSize: '1',
                from: '2026-09-26T09:00:00.000Z',
                to: '2026-09-26T12:00:00.000Z',
            });

            if (cursor) {
                query.set('cursor', cursor);
            }

            return backend.request(`/room/history/telemetry?${query}`);
        };

        const before = await emit();
        const first = await read();

        if (!isRawTelemetryPage(first.body) || !first.body.nextCursor) {
            throw new Error('Expected pinned telemetry page');
        }

        const during = await emit();
        const between = await emit();
        const next = await read(first.body.nextCursor);

        if (!isRawTelemetryPage(next.body)) {
            throw new Error('Invalid telemetry continuation');
        }

        expect(first.body.items[0]).toMatchObject({ ...before, occurredAt: expect.any(String) });
        expect(Date.parse(first.body.items[0]?.occurredAt ?? '')).toBe(
            Date.parse(before.occurredAt),
        );
        expect(next.body).toMatchObject({
            historyGenerationId: first.body.historyGenerationId,
            throughSequence: first.body.throughSequence,
            retentionAsOf: first.body.retentionAsOf,
        });
        expect(
            first.body.items
                .concat(next.body.items)
                .some(
                    (item) =>
                        item.recordId === during.recordId || item.recordId === between.recordId,
                ),
        ).toBe(false);
        const index = stream.messages.findIndex(
            (message) =>
                message.messageType === 'device.updated' &&
                'telemetrySample' in message &&
                message.telemetrySample.recordId === before.recordId,
        );
        await stream.waitFor(
            (message) =>
                message.messageType === 'platform.updated' &&
                message.previousRevision === stream.messages[index]?.revision,
        );
        expect(stream.messages[index + 1]).toMatchObject({
            messageType: 'platform.updated',
            previousRevision: stream.messages[index]?.revision,
        });
        expect(new Set([before.recordId, during.recordId, between.recordId]).size).toBe(3);
        backend.setStorageFailing(true);
        const volatile = await emit();
        expect(volatile.durability).toBe('volatile');
        expect((await read()).status).toBe(503);
        backend.setStorageFailing(false);
        backend.clock.advanceBy(1000);
        backend.runStorageRecovery();
        await stream.waitFor(
            (message) =>
                message.messageType === 'platform.updated' &&
                message.payload.storage.status === 'available',
        );
        const recovered = await read();
        expect(recovered.status).toBe(200);

        if (!isRawTelemetryPage(recovered.body)) {
            throw new Error('Invalid recovered telemetry');
        }

        expect(recovered.body.historyGenerationId).toBe(first.body.historyGenerationId);
        expect(recovered.body.items.some((item) => item.recordId === volatile.recordId)).toBe(
            false,
        );
    });
});

async function seedAttempts(backend: BackendIntegrationRuntime, count: number) {
    backend.clock.advanceBy(1);
    backend.led().scenario.reportAvailability('offline', backend.clock.now());

    for (let index = 0; index < count; index++) {
        await rejectAttempt(backend);
    }
}

async function rejectAttempt(backend: BackendIntegrationRuntime) {
    backend.clock.advanceBy(1);
    const rejected = await backend.request('/room/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        }),
    });
    expect(rejected.status).toBe(422);
}

async function userPage(backend: BackendIntegrationRuntime, cursor?: string) {
    const response = await backend.request(
        `/room/history/user-history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    expect(response.status).toBe(200);

    if (!isUserHistoryPage(response.body)) {
        throw new Error('Invalid user history page');
    }

    return response.body;
}

function historyEntries(message: RoomBffRealtimeServerMessage | undefined): UserHistoryItem[] {
    if (!message) {
        return [];
    }

    if (message.messageType === 'device.updated') {
        return 'userHistory' in message ? message.userHistory : [];
    }

    return message.payload.userHistory ?? [];
}

async function liveAttempt(
    stream: Awaited<ReturnType<BackendIntegrationRuntime['connectSse']>>,
    after: number,
) {
    const message = await stream.waitFor(
        (candidate) => historyEntries(candidate).some((item) => item.kind === 'attempt_failed'),
        after,
    );
    const entry = historyEntries(message).find((item) => item.kind === 'attempt_failed');

    if (!entry) {
        throw new Error('Missing live rejected attempt');
    }

    return entry;
}
