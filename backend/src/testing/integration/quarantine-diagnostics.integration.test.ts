import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isDurableDiagnosticsSnapshot } from '@smart-room/contracts/diagnostics';
import { describe, expect, it } from 'vitest';

import { createBackendIntegrationRuntime } from './backend-integration-runtime';

describe('persisted quarantine through native input and diagnostics HTTP', () => {
    it('returns metadata after restart without changing accepted history, feed or watermark', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-diagnostics-restart-'));
        const databasePath = join(directory, 'room.sqlite');
        const backend = await createBackendIntegrationRuntime({ databasePath });
        let restarted: Awaited<ReturnType<typeof createBackendIntegrationRuntime>> | undefined;

        try {
            expect(await backend.request('/diagnostics')).toEqual({
                status: 200,
                body: {
                    historyGenerationId: backend.historyGenerationId,
                    entries: [],
                },
            });
            backend.clock.advanceBy(1);
            const reading = backend.sources.desk.read(22.5, backend.clock.now());
            backend.sources.desk.emitReading(reading);
            const before = await backend.snapshot();
            const facts = backend.storage.listSignificantFacts();
            const response = await backend.request('/diagnostics');
            expect(response.status).toBe(200);
            expect(isDurableDiagnosticsSnapshot(response.body)).toBe(true);
            expect(response.body).toMatchObject({
                entries: [
                    {
                        reason: 'duplicate_event',
                        deviceId: 'temp-desk',
                        recordedAt: backend.clock.now(),
                    },
                ],
            });
            expect(JSON.stringify(response.body)).not.toMatch(/rawEvent|payload/);
            expect((await backend.snapshot()).userHistory).toEqual(before.userHistory);
            expect((await backend.snapshot()).platform.storage).toEqual(before.platform.storage);
            expect(backend.storage.listSignificantFacts()).toEqual(facts);
            await backend.close();
            restarted = await createBackendIntegrationRuntime({
                databasePath,
                start: backend.clock.now(),
            });
            expect(await restarted.request('/diagnostics')).toEqual(response);
        } finally {
            await restarted?.close();
            await backend.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('returns 503 on a diagnostics transaction failure and resumes persisted reads after recovery', async () => {
        const backend = await createBackendIntegrationRuntime();
        backend.clock.advanceBy(1);
        const reading = backend.sources.desk.read(22, backend.clock.now());
        backend.sources.desk.emitReading(reading);
        const persisted = await backend.request('/diagnostics');
        backend.setStorageFailing(true);
        expect(await backend.request('/diagnostics')).toEqual({
            status: 503,
            body: {
                error: 'durable_history_unavailable',
                message: 'Durable history is currently unavailable.',
            },
        });
        expect((await backend.snapshot()).platform.storage.status).toBe('degraded');
        backend.sources.desk.emitReading(reading);
        expect((await backend.request('/diagnostics')).status).toBe(503);
        backend.setStorageFailing(false);
        backend.runStorageRecovery();
        expect((await backend.snapshot()).platform.storage.status).toBe('available');
        expect(await backend.request('/diagnostics')).toEqual(persisted);
    });
});
