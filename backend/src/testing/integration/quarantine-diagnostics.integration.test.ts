import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isDurableDiagnosticsSnapshot } from '@smart-room/contracts/diagnostics';
import { isRawTelemetryPage, isSignificantFactPage } from '@smart-room/contracts/history';
import { isUserHistoryPage } from '@smart-room/contracts/user-history';
import type { TemperatureReadingMessage } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import {
    type BackendIntegrationRuntime,
    createBackendIntegrationRuntime,
} from './backend-integration-runtime';

const rejectedInputs = [
    {
        reason: 'duplicate_event',
        emit(backend: BackendIntegrationRuntime, accepted: TemperatureReadingMessage) {
            backend.sources.desk.emitReading(accepted);

            return accepted;
        },
    },
    {
        reason: 'malformed_event',
        emit(backend: BackendIntegrationRuntime, accepted: TemperatureReadingMessage) {
            const reading = {
                ...accepted,
                messageId: `${accepted.messageId}-malformed`,
                recordedAt: 'not-a-timestamp',
            };
            backend.sources.desk.emitReading(reading);

            return reading;
        },
    },
    {
        reason: 'invalid_payload',
        emit(backend: BackendIntegrationRuntime) {
            return backend.sources.desk.scenario.emitInvalidReading(backend.clock.now());
        },
    },
    {
        reason: 'future_dated_report',
        emit(backend: BackendIntegrationRuntime) {
            return backend.sources.desk.scenario.emitFutureDatedReading(
                new Date(Date.parse(backend.clock.now()) + 2_000).toISOString(),
            );
        },
    },
] as const;

describe('persisted quarantine through native input and diagnostics HTTP', () => {
    it.each(rejectedInputs)(
        'records $reason without applying it to projections, accepted history or HTTP/SSE feed',
        async ({ reason, emit }) => {
            const backend = await createBackendIntegrationRuntime();
            backend.clock.advanceBy(1);
            const accepted = backend.sources.desk.read(22.5, backend.clock.now());
            backend.sources.desk.scenario.reportHealth(
                'degraded',
                'sensor_fault',
                backend.clock.now(),
            );
            const stream = await backend.connectSse();
            const before = await acceptedState(backend);
            expect(before.userHistory.items.length).toBeGreaterThan(0);
            expect(before.significantFacts.items.length).toBeGreaterThan(0);
            expect(before.telemetry.items.length).toBeGreaterThan(0);
            expect(await diagnostics(backend)).toEqual({
                historyGenerationId: backend.historyGenerationId,
                entries: [],
            });
            const logMark = backend.logs.length;
            const streamMark = stream.messages.length;
            expect(stream.messages.at(-1)?.revision).toBe(0);

            const rejected = emit(backend, accepted);
            const eventId = `simulator-adapter:temp-desk-native:${rejected.messageId}`;
            const metadata = {
                eventId,
                eventType: 'telemetry.reading.recorded',
                deviceId: 'temp-desk',
                source: 'simulator-adapter',
                reason,
                recordedAt: backend.clock.now(),
                ...(reason === 'malformed_event' ? {} : { occurredAt: rejected.recordedAt }),
            };
            const diagnostic = await diagnostics(backend);
            expect(diagnostic).toEqual({
                historyGenerationId: backend.historyGenerationId,
                entries: [{ internalSequence: expect.any(Number), ...metadata }],
            });
            expect(backend.storage.listQuarantineEntries()).toEqual([
                expect.objectContaining({ eventId, reason, recordedAt: backend.clock.now() }),
            ]);
            expect(backend.logs.slice(logMark)).toEqual([
                {
                    event: 'platform_event_rejected',
                    eventId,
                    deviceId: 'temp-desk',
                    source: 'simulator-adapter',
                    reason,
                },
            ]);
            expect(await acceptedState(backend)).toEqual(before);

            // The next accepted native input is an ordered barrier for prior SSE writes.
            backend.clock.advanceBy(1);
            backend.sources.window.read(19.5, backend.clock.now());
            const afterControl = await backend.snapshot();
            await stream.waitFor(
                (message) =>
                    message.messageType === 'platform.updated' &&
                    message.payload.storage.storedThroughSequence ===
                        afterControl.platform.storage.storedThroughSequence,
                streamMark,
            );
            expect(stream.messages.slice(streamMark)).toEqual([
                {
                    messageType: 'device.updated',
                    previousRevision: 0,
                    revision: 1,
                    sentAt: backend.clock.now(),
                    payload: afterControl.devices.find(
                        (device) => device.deviceId === 'temp-window',
                    ),
                    telemetrySample: expect.objectContaining({
                        deviceId: 'temp-window',
                        value: 19.5,
                        occurredAt: backend.clock.now(),
                        durability: 'durable',
                        storageSequence: afterControl.platform.storage.storedThroughSequence,
                    }),
                },
                {
                    messageType: 'platform.updated',
                    previousRevision: 1,
                    revision: 2,
                    sentAt: backend.clock.now(),
                    payload: { storage: afterControl.platform.storage },
                },
            ]);
            expect(afterControl.userHistory).toEqual(before.snapshot.userHistory);
        },
    );

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
            const before = await acceptedState(backend);

            for (const rejected of rejectedInputs) {
                rejected.emit(backend, reading);
            }

            const response = await backend.request('/diagnostics');
            expect(response.status).toBe(200);
            const persisted = await diagnostics(backend);
            expect(response.body).toEqual(persisted);
            expect(persisted.entries.map((entry) => entry.reason)).toEqual(
                rejectedInputs.map((input) => input.reason).reverse(),
            );
            expect(await acceptedState(backend)).toEqual(before);
            await backend.close();
            restarted = await createBackendIntegrationRuntime({
                databasePath,
                start: backend.clock.now(),
            });
            expect(await restarted.request('/diagnostics')).toEqual(response);
            expect(await diagnostics(restarted)).toEqual(persisted);
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

async function diagnostics(backend: BackendIntegrationRuntime) {
    const response = await backend.request('/diagnostics');
    expect(response.status).toBe(200);

    if (!isDurableDiagnosticsSnapshot(response.body)) {
        throw new Error('Expected valid durable diagnostics');
    }

    for (const entry of response.body.entries) {
        expect(entry).not.toHaveProperty('rawEvent');
        expect(entry).not.toHaveProperty('payload');
    }

    return response.body;
}

async function historyPage<T>(
    backend: BackendIntegrationRuntime,
    path: string,
    validate: (value: unknown) => value is T,
) {
    const response = await backend.request(path);
    expect(response.status).toBe(200);

    if (!validate(response.body)) {
        throw new Error(`Expected valid history response for ${path}`);
    }

    return response.body;
}

async function acceptedState(backend: BackendIntegrationRuntime) {
    const telemetryQuery = new URLSearchParams({
        deviceId: 'temp-desk',
        metric: 'temperature',
        pageSize: '100',
        from: new Date(Date.parse(backend.clock.now()) - 60_000).toISOString(),
        to: new Date(Date.parse(backend.clock.now()) + 60_000).toISOString(),
    });
    const userHistory = await historyPage(backend, '/room/history/user-history', isUserHistoryPage);
    const significantFacts = await historyPage(
        backend,
        '/room/history/significant-facts?pageSize=100',
        isSignificantFactPage,
    );
    const telemetry = await historyPage(
        backend,
        `/room/history/telemetry?${telemetryQuery}`,
        isRawTelemetryPage,
    );
    expect(userHistory.nextCursor).toBeNull();
    expect(significantFacts.nextCursor).toBeNull();
    expect(telemetry.nextCursor).toBeNull();

    return {
        snapshot: await backend.snapshot(),
        userHistory,
        significantFacts,
        telemetry,
        facts: backend.storage.listSignificantFacts(),
        samples: backend.storage.listTelemetrySamples({
            deviceId: 'temp-desk',
            metric: 'temperature',
        }),
        identities: backend.storage.listAcceptedInputIdentities(),
        checkpoint: backend.storage.getLatestRoomProjection(),
        historyGenerationId: backend.storage.getMetadata().historyGenerationId,
        lastStorageSequence: backend.storage.getMetadata().lastStorageSequence,
    };
}
