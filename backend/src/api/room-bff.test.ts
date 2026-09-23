import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DeviceScenarioAction } from '@smart-room/contracts/development';
import { createHistoryIdentityFixtures } from '@smart-room/contracts/history-fixtures';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type {
    RoomPublicationBatch,
    RoomRealtimeServerMessage,
} from '@smart-room/contracts/realtime';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { EventProcessingDiagnosticsSnapshot } from '../platform/event-processing/event-processing-diagnostics';
import { createHistoryCursorCodec } from '../platform/history/room-history-cursor';
import { createRoomHistoryReader } from '../platform/history/room-history-reader';
import { createSqliteRoomStorage } from '../platform/storage/sqlite-room-storage';
import { StorageAvailabilityError } from '../platform/storage/storage-errors';
import { createTemperatureRoomRuntime } from '../runtime/temperature-room-runtime';

import { createRoomBffServer } from './room-bff';

describe('createRoomBffServer', () => {
    const openServers: FastifyInstance[] = [];
    const openStreams: SseConnection[] = [];

    afterEach(async () => {
        openStreams.forEach((stream) => stream.close());
        openStreams.length = 0;
        await Promise.all(openServers.map((server) => closeServer(server)));
        openServers.length = 0;
    });

    it('serves the current room snapshot', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        await expect(response.json()).resolves.toEqual(createRoomSnapshot());
    });

    it('serves the shared history fact unchanged in the HTTP room feed', async () => {
        const fixtures = createHistoryIdentityFixtures();
        const roomSnapshot = {
            ...createRoomSnapshot(),
            recentEvents: fixtures.recentEvents,
            platform: {
                storage: {
                    ...availableStorage(),
                    storedThroughSequence: fixtures.telemetrySample.storageSequence,
                },
            },
        };
        const server = await listen(createRoomBffServer(createRoomBffConfig({ roomSnapshot })));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            recentEvents: [{ recordId: fixtures.recentEvent.recordId }],
        });
    });

    it('serves the first pinned significant-facts page from isolated SQLite storage', async () => {
        const history = createHistoryBffHarness();

        try {
            const response = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1',
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({
                historyGenerationId: history.generationId,
                throughSequence: 6,
                retentionAsOf: '2026-09-10T10:10:00.000Z',
                pageSize: 1,
                items: [{ recordId: history.factRecordIds[1], durability: 'durable' }],
                nextCursor: expect.any(String),
            });
        } finally {
            await history.close();
        }
    });

    it('accepts maximum history limits and rejects larger values at the HTTP boundary', async () => {
        const history = createHistoryBffHarness();

        try {
            const maxFactPage = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=100',
            });
            expect(maxFactPage.statusCode).toBe(200);
            expect(maxFactPage.json()).toMatchObject({ pageSize: 100 });

            const oversizedFactPage = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=101',
            });
            expect(oversizedFactPage.statusCode).toBe(400);
            expect(oversizedFactPage.json()).toMatchObject({ error: 'invalid_request' });

            const maxTelemetryPage = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=100',
            });
            expect(maxTelemetryPage.statusCode).toBe(200);
            expect(maxTelemetryPage.json()).toMatchObject({ pageSize: 100 });

            const oversizedTelemetryPage = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=101',
            });
            expect(oversizedTelemetryPage.statusCode).toBe(400);
            expect(oversizedTelemetryPage.json()).toMatchObject({ error: 'invalid_request' });

            const maxTrend = await history.server.inject({
                method: 'GET',
                url: '/room/history/trends?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pointLimit=200',
            });
            expect(maxTrend.statusCode).toBe(200);
            expect(maxTrend.json<{ points: unknown[] }>().points.length).toBeLessThanOrEqual(200);

            const oversizedTrend = await history.server.inject({
                method: 'GET',
                url: '/room/history/trends?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pointLimit=201',
            });
            expect(oversizedTrend.statusCode).toBe(400);
            expect(oversizedTrend.json()).toMatchObject({ error: 'invalid_request' });
        } finally {
            await history.close();
        }
    });

    it('keeps HTTP history pages complete only through their original watermark', async () => {
        const history = createHistoryBffHarness();

        try {
            const firstFacts = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1',
            });
            const firstTelemetry = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=1',
            });

            expect(firstFacts.statusCode).toBe(200);
            expect(firstTelemetry.statusCode).toBe(200);

            const factPage = firstFacts.json<{
                historyGenerationId: string;
                throughSequence: number;
                retentionAsOf: string;
                items: { recordId: string }[];
                nextCursor: string;
            }>();
            const telemetryPage = firstTelemetry.json<{
                historyGenerationId: string;
                throughSequence: number;
                retentionAsOf: string;
                items: { recordId: string }[];
                nextCursor: string;
            }>();

            expect(factPage.throughSequence).toBe(6);
            expect(telemetryPage.throughSequence).toBe(6);
            expect(factPage.items.map(({ recordId: id }) => id)).toEqual([
                history.factRecordIds[1],
            ]);
            expect(telemetryPage.items.map(({ recordId: id }) => id)).toEqual([
                history.telemetryRecordIds[1],
            ]);

            const later = history.appendRecordsBetweenPages();

            expect(later.factStorageSequence).toBeGreaterThan(factPage.throughSequence);
            expect(later.telemetryStorageSequence).toBeGreaterThan(telemetryPage.throughSequence);

            const nextFacts = await history.server.inject({
                method: 'GET',
                url: `/room/history/significant-facts?pageSize=1&cursor=${encodeURIComponent(factPage.nextCursor)}`,
            });
            const nextTelemetry = await history.server.inject({
                method: 'GET',
                url: `/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=1&cursor=${encodeURIComponent(telemetryPage.nextCursor)}`,
            });

            expect(nextFacts.statusCode).toBe(200);
            expect(nextFacts.json()).toMatchObject({
                historyGenerationId: factPage.historyGenerationId,
                throughSequence: factPage.throughSequence,
                retentionAsOf: factPage.retentionAsOf,
                items: [{ recordId: history.factRecordIds[0] }],
                nextCursor: null,
            });
            expect(nextTelemetry.statusCode).toBe(200);
            expect(nextTelemetry.json()).toMatchObject({
                historyGenerationId: telemetryPage.historyGenerationId,
                throughSequence: telemetryPage.throughSequence,
                retentionAsOf: telemetryPage.retentionAsOf,
                items: [{ recordId: history.telemetryRecordIds[0] }],
                nextCursor: null,
            });

            const newFactsSession = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=10',
            });
            const newTelemetrySession = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=10',
            });

            expect(newFactsSession.statusCode).toBe(200);
            const newFactPage = newFactsSession.json<{
                historyGenerationId: string;
                throughSequence: number;
                retentionAsOf: string;
                items: { recordId: string }[];
                nextCursor: string | null;
            }>();
            expect(newFactPage).toMatchObject({
                historyGenerationId: factPage.historyGenerationId,
                throughSequence: later.telemetryStorageSequence,
                retentionAsOf: factPage.retentionAsOf,
                nextCursor: null,
            });
            expect(newFactPage.items.map(({ recordId: id }) => id)).toEqual([
                history.factRecordIds[1],
                later.factRecordId,
                history.factRecordIds[0],
            ]);
            expect(newTelemetrySession.statusCode).toBe(200);
            const newTelemetryPage = newTelemetrySession.json<{
                historyGenerationId: string;
                throughSequence: number;
                retentionAsOf: string;
                items: { recordId: string }[];
                nextCursor: string | null;
            }>();
            expect(newTelemetryPage).toMatchObject({
                historyGenerationId: telemetryPage.historyGenerationId,
                throughSequence: later.telemetryStorageSequence,
                retentionAsOf: telemetryPage.retentionAsOf,
                nextCursor: null,
            });
            expect(newTelemetryPage.items.map(({ recordId: id }) => id)).toEqual([
                history.telemetryRecordIds[1],
                later.telemetryRecordId,
                history.telemetryRecordIds[0],
            ]);
        } finally {
            await history.close();
        }
    });

    it('continues a pinned fact and telemetry page only with its original canonical scope', async () => {
        const history = createHistoryBffHarness();

        try {
            const firstFacts = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1',
            });
            const factCursor = firstFacts.json<{ nextCursor: string }>().nextCursor;

            const secondFacts = await history.server.inject({
                method: 'GET',
                url: `/room/history/significant-facts?pageSize=1&cursor=${encodeURIComponent(factCursor)}`,
            });

            expect(secondFacts.statusCode).toBe(200);
            expect(secondFacts.json()).toMatchObject({
                historyGenerationId: history.generationId,
                throughSequence: 6,
                items: [{ recordId: history.factRecordIds[0] }],
                nextCursor: null,
            });

            const changedFactScope = await history.server.inject({
                method: 'GET',
                url: `/room/history/significant-facts?pageSize=2&cursor=${encodeURIComponent(factCursor)}`,
            });
            expect(changedFactScope.statusCode).toBe(400);
            expect(changedFactScope.json()).toEqual({
                error: 'cursor_query_mismatch',
                message: 'The cursor does not match this query.',
            });

            const firstTelemetry = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=1',
            });
            const telemetryCursor = firstTelemetry.json<{ nextCursor: string }>().nextCursor;

            const secondTelemetry = await history.server.inject({
                method: 'GET',
                url: `/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T11%3A00%3A00%2B01%3A00&to=2026-09-10T11%3A05%3A00%2B01%3A00&pageSize=1&cursor=${encodeURIComponent(telemetryCursor)}`,
            });
            expect(secondTelemetry.statusCode).toBe(200);
            expect(secondTelemetry.json()).toMatchObject({
                items: [{ recordId: history.telemetryRecordIds[0], value: 20 }],
                nextCursor: null,
            });

            const changedTelemetryScope = await history.server.inject({
                method: 'GET',
                url: `/room/history/telemetry?deviceId=temp-window&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=1&cursor=${encodeURIComponent(telemetryCursor)}`,
            });
            expect(changedTelemetryScope.statusCode).toBe(400);
            expect(changedTelemetryScope.json()).toEqual({
                error: 'cursor_query_mismatch',
                message: 'The cursor does not match this query.',
            });
        } finally {
            await history.close();
        }
    });

    it('returns typed cursor failures from history reads', async () => {
        const history = createHistoryBffHarness();

        try {
            const forged = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1&cursor=forged-cursor',
            });

            expect(forged.statusCode).toBe(400);
            expect(forged.json()).toEqual({
                error: 'invalid_cursor',
                message: 'The cursor cannot be verified.',
            });
        } finally {
            await history.close();
        }

        const changedGeneration = createRoomBffServer({
            ...createRoomBffConfig(),
            readSignificantFactPage() {
                return {
                    status: 'cursor_error',
                    error: {
                        error: 'history_generation_changed',
                        message: 'The history generation changed.',
                    },
                };
            },
        });
        const changedGenerationResponse = await changedGeneration.inject({
            method: 'GET',
            url: '/room/history/significant-facts?pageSize=1&cursor=server-issued',
        });

        expect(changedGenerationResponse.statusCode).toBe(400);
        expect(changedGenerationResponse.json()).toEqual({
            error: 'history_generation_changed',
            message: 'The history generation changed.',
        });
        await changedGeneration.close();
    });

    it('rejects a real cursor when presented to a different SQLite history generation', async () => {
        const originalHistory = createHistoryBffHarness();
        const replacementHistory = createHistoryBffHarness();

        try {
            expect(replacementHistory.generationId).not.toBe(originalHistory.generationId);

            const firstPage = await originalHistory.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1',
            });
            const cursor = firstPage.json<{ nextCursor: string }>().nextCursor;

            const continuation = await replacementHistory.server.inject({
                method: 'GET',
                url: `/room/history/significant-facts?pageSize=1&cursor=${encodeURIComponent(cursor)}`,
            });

            expect(continuation.statusCode).toBe(400);
            expect(continuation.json()).toEqual({
                error: 'history_generation_changed',
                message: 'The history generation changed.',
            });
        } finally {
            await Promise.all([originalHistory.close(), replacementHistory.close()]);
        }
    });

    it('returns 503 and degrades runtime storage after a continuation read availability failure', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-bff-history-failure-'));
        const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
        const runtime = createTemperatureRoomRuntime({ storage, intervalMs: 60_000 });
        const server = createRoomBffServer({
            getRoomSnapshot: runtime.getRoomSnapshot,
            getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
            readSignificantFactPage: runtime.readSignificantFactPage,
            readRawTelemetryPage: runtime.readRawTelemetryPage,
            readTrend: runtime.readTrend,
            subscribeRoomPublicationBatch: runtime.subscribeRoomPublicationBatch,
        });

        try {
            const retentionAsOf = new Date().toISOString();
            const firstOccurredAt = new Date(Date.parse(retentionAsOf) - 60_000).toISOString();
            const secondOccurredAt = new Date(Date.parse(retentionAsOf) - 30_000).toISOString();
            const outageStartedAt = new Date(Date.parse(retentionAsOf) - 120_000).toISOString();
            const seeded = storage.transact(
                (transaction) => {
                    transaction.appendSignificantFact({
                        recordId: recordId('a'),
                        eventType: 'storage.gap.recorded',
                        source: 'backend',
                        occurredAt: firstOccurredAt,
                        payload: {
                            ...storageGapPayload(firstOccurredAt),
                            outageStartedAt,
                        },
                    });
                    transaction.appendSignificantFact({
                        recordId: recordId('b'),
                        eventType: 'storage.gap.recorded',
                        source: 'backend',
                        occurredAt: secondOccurredAt,
                        payload: {
                            ...storageGapPayload(secondOccurredAt),
                            outageStartedAt,
                        },
                    });
                },
                { retentionAsOf },
            );

            if (seeded.status !== 'committed') {
                throw seeded.error;
            }

            runtime.start();

            const firstPage = await server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1',
            });
            expect(firstPage.statusCode).toBe(200);
            const cursor = firstPage.json<{ nextCursor: string }>().nextCursor;

            storage.readPinnedSignificantFacts = () => {
                throw new StorageAvailabilityError('Injected durable history read failure.', null);
            };

            const failedContinuation = await server.inject({
                method: 'GET',
                url: `/room/history/significant-facts?pageSize=1&cursor=${encodeURIComponent(cursor)}`,
            });

            expect(failedContinuation.statusCode).toBe(503);
            expect(failedContinuation.json()).toEqual({
                error: 'durable_history_unavailable',
                message: 'Durable history is currently unavailable.',
            });
            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('degraded');

            const laterRead = await server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1',
            });
            expect(laterRead.statusCode).toBe(503);
        } finally {
            await server.close();
            runtime.stop();
            storage.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    it('filters and bounds first-page telemetry while treating an unknown device as empty', async () => {
        const history = createHistoryBffHarness();

        try {
            const response = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=10',
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({
                historyGenerationId: history.generationId,
                throughSequence: 6,
                items: [
                    { recordId: history.telemetryRecordIds[1], value: 22 },
                    { recordId: history.telemetryRecordIds[0], value: 20 },
                ],
                nextCursor: null,
            });

            const unknownDevice = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-unknown&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=10',
            });

            expect(unknownDevice.statusCode).toBe(200);
            expect(unknownDevice.json()).toMatchObject({
                historyGenerationId: history.generationId,
                items: [],
            });
        } finally {
            await history.close();
        }
    });

    it('serves raw telemetry identities selected for a bounded trend', async () => {
        const history = createHistoryBffHarness();

        try {
            const response = await history.server.inject({
                method: 'GET',
                url: '/room/history/trends?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pointLimit=4',
            });

            expect(response.statusCode).toBe(200);
            expect(response.json()).toMatchObject({
                historyGenerationId: history.generationId,
                throughSequence: 6,
                points: [
                    { recordId: history.telemetryRecordIds[0], storageSequence: 3 },
                    { recordId: history.telemetryRecordIds[1], storageSequence: 4 },
                ],
            });
        } finally {
            await history.close();
        }
    });

    it('rejects invalid history ranges and keeps unavailable history distinct from empty results', async () => {
        const history = createHistoryBffHarness();

        try {
            const invalidRange = await history.server.inject({
                method: 'GET',
                url: '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:05:00Z&to=2026-09-10T10:05:00Z&pageSize=10',
            });
            expect(invalidRange.statusCode).toBe(400);

            const cursor = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1&cursor=not-supported-yet',
            });
            expect(cursor.statusCode).toBe(400);

            const malformed = await history.server.inject({
                method: 'GET',
                url: '/room/history/significant-facts',
            });
            expect(malformed.statusCode).toBe(400);
            expect(malformed.json()).toEqual({
                error: 'invalid_request',
                message: 'History query parameters do not match the transport contract.',
            });

            const unavailable = createRoomBffServer({
                ...createRoomBffConfig(),
                readSignificantFactPage() {
                    return { status: 'unavailable' };
                },
                readRawTelemetryPage() {
                    return { status: 'unavailable' };
                },
                readTrend() {
                    return { status: 'unavailable' };
                },
            });

            for (const url of [
                '/room/history/significant-facts?pageSize=1',
                '/room/history/telemetry?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pageSize=1',
                '/room/history/trends?deviceId=temp-desk&metric=temperature&from=2026-09-10T10:00:00Z&to=2026-09-10T10:05:00Z&pointLimit=2',
            ]) {
                const unavailableResponse = await unavailable.inject({ method: 'GET', url });

                expect(unavailableResponse.statusCode).toBe(503);
                expect(unavailableResponse.json()).toEqual({
                    error: 'durable_history_unavailable',
                    message: 'Durable history is currently unavailable.',
                });
            }

            await unavailable.close();

            const invalidInternalData = createRoomBffServer({
                ...createRoomBffConfig(),
                readSignificantFactPage() {
                    return { status: 'invalid_internal_data' };
                },
            });
            const invalidInternalDataResponse = await invalidInternalData.inject({
                method: 'GET',
                url: '/room/history/significant-facts?pageSize=1',
            });

            expect(invalidInternalDataResponse.statusCode).toBe(500);
            expect(invalidInternalDataResponse.json()).toEqual({
                error: 'invalid_server_response',
                message: 'Server produced a response that does not match the transport contract.',
            });
            await invalidInternalData.close();
        } finally {
            await history.close();
        }
    });

    it('serves derived stale health from the current room snapshot', async () => {
        const server = await listen(
            createRoomBffServer(
                createRoomBffConfig({
                    roomSnapshot: createRoomSnapshot({
                        health: 'degraded',
                        healthReason: 'partial_data',
                    }),
                }),
            ),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            devices: [
                {
                    deviceId: 'temp-desk',
                    health: 'degraded',
                },
            ],
        });
    });

    it('returns 404 for unknown routes', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/unknown`);

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            error: 'not_found',
        });
    });

    it('returns 405 for unsupported room route methods', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`, {
            method: 'POST',
        });

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET, OPTIONS');
        await expect(response.json()).resolves.toMatchObject({
            error: 'method_not_allowed',
        });
    });

    it('accepts a valid command request without treating it as device confirmation', async () => {
        const requests: unknown[] = [];
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                requestCommand(request) {
                    requests.push(request);

                    return {
                        commandId: 'cmd-led-1',
                        status: 'accepted',
                        durability: 'durable',
                        lifecycleDurability: 'durable',
                    } as const;
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        });

        expect(response.status).toBe(202);
        await expect(response.json()).resolves.toEqual({
            commandId: 'cmd-led-1',
            status: 'accepted',
            durability: 'durable',
            lifecycleDurability: 'durable',
        });
        expect(requests).toEqual([
            { deviceId: 'led-main', commandType: 'set.power', requestedState: { power: 'on' } },
        ]);
    });

    it('does not fabricate an admitted rejection when command handling is unavailable', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        });

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: 'invalid_server_response',
            message: 'Server produced a response that does not match the transport contract.',
        });
    });

    it('rejects malformed or unsupported command requests at the HTTP boundary', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const malformed = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: 'led-main', commandType: 'set.level' }),
        });
        const nonJson = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            body: JSON.stringify({ deviceId: 'led-main' }),
        });

        expect(malformed.status).toBe(400);
        await expect(malformed.json()).resolves.toMatchObject({ error: 'invalid_request' });
        expect(nonJson.status).toBe(415);
        await expect(nonJson.json()).resolves.toMatchObject({ error: 'unsupported_media_type' });
    });

    it('keeps unknown devices and storage recovery outside command lifecycle admission', async () => {
        for (const [result, expectedStatus] of [
            [{ error: 'unknown_device', message: 'Device was not found.' } as const, 404],
            [
                {
                    error: 'platform_recovering',
                    message: 'Storage recovery is in progress.',
                    retryable: true,
                } as const,
                503,
            ],
        ] as const) {
            const server = await listen(
                createRoomBffServer({ ...createRoomBffConfig(), requestCommand: () => result }),
            );
            openServers.push(server);

            const response = await fetch(`${serverUrl(server)}/room/commands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            });

            expect(response.status).toBe(expectedStatus);
            await expect(response.json()).resolves.toEqual(result);
        }
    });

    it('keeps command validation errors in the API error contract when a query is present', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room/commands?source=dashboard`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId: 'led-main', commandType: 'set.level' }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'invalid_request',
            message: 'Request body does not match a supported command.',
        });
    });

    it('maps active-command rejection to 409', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                requestCommand() {
                    return {
                        commandId: 'cmd-led-2',
                        status: 'rejected',
                        reason: 'command_already_active',
                        message: 'Device already has an active command.',
                        durability: 'durable',
                        lifecycleDurability: 'durable',
                    } as const;
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room/commands`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            }),
        });

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ status: 'rejected' });
    });

    it('handles CORS preflight requests', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`, {
            method: 'OPTIONS',
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    });

    it('serves the current event processing diagnostics snapshot', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/diagnostics`);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/json');
        await expect(response.json()).resolves.toEqual(createDiagnosticsSnapshot());
    });

    it('returns 405 for unsupported diagnostics route methods', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/diagnostics`, {
            method: 'POST',
        });

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET, OPTIONS');
        await expect(response.json()).resolves.toMatchObject({
            error: 'method_not_allowed',
        });
    });

    it('discovers and runs a validated scenario for the requested device', async () => {
        const actions: Array<{ deviceId: string; action: string }> = [];
        const server = await listen(createRoomBffServer(createScenarioBffConfig(actions)));
        openServers.push(server);

        const discovery = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`);
        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(discovery.status).toBe(200);
        await expect(discovery.json()).resolves.toMatchObject({ deviceId: 'temp-desk' });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            action: 'pause_telemetry',
            status: 'completed',
        });
        expect(actions).toEqual([{ deviceId: 'temp-desk', action: 'pause_telemetry' }]);
    });

    it('routes a development scenario through the real runtime and room projection', async () => {
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 10_000,
        });
        runtime.start();
        const server = await listen(
            createRoomBffServer({
                getRoomSnapshot: runtime.getRoomSnapshot,
                getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
                subscribeRoomPublicationBatch: runtime.subscribeRoomPublicationBatch,
                runDeviceScenario: runtime.runDeviceScenario,
                getDeviceScenarios: runtime.getDeviceScenarios,
            }),
        );
        openServers.push(server);

        try {
            const actionResponse = await fetch(
                `${serverUrl(server)}/dev/devices/temp-desk/scenarios`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'emit_next_reading' }),
                },
            );
            const roomResponse = await fetch(`${serverUrl(server)}/room`);

            expect(actionResponse.status).toBe(200);
            await expect(roomResponse.json()).resolves.toMatchObject({
                devices: expect.arrayContaining([
                    expect.objectContaining({ deviceId: 'temp-desk' }),
                ]),
            });
        } finally {
            runtime.stop();
        }
    });

    it('keeps development scenarios unavailable when no control handler is configured', async () => {
        const server = await listen(createRoomBffServer(createRoomBffConfig()));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(404);
    });

    it('rejects discovery responses that belong to a different device and leaves the old URL unavailable', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createRoomBffConfig(),
                getDeviceScenarios() {
                    return {
                        deviceId: 'other-device',
                        scenarios: [{ action: 'pause_telemetry' }],
                    };
                },
            }),
        );
        openServers.push(server);

        const mismatch = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`);
        const removedRoute = await fetch(`${serverUrl(server)}/dev/scenarios/temperature`, {
            method: 'POST',
        });

        expect(mismatch.status).toBe(404);
        expect(removedRoute.status).toBe(404);
    });

    it('rejects unsupported development scenario actions', async () => {
        const server = await listen(createRoomBffServer(createScenarioBffConfig([])));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_room' }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: 'invalid_request',
        });
    });

    it('rejects development scenario requests without application/json', async () => {
        const server = await listen(createRoomBffServer(createScenarioBffConfig([])));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(415);
    });

    it('reports malformed development scenario JSON as an invalid request', async () => {
        const server = await listen(createRoomBffServer(createScenarioBffConfig([])));
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{invalid',
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: 'invalid_request',
            message: 'Request body must be valid JSON.',
        });
    });

    it('reports scenario execution failures without treating them as invalid requests', async () => {
        const server = await listen(
            createRoomBffServer({
                ...createScenarioBffConfig([]),
                runDeviceScenario() {
                    throw new Error('Simulator unavailable.');
                },
            }),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/dev/devices/temp-desk/scenarios`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pause_telemetry' }),
        });

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toEqual({
            error: 'scenario_failed',
            message: 'Scenario could not be executed.',
        });
    });

    it('does not expose an invalid room projection through HTTP', async () => {
        const server = await listen(
            createRoomBffServer(
                createRoomBffConfig({
                    roomSnapshot: {
                        ...createRoomSnapshot(),
                        updatedAt: '2026-02-30T09:30:00Z',
                    },
                }),
            ),
        );
        openServers.push(server);

        const response = await fetch(`${serverUrl(server)}/room`);

        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({
            error: 'invalid_server_response',
        });
    });

    it('sends an initial room snapshot over the SSE stream', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const stream = await connectSse(server);
        openStreams.push(stream);

        expect(stream.contentType).toContain('text/event-stream');
        expect(stream.accessControlAllowOrigin).toBe('*');
        expect(stream.cacheControl).toBe('no-cache, no-transform');
        expect(stream.connection).toBe('keep-alive');
        const frame = await readRealtimeFrame(stream);

        expect(frame.event).toBe('room.snapshot');
        expect(frame.id).toBeUndefined();
        expect(frame.message).toEqual({
            messageType: 'room.snapshot',
            revision: 0,
            sentAt: '2026-06-08T09:30:01Z',
            payload: expect.objectContaining(createRoomSnapshot()),
        });
    });

    it('registers the realtime subscriber before sending the initial room snapshot', async () => {
        const harness = createRoomBffHarness({
            roomSnapshot: createRoomSnapshot({
                temperature: 22,
            }),
            sentAt: ['2026-06-08T09:30:01Z'],
            onSubscribe() {
                harness.setRoomSnapshot(
                    createRoomSnapshot({
                        temperature: 22.8,
                        updatedAt: '2026-06-08T09:30:01Z',
                    }),
                );
            },
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const stream = await connectSse(server);
        openStreams.push(stream);

        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'room.snapshot',
            payload: {
                updatedAt: '2026-06-08T09:30:01Z',
                devices: [
                    expect.objectContaining({
                        reportedState: {
                            temperature: 22.8,
                            temperatureUnit: 'celsius',
                        },
                    }),
                ],
            },
        });
    });

    it('streams a device delta after the initial room snapshot', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        harness.publishRoomSnapshot(
            createRoomSnapshot({
                temperature: 22.4,
                updatedAt: '2026-06-08T09:30:02Z',
            }),
        );

        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'device.updated',
            previousRevision: 0,
            revision: 1,
            sentAt: '2026-06-08T09:30:02Z',
            payload: {
                reportedState: {
                    temperature: 22.4,
                    temperatureUnit: 'celsius',
                },
            },
        });
    });

    it('streams sequential command projection deltas for the affected device', async () => {
        const harness = createRoomBffHarness({
            roomSnapshot: createLedRoomSnapshot(),
            sentAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:02Z', '2026-06-08T09:30:03Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);
        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        harness.publishRoomSnapshot(createLedRoomSnapshot({ status: 'accepted' }));
        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'commands.updated',
            previousRevision: 0,
            revision: 1,
            payload: { activeCommands: [expect.objectContaining({ status: 'accepted' })] },
        });

        harness.publishRoomSnapshot(createLedRoomSnapshot({ status: 'confirmed' }));
        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'commands.updated',
            previousRevision: 1,
            revision: 2,
            payload: { recentCommands: [expect.objectContaining({ status: 'confirmed' })] },
        });
    });

    it('streams global command collections atomically for multiple controllable devices', async () => {
        const harness = createRoomBffHarness({
            roomSnapshot: createTwoLedRoomSnapshot('accepted'),
            sentAt: ['2026-06-08T09:30:01Z', '2026-06-08T09:30:03Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);
        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        harness.publishRoomSnapshot(createTwoLedRoomSnapshot('confirmed'));

        await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
            messageType: 'commands.updated',
            previousRevision: 0,
            revision: 1,
            payload: {
                devices: expect.arrayContaining([
                    expect.objectContaining({ deviceId: 'led-main' }),
                    expect.objectContaining({ deviceId: 'led-side' }),
                ]),
                activeCommands: [],
                recentCommands: expect.arrayContaining([
                    expect.objectContaining({ commandId: 'cmd-led-1', status: 'confirmed' }),
                    expect.objectContaining({ commandId: 'cmd-led-side', status: 'confirmed' }),
                ]),
            },
        });
    });

    it('streams only the changed device delta from the two-sensor runtime', async () => {
        const runtime = createTemperatureRoomRuntime({ intervalMs: 10_000 });
        runtime.start();
        const server = await listen(
            createRoomBffServer({
                getRoomSnapshot: runtime.getRoomSnapshot,
                getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
                subscribeRoomPublicationBatch: runtime.subscribeRoomPublicationBatch,
            }),
        );
        openServers.push(server);
        const stream = await connectSse(server);
        openStreams.push(stream);

        try {
            await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
                messageType: 'room.snapshot',
                payload: {
                    devices: expect.arrayContaining([
                        expect.objectContaining({ deviceId: 'temp-desk' }),
                        expect.objectContaining({ deviceId: 'temp-window' }),
                    ]),
                },
            });

            runtime.runDeviceScenario('temp-window', 'emit_next_reading');

            await expect(readRealtimeMessage(stream)).resolves.toMatchObject({
                messageType: 'device.updated',
                previousRevision: 0,
                revision: 1,
                payload: {
                    deviceId: 'temp-window',
                    reportedState: { temperature: 20.2, temperatureUnit: 'celsius' },
                },
            });
        } finally {
            runtime.stop();
        }
    });

    it('removes realtime snapshot subscriptions when the SSE client closes', async () => {
        const harness = createRoomBffHarness({
            sentAt: ['2026-06-08T09:30:01Z'],
        });
        const server = await listen(createRoomBffServer(harness.config));
        openServers.push(server);

        const stream = await connectSse(server);
        openStreams.push(stream);
        await readRealtimeMessage(stream);

        expect(harness.listenerCount()).toBe(1);

        await stream.close();
        await waitForCondition(() => harness.listenerCount() === 0);

        expect(harness.listenerCount()).toBe(0);
        harness.publishRoomSnapshot(
            createRoomSnapshot({
                temperature: 22.6,
                updatedAt: '2026-06-08T09:30:03Z',
            }),
        );
        expect(harness.listenerCount()).toBe(0);
    });
});

function createRoomBffConfig({
    roomSnapshot = createRoomSnapshot(),
}: {
    roomSnapshot?: RoomSnapshotProjection;
} = {}) {
    return {
        getRoomSnapshot() {
            return roomSnapshot;
        },
        getDiagnosticsSnapshot() {
            return createDiagnosticsSnapshot();
        },
        subscribeRoomSnapshot() {
            return () => undefined;
        },
        subscribeRoomPublicationBatch() {
            return () => undefined;
        },
    };
}

function createScenarioBffConfig(actions: Array<{ deviceId: string; action: string }>) {
    return {
        ...createRoomBffConfig(),
        getDeviceScenarios(deviceId: string) {
            return deviceId === 'temp-desk'
                ? { deviceId, scenarios: [{ action: 'pause_telemetry' as const }] }
                : undefined;
        },
        runDeviceScenario(deviceId: string, action: DeviceScenarioAction) {
            actions.push({ deviceId, action });

            return { action, status: 'completed' } as const;
        },
    };
}

function createRoomBffHarness({
    roomSnapshot = createRoomSnapshot(),
    sentAt,
    onSubscribe,
}: {
    roomSnapshot?: RoomSnapshotProjection;
    sentAt: string[];
    onSubscribe?: () => void;
}) {
    let currentRoomSnapshot = roomSnapshot;
    const listeners = new Set<(batch: RoomPublicationBatch) => void>();
    const pendingSentAt = [...sentAt];

    return {
        config: {
            getRoomSnapshot() {
                return currentRoomSnapshot;
            },
            getDiagnosticsSnapshot() {
                return createDiagnosticsSnapshot();
            },
            subscribeRoomPublicationBatch(listener: (batch: RoomPublicationBatch) => void) {
                listeners.add(listener);
                onSubscribe?.();

                return () => {
                    listeners.delete(listener);
                };
            },
            now() {
                const timestamp = pendingSentAt.shift();

                if (!timestamp) {
                    throw new Error('No deterministic sentAt timestamp configured.');
                }

                return timestamp;
            },
        },
        publishRoomSnapshot(snapshot: RoomSnapshotProjection) {
            const previous = currentRoomSnapshot;
            currentRoomSnapshot = snapshot;
            const commandsChanged =
                JSON.stringify(previous.activeCommands) !==
                    JSON.stringify(snapshot.activeCommands) ||
                JSON.stringify(previous.recentCommands) !== JSON.stringify(snapshot.recentCommands);
            const deltas: RoomPublicationBatch['deltas'] = commandsChanged
                ? [
                      {
                          messageType: 'commands.updated',
                          payload: {
                              devices: snapshot.devices,
                              activeCommands: snapshot.activeCommands,
                              recentCommands: snapshot.recentCommands,
                          },
                      },
                  ]
                : snapshot.devices
                      .filter(
                          (device, index) =>
                              JSON.stringify(previous.devices[index]) !== JSON.stringify(device),
                      )
                      .map((device) => ({
                          messageType: 'device.updated' as const,
                          payload: device,
                      }));

            for (const listener of listeners) {
                listener({ snapshot, deltas });
            }
        },
        setRoomSnapshot(snapshot: RoomSnapshotProjection) {
            currentRoomSnapshot = snapshot;
        },
        listenerCount() {
            return listeners.size;
        },
    };
}

function createRoomSnapshot({
    health = 'healthy',
    healthReason,
    temperature = 22,
    updatedAt = '2026-06-08T09:30:00Z',
}: {
    health?: RoomSnapshotProjection['devices'][number]['health'];
    healthReason?: string;
    temperature?: number;
    updatedAt?: string;
} = {}): RoomSnapshotProjection {
    return {
        roomName: 'Smart Room',
        updatedAt,
        devices: [
            {
                deviceId: 'temp-desk',
                name: 'Desk Temperature',
                role: 'temperature-sensor',
                availability: 'online',
                availabilityChangedAt: '2026-06-08T09:30:00Z',
                availabilityDurability: 'durable',
                health,
                healthChangedAt: '2026-06-08T09:30:00Z',
                healthDurability: 'durable',
                ...(healthReason ? { healthReason } : {}),
                reportedState: {
                    temperature,
                    temperatureUnit: 'celsius',
                },
                commandAvailability: {
                    policy: 'block',
                    reason: 'read_only_device',
                },
                observationStatus: {
                    temperature: {
                        freshness: 'fresh',
                        lastObservedAt: '2026-06-08T09:30:00Z',
                        durability: 'durable',
                    },
                },
            },
        ],
        activeCommands: [],
        recentCommands: [],
        recentEvents: [],
        platform: { storage: availableStorage() },
    };
}

function createLedRoomSnapshot({
    status,
}: {
    status?: 'accepted' | 'confirmed';
} = {}): RoomSnapshotProjection {
    const command = {
        commandId: 'cmd-led-1',
        deviceId: 'led-main',
        commandType: 'set.power' as const,
        requestedState: { power: 'on' as const },
        requestedAt: '2026-06-08T09:30:00Z',
        durability: 'durable' as const,
        lifecycleDurability: 'durable' as const,
    };

    return {
        roomName: 'Smart Room',
        updatedAt: status ? '2026-06-08T09:30:02Z' : '2026-06-08T09:30:00Z',
        devices: [
            {
                deviceId: 'led-main',
                name: 'Main LED',
                role: 'led-output',
                availability: 'online',
                availabilityChangedAt: '2026-06-08T09:30:00Z',
                availabilityDurability: 'durable',
                health: 'healthy',
                healthChangedAt: '2026-06-08T09:30:00Z',
                healthDurability: 'durable',
                reportedState: { power: status === 'confirmed' ? 'on' : 'off' },
                commandAvailability: { policy: 'allow' },
                observationStatus: {
                    power: {
                        freshness: 'unknown',
                        lastObservedAt: '2026-06-08T09:30:00Z',
                        durability: 'durable',
                    },
                },
                ...(status === 'accepted' ? { activeCommandId: command.commandId } : {}),
            },
        ],
        activeCommands: status === 'accepted' ? [{ ...command, status: 'accepted' }] : [],
        recentCommands:
            status === 'confirmed'
                ? [
                      {
                          ...command,
                          status: 'confirmed',
                          delivery: {
                              status: 'handed_off',
                              dispatchedAt: '2026-06-08T09:30:01Z',
                              deadlineAt: '2026-06-08T09:30:06Z',
                          },
                          confirmedAt: '2026-06-08T09:30:02Z',
                      },
                  ]
                : [],
        recentEvents: [],
        platform: { storage: availableStorage() },
    };
}

function createTwoLedRoomSnapshot(status: 'accepted' | 'confirmed'): RoomSnapshotProjection {
    const snapshot = createLedRoomSnapshot({ status });
    const sideCommand = {
        commandId: 'cmd-led-side',
        deviceId: 'led-side',
        commandType: 'set.power' as const,
        requestedState: { power: 'off' as const },
        requestedAt: '2026-06-08T09:29:58Z',
        durability: 'durable' as const,
        lifecycleDurability: 'durable' as const,
        delivery: {
            status: 'handed_off' as const,
            dispatchedAt: '2026-06-08T09:29:59Z',
            deadlineAt: '2026-06-08T09:30:04Z',
        },
        confirmedAt: '2026-06-08T09:30:00Z',
        status: 'confirmed' as const,
    };

    return {
        ...snapshot,
        devices: [
            ...snapshot.devices,
            {
                deviceId: 'led-side',
                name: 'Side LED',
                role: 'led-output',
                availability: 'online',
                availabilityChangedAt: '2026-06-08T09:30:00Z',
                health: 'healthy',
                healthChangedAt: '2026-06-08T09:30:00Z',
                availabilityDurability: 'durable',
                healthDurability: 'durable',
                reportedState: { power: 'off' },
                commandAvailability: { policy: 'allow' },
                observationStatus: {
                    power: {
                        freshness: 'unknown',
                        lastObservedAt: '2026-06-08T09:30:00Z',
                        durability: 'durable',
                    },
                },
            },
        ],
        recentCommands: [...snapshot.recentCommands, sideCommand],
    };
}

function availableStorage() {
    return {
        status: 'available' as const,
        changedAt: '2026-06-08T09:30:00Z',
        historyGenerationId: 'generation-test',
        storedThroughSequence: 0,
    };
}

function createDiagnosticsSnapshot(): EventProcessingDiagnosticsSnapshot {
    return {
        ignoredEvents: [
            {
                diagnosticId: 'diag-1',
                reason: 'duplicate_event',
                observedAt: '2026-06-08T09:30:01Z',
                eventId: 'evt-temperature-1',
                eventType: 'telemetry.reading.recorded',
                source: 'simulator-adapter',
                deviceId: 'temp-desk',
                occurredAt: '2026-06-08T09:30:01Z',
            },
        ],
    };
}

function createHistoryBffHarness() {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-bff-history-'));
    const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
    const factRecordIds = [recordId('a'), recordId('b')];
    const telemetryRecordIds = [recordId('c'), recordId('d')];
    const retentionAsOf = '2026-09-10T10:10:00.000Z';
    const outcome = storage.transact(
        (transaction) => {
            transaction.appendSignificantFact({
                recordId: factRecordIds[0],
                eventType: 'storage.gap.recorded',
                source: 'backend',
                occurredAt: '2026-09-10T10:01:00.000Z',
                payload: storageGapPayload('2026-09-10T10:01:00.000Z'),
            });
            transaction.appendSignificantFact({
                recordId: factRecordIds[1],
                eventType: 'storage.gap.recorded',
                source: 'backend',
                occurredAt: '2026-09-10T10:04:00.000Z',
                payload: storageGapPayload('2026-09-10T10:04:00.000Z'),
            });
            transaction.appendTelemetrySample({
                recordId: telemetryRecordIds[0],
                deviceId: 'temp-desk',
                metric: 'temperature',
                value: 20,
                unit: 'celsius',
                occurredAt: '2026-09-10T10:00:00.000Z',
                payload: { metric: 'temperature', value: 20, unit: 'celsius' },
            });
            transaction.appendTelemetrySample({
                recordId: telemetryRecordIds[1],
                deviceId: 'temp-desk',
                metric: 'temperature',
                value: 22,
                unit: 'celsius',
                occurredAt: '2026-09-10T10:03:00.000Z',
                payload: { metric: 'temperature', value: 22, unit: 'celsius' },
            });
            transaction.appendTelemetrySample({
                recordId: recordId('e'),
                deviceId: 'temp-window',
                metric: 'temperature',
                value: 18,
                unit: 'celsius',
                occurredAt: '2026-09-10T10:04:00.000Z',
                payload: { metric: 'temperature', value: 18, unit: 'celsius' },
            });
            transaction.appendTelemetrySample({
                recordId: recordId('f'),
                deviceId: 'temp-desk',
                metric: 'temperature',
                value: 24,
                unit: 'celsius',
                occurredAt: '2026-09-10T10:05:00.000Z',
                payload: { metric: 'temperature', value: 24, unit: 'celsius' },
            });
        },
        { retentionAsOf },
    );

    if (outcome.status !== 'committed') {
        storage.close();
        rmSync(directory, { recursive: true, force: true });

        throw outcome.error;
    }

    const reader = createRoomHistoryReader({
        storage,
        cursorCodec: createHistoryCursorCodec({ secret: Buffer.alloc(32, 1) }),
        now: () => retentionAsOf,
    });
    const server = createRoomBffServer({
        ...createRoomBffConfig(),
        readSignificantFactPage: reader.readSignificantFactPage,
        readRawTelemetryPage: reader.readRawTelemetryPage,
        readTrend: reader.readTrend,
    });

    return {
        server,
        factRecordIds,
        telemetryRecordIds,
        generationId: storage.getMetadata().historyGenerationId,
        appendRecordsBetweenPages() {
            const laterOutcome = storage.transact(
                (transaction) => {
                    const fact = transaction.appendSignificantFact({
                        recordId: recordId('7'),
                        eventType: 'storage.gap.recorded',
                        source: 'backend',
                        occurredAt: '2026-09-10T10:02:00.000Z',
                        payload: storageGapPayload('2026-09-10T10:02:00.000Z'),
                    });
                    const telemetry = transaction.appendTelemetrySample({
                        recordId: recordId('8'),
                        deviceId: 'temp-desk',
                        metric: 'temperature',
                        value: 21,
                        unit: 'celsius',
                        occurredAt: '2026-09-10T10:02:00.000Z',
                        payload: { metric: 'temperature', value: 21, unit: 'celsius' },
                    });

                    return {
                        factRecordId: fact.recordId,
                        factStorageSequence: fact.storageSequence,
                        telemetryRecordId: telemetry.recordId,
                        telemetryStorageSequence: telemetry.storageSequence,
                    };
                },
                { retentionAsOf },
            );

            if (laterOutcome.status !== 'committed') {
                throw laterOutcome.error;
            }

            return laterOutcome.value;
        },
        async close() {
            await server.close();
            storage.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
}

function storageGapPayload(outageEndedAt: string) {
    return {
        outageStartedAt: '2026-09-10T09:59:00.000Z',
        outageEndedAt,
        failureReason: 'storage_unavailable',
        boundaryBasis: 'same_process_first_degraded_at' as const,
        observationsBackfilled: false as const,
    };
}

function recordId(character: string): string {
    return `rec:v1:sha256:${character.repeat(64)}`;
}

async function listen(server: FastifyInstance): Promise<FastifyInstance> {
    await server.listen({
        port: 0,
        host: '127.0.0.1',
    });

    return server;
}

async function closeServer(server: FastifyInstance): Promise<void> {
    await server.close();
}

function serverUrl(server: FastifyInstance): string {
    const address = server.server.address() as AddressInfo;

    return `http://127.0.0.1:${address.port}`;
}

interface SseConnection {
    accessControlAllowOrigin: string | null;
    contentType: string | null;
    cacheControl: string | null;
    connection: string | null;
    close(): Promise<void>;
    readFrame(): Promise<SseFrame>;
}

interface SseFrame {
    event: string | undefined;
    id: string | undefined;
    message: RoomRealtimeServerMessage;
}

async function connectSse(server: FastifyInstance): Promise<SseConnection> {
    const response = await fetch(`${serverUrl(server)}/room/realtime`);

    if (!response.body) {
        throw new Error('SSE response did not include a body.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    return {
        accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
        connection: response.headers.get('connection'),
        async close() {
            try {
                await reader.cancel();
            } catch {
                // The stream may already have been cancelled during test cleanup.
            }
        },
        async readFrame() {
            while (true) {
                const boundary = buffer.indexOf('\n\n');

                if (boundary !== -1) {
                    const frame = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const data = frame
                        .split('\n')
                        .find((line) => line.startsWith('data: '))
                        ?.slice('data: '.length);

                    if (data) {
                        return {
                            event: frame
                                .split('\n')
                                .find((line) => line.startsWith('event: '))
                                ?.slice('event: '.length),
                            id: frame
                                .split('\n')
                                .find((line) => line.startsWith('id: '))
                                ?.slice('id: '.length),
                            message: JSON.parse(data) as RoomRealtimeServerMessage,
                        };
                    }
                }

                const result = await reader.read();

                if (result.done) {
                    throw new Error('SSE stream closed before a realtime message arrived.');
                }

                buffer += decoder.decode(result.value, { stream: true });
            }
        },
    };
}

function readRealtimeMessage(stream: SseConnection): Promise<RoomRealtimeServerMessage> {
    return stream.readFrame().then((frame) => frame.message);
}

function readRealtimeFrame(stream: SseConnection): Promise<SseFrame> {
    return stream.readFrame();
}

function waitForCondition(condition: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const interval = setInterval(() => {
            if (condition()) {
                clearInterval(interval);
                resolve();

                return;
            }

            if (Date.now() - startedAt > 1000) {
                clearInterval(interval);
                reject(new Error('Condition was not met before the timeout.'));
            }
        }, 5);
    });
}
