import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { RoomBffRealtimeServerMessage } from '@smart-room/contracts/room-bff';
import { isUserHistoryPage, type UserHistoryItem } from '@smart-room/contracts/user-history';
import { describe, expect, it } from 'vitest';

import {
    type BackendIntegrationRuntime,
    createBackendIntegrationRuntime,
} from './backend-integration-runtime';

function entries(message: RoomBffRealtimeServerMessage): UserHistoryItem[] {
    return message.messageType === 'device.updated'
        ? 'userHistory' in message
            ? message.userHistory
            : []
        : (message.payload.userHistory ?? []);
}

async function page(backend: BackendIntegrationRuntime, params: Record<string, string> = {}) {
    const response = await backend.request(
        '/room/history/user-history?' + new URLSearchParams(params),
    );
    expect(response.status).toBe(200);

    if (!isUserHistoryPage(response.body)) {
        throw new Error('Expected valid history page');
    }

    return response.body;
}

async function all(backend: BackendIntegrationRuntime, params: Record<string, string> = {}) {
    const items: UserHistoryItem[] = [];
    let cursor: string | undefined;

    do {
        const response = await page(backend, { ...params, ...(cursor ? { cursor } : {}) });
        items.push(...response.items);
        cursor = response.nextCursor ?? undefined;
    } while (cursor);

    return items;
}

async function transitions(backend: BackendIntegrationRuntime) {
    backend.clock.advanceBy(1000);
    backend.sources.desk.scenario.reportAvailability('online', backend.clock.now());
    const stream = await backend.connectSse();
    const result: UserHistoryItem[] = [];

    for (const availability of ['offline', 'online'] as const) {
        const mark = stream.messages.length;
        backend.clock.advanceBy(1000);
        backend.sources.desk.scenario.reportAvailability(availability, backend.clock.now());
        const message = await stream.waitFor(
            (candidate) =>
                entries(candidate).some(
                    (item) => item.kind === 'availability_changed' && item.current === availability,
                ),
            mark,
        );
        result.push(...entries(message).filter((item) => item.kind === 'availability_changed'));
    }

    return result.reverse();
}

describe('processing evidence history acceptance', () => {
    it('AC-1 maps native offline/online identically in live SSE, HTTP, SSE bootstrap and device-only search', async () => {
        const backend = await createBackendIntegrationRuntime();
        const expected = await transitions(backend);
        expect(expected).toMatchObject([
            { previous: 'offline', current: 'online' },
            { previous: 'online', current: 'offline' },
        ]);
        const ids = new Set(expected.map((item) => item.recordId));
        const select = (items: UserHistoryItem[]) => items.filter((item) => ids.has(item.recordId));
        expect(select((await backend.snapshot()).userHistory)).toEqual(expected);
        const bootstrap = await backend.connectSse();
        const snapshot = bootstrap.messages[0];

        if (!snapshot) {
            throw new Error('Expected SSE bootstrap snapshot');
        }

        expect(select(entries(snapshot))).toEqual(expected);
        expect(select(await all(backend, { deviceId: 'temp-desk' }))).toEqual(expected);
        expect(select(await all(backend, { deviceId: 'temp-window' }))).toEqual([]);
        const [online, offline] = expected;

        if (!online || !offline) {
            throw new Error('Expected both transitions');
        }

        expect(
            await all(backend, {
                deviceId: 'temp-desk',
                from: offline.occurredAt,
                to: online.occurredAt,
            }),
        ).toEqual([offline]);
    });

    it('AC-2 keeps identities beyond the twenty-record cache and through a real backend restart and sparse pages', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-history-restart-'));
        const databasePath = join(directory, 'room.sqlite');
        let backend = await createBackendIntegrationRuntime({ databasePath });

        try {
            const expected = await transitions(backend);
            const generation = backend.historyGenerationId;

            for (let index = 0; index < 24; index++) {
                backend.clock.advanceBy(1000);
                backend.sources.window.scenario.reportAvailability(
                    index % 2 ? 'online' : 'offline',
                    backend.clock.now(),
                );
            }

            expect(
                (await backend.snapshot()).userHistory.some((item) =>
                    expected.some((old) => old.recordId === item.recordId),
                ),
            ).toBe(false);
            const first = await page(backend, { deviceId: 'temp-desk', pageSize: '1' });
            expect(first.items).toEqual([]);
            expect(first.nextCursor).not.toBeNull();
            const before = await all(backend, { deviceId: 'temp-desk', pageSize: '1' });
            expect(before.slice(0, 2)).toEqual(expected);
            const start = backend.clock.now();
            await backend.close();
            backend = await createBackendIntegrationRuntime({ databasePath, start });
            expect(backend.historyGenerationId).toBe(generation);
            expect(await all(backend, { deviceId: 'temp-desk', pageSize: '1' })).toEqual(before);
        } finally {
            await backend.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    for (const outcome of ['timeout', 'failed'] as const) {
        it('AC-5 retains ' + outcome + ' intent after the request leaves retention', async () => {
            const backend = await createBackendIntegrationRuntime();
            backend.clock.advanceBy(1000);
            backend.led().scenario.reportAvailability('online', backend.clock.now());
            const requestedAt = backend.clock.now();
            const response = await backend.request('/room/commands', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            });
            expect(response.status).toBe(202);

            if (outcome === 'timeout') {
                backend.clock.advanceBy(5001);
            } else {
                backend.clock.advanceBy(2000);
                const command = backend.led().received.at(-1);

                if (!command) {
                    throw new Error('Missing dispatched command');
                }

                backend.led().reject(command, backend.clock.now());
            }

            const kind = outcome === 'timeout' ? 'confirmation_missing' : 'attempt_failed';
            const original = (await all(backend)).find((item) => item.kind === kind);
            expect(original).toMatchObject({ requestedPower: 'on' });
            backend.clock.advanceBy(
                Date.parse(requestedAt) + 30 * 86400000 + 1 - Date.parse(backend.clock.now()),
            );
            backend.sources.window.scenario.reportAvailability('online', backend.clock.now());
            expect(
                backend.storage
                    .listSignificantFacts()
                    .some((fact) => fact.eventType === 'command.requested'),
            ).toBe(false);
            expect((await all(backend)).find((item) => item.kind === kind)).toEqual(original);
        });
    }

    it('AC-6 promotes a cached volatile change with its original evidence and no duplicate logical entry', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1000);
        backend.sources.desk.scenario.reportAvailability('online', backend.clock.now());
        const stream = await backend.connectSse();
        backend.setStorageFailing(true);
        backend.clock.advanceBy(1000);
        const report = backend.sources.desk.scenario.reportAvailability(
            'offline',
            backend.clock.now(),
        );
        const live = await stream.waitFor((message) =>
            entries(message).some(
                (item) => item.kind === 'availability_changed' && item.durability === 'volatile',
            ),
        );
        const original = entries(live).find((item) => item.kind === 'availability_changed');
        expect(original).toMatchObject({ previous: 'online', current: 'offline' });
        backend.setStorageFailing(false);
        backend.clock.advanceBy(1000);
        backend.runStorageRecovery();
        const mark = stream.messages.length;
        backend.sources.desk.emitAvailability(report);
        const promoted = await stream.waitFor(
            (message) =>
                entries(message).some(
                    (item) => item.recordId === original?.recordId && item.durability === 'durable',
                ),
            mark,
        );
        const durable = entries(promoted).find((item) => item.recordId === original?.recordId);
        expect(durable).toMatchObject({
            ...original,
            durability: 'durable',
            storageSequence: expect.any(Number),
        });
        const history = await all(backend, { deviceId: 'temp-desk' });
        expect(history.filter((item) => item.recordId === original?.recordId)).toEqual([durable]);
        backend.sources.desk.emitAvailability(report);
        expect(await all(backend, { deviceId: 'temp-desk' })).toEqual(history);
    });

    it('AC-6 retains a volatile original effect through cache eviction, recovery checkpoint and restart before source redelivery', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-history-restart-'));
        const databasePath = join(directory, 'room.sqlite');
        let backend = await createBackendIntegrationRuntime({ databasePath });

        try {
            const stream = await backend.connectSse();
            backend.setStorageFailing(true);
            backend.clock.advanceBy(1000);
            const report = backend.sources.desk.scenario.reportAvailability(
                'offline',
                backend.clock.now(),
            );
            const message = await stream.waitFor((candidate) =>
                entries(candidate).some(
                    (item) =>
                        item.kind === 'availability_changed' &&
                        item.durability === 'volatile' &&
                        item.deviceId === 'temp-desk',
                ),
            );
            const original = entries(message).find((item) => item.kind === 'availability_changed');
            expect(original).toMatchObject({ previous: 'online', current: 'offline' });

            for (let index = 0; index < 24; index++) {
                backend.clock.advanceBy(1000);
                backend.sources.window.scenario.reportAvailability(
                    index % 2 ? 'online' : 'offline',
                    backend.clock.now(),
                );
            }

            expect(
                (await backend.snapshot()).userHistory.some(
                    (item) => item.recordId === original?.recordId,
                ),
            ).toBe(false);
            backend.setStorageFailing(false);
            backend.clock.advanceBy(1000);
            backend.runStorageRecovery();
            const start = backend.clock.now();
            await backend.close();
            backend = await createBackendIntegrationRuntime({ databasePath, start });
            backend.sources.desk.emitAvailability(report);
            const history = await all(backend, { deviceId: 'temp-desk' });
            const retained = history.filter((item) => item.recordId === original?.recordId);
            expect(retained).toHaveLength(1);
            expect(retained[0]).toMatchObject({
                ...original,
                durability: 'durable',
                storageSequence: expect.any(Number),
            });
        } finally {
            await backend.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('AC-6 rejects a whole history read when present persisted evidence is corrupted', async () => {
        const backend = await createBackendIntegrationRuntime();
        const expected = await transitions(backend);
        const corrupted = expected[0];

        if (!corrupted) {
            throw new Error('Expected retained transition to corrupt');
        }

        const database = new DatabaseSync(join(backend.directory, 'room.sqlite'));

        try {
            database
                .prepare(
                    'UPDATE significant_facts SET processing_evidence_json = ? WHERE record_id = ?',
                )
                .run(JSON.stringify({ version: 99, kind: 'availability' }), corrupted.recordId);
        } finally {
            database.close();
        }

        const response = await backend.request('/room/history/user-history?deviceId=temp-desk');
        expect(response.status).toBe(500);
        expect(response.body).not.toHaveProperty('items');
    });
});
