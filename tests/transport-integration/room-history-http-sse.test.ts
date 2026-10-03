import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isRawTelemetryPage } from '@smart-room/contracts/history';
import { isUserHistoryPage } from '@smart-room/contracts/user-history';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { createRoomBffServer } from '../../backend/src/api/room-bff';
import type { RoomStorage } from '../../backend/src/platform/storage/room-storage';
import type { RoomStorageTransaction } from '../../backend/src/platform/storage/room-storage';
import type { StorageTransactionOutcome } from '../../backend/src/platform/storage/room-storage';
import { createSqliteRoomStorage } from '../../backend/src/platform/storage/sqlite-room-storage';
import { StorageAvailabilityError } from '../../backend/src/platform/storage/storage-errors';
import { createTemperatureRoomRuntime } from '../../backend/src/runtime/temperature-room-runtime';
import { createRoomHistorySession } from '../../frontend/src/app/history/room-history-session';
import { createUserHistorySession } from '../../frontend/src/app/history/user-history-session';
import type { RoomHistoryRealtimeUpdate } from '../../frontend/src/app/realtime/room-realtime-client';
import {
    connectRoomRealtime,
    type RoomRealtimeConnection,
} from '../../frontend/src/app/realtime/room-realtime-client';
import {
    isRoomBffRealtimeServerMessage,
    type RoomBffRealtimeServerMessage,
} from '../../shared/src/room-bff';

const initialTime = '2026-09-26T10:00:00.000Z';
const telemetryRange = {
    from: '2026-09-26T09:00:00.000Z',
    to: '2026-09-26T12:00:00.000Z',
};

describe('room history over the actual HTTP and SSE transports', () => {
    const harnesses: RuntimeHarness[] = [];
    const connections: RoomRealtimeConnection[] = [];
    const eventSources: FetchEventSource[] = [];

    afterEach(async () => {
        connections.splice(0).forEach((connection) => connection.close());
        eventSources.splice(0).forEach((source) => source.close());
        await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
    });

    it('merges user entries before, during and between pinned HTTP pages over one SSE connection', async () => {
        const harness = await createRuntimeHarness();
        harnesses.push(harness);
        harness.clock.advanceBy(1000);
        harness.runtime.runDeviceScenario('led-main', 'disconnect_device');

        const rejectAttempt = () => {
            harness.clock.advanceBy(1000);
            expect(
                harness.runtime.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }).status,
            ).toBe('rejected');
        };

        for (let index = 0; index < 51; index += 1) {
            rejectAttempt();
        }

        const updates = createUpdateQueue();
        const historyFetch = createHistoryFetch(() => harness.baseUrl);
        const session = createUserHistorySession(historyFetch.fetch);
        const connection = connectRoomRealtime(
            {
                onConnectionStatus() {},
                onSnapshot() {},
                onInvalidMessage() {
                    throw new Error('Invalid production BFF message');
                },
                onHistoryUpdate(update) {
                    session.acceptRealtime(update);
                    updates.push(update);
                },
            },
            createFetchEventSourceFactory(() => harness.baseUrl, eventSources),
        );
        connections.push(connection);
        await updates.waitFor((update) => update.kind === 'baseline');
        const seenIds = new Set<string>();
        rejectAttempt();
        await updates.waitFor((update) => hasAddition(update, 'significant-facts', seenIds));
        const gate = historyFetch.holdNextResponse();
        const loading = session.loadNextPage();
        const first = await gate.captured;

        if (!isUserHistoryPage(first.body)) {
            throw new Error('Invalid history page');
        }

        rejectAttempt();
        await updates.waitFor((update) => hasAddition(update, 'significant-facts', seenIds));
        gate.release();
        await loading;
        rejectAttempt();
        await updates.waitFor((update) => hasAddition(update, 'significant-facts', seenIds));
        await session.loadNextPage();
        const ids = session.getState().items.map((entry) => entry.recordId);
        expect(new Set(ids).size).toBe(ids.length);

        for (const id of seenIds) {
            expect(ids).toContain(id);
        }

        expect(historyFetch.responses).toHaveLength(2);

        for (const response of historyFetch.responses) {
            if (!isUserHistoryPage(response.body)) {
                throw new Error('Invalid history page');
            }

            expect(response.body.throughSequence).toBe(first.body.throughSequence);

            for (const record of response.body.items) {
                const merged = session
                    .getState()
                    .items.find((entry) => entry.recordId === record.recordId);
                expect(merged).toMatchObject({ ...record, occurredAt: expect.any(String) });
                expect(Date.parse(merged?.occurredAt ?? '')).toBe(Date.parse(record.occurredAt));
            }
        }

        expect(eventSources).toHaveLength(1);
    });

    it.each(['telemetry'] as const)(
        'keeps additions before, during and between pages for %s',
        async (kind) => {
            const harness = await createRuntimeHarness();
            harnesses.push(harness);
            const activeBaseUrl = { current: harness.baseUrl };
            const updates = createUpdateQueue();
            const historyFetch = createHistoryFetch(() => activeBaseUrl.current);
            const session = createRoomHistorySession(
                {
                    kind,
                    deviceId: 'temp-desk',
                    metric: 'temperature',
                    ...telemetryRange,
                    pageSize: 1,
                },
                historyFetch.fetch,
            );
            const sourceFactory = createFetchEventSourceFactory(
                () => activeBaseUrl.current,
                eventSources,
            );
            const connection = connectRoomRealtime(
                {
                    onConnectionStatus() {},
                    onSnapshot() {},
                    onInvalidMessage() {
                        throw new Error('The production realtime client rejected an SSE message.');
                    },
                    onHistoryUpdate(update) {
                        session.acceptRealtime(update);
                        updates.push(update);
                    },
                },
                sourceFactory,
            );
            connections.push(connection);

            await updates.waitFor((update) => update.kind === 'baseline');

            const seenIds = new Set<string>();

            {
                harness.clock.advanceBy(1_000);
                harness.runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
            }

            await updates.waitFor((update) => hasAddition(update, kind, seenIds));

            const heldResponse = historyFetch.holdNextResponse();
            const firstPageLoad = session.loadFirstPage();
            const firstPage = await heldResponse.captured;
            expect(firstPage.status).toBe(200);
            expect(isRawTelemetryPage(firstPage.body)).toBe(true);

            {
                harness.clock.advanceBy(1_000);
                harness.runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
            }

            await updates.waitFor((update) => hasAddition(update, kind, seenIds));
            heldResponse.release();
            await firstPageLoad;

            expect(session.getState().nextCursor).not.toBeNull();

            {
                harness.clock.advanceBy(1_000);
                harness.runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
            }

            await updates.waitFor((update) => hasAddition(update, kind, seenIds));
            await session.loadNextPage();

            const state = session.getState();
            const finalIds = state.items.map((item) => item.recordId);
            expect(new Set(finalIds).size).toBe(finalIds.length);
            expect(historyFetch.responses).toHaveLength(2);
            const pagedIds = historyFetch.responses.flatMap((response) => {
                if (response.status !== 200) {
                    return [];
                }

                if (kind === 'telemetry' && isRawTelemetryPage(response.body)) {
                    return response.body.items.map((item) => item.recordId);
                }

                return [];
            });

            for (const pageId of pagedIds) {
                expect(finalIds).toContain(pageId);
            }

            for (const seenId of seenIds) {
                expect(finalIds).toContain(seenId);
            }

            const firstPageThroughSequence = firstPage.body as { throughSequence: number };
            const rawMessages = eventSources.at(-1)?.messages ?? [];
            const additionWatermarkPair = rawMessages.find(
                (message, index) =>
                    message.messageType === 'device.updated' &&
                    ('telemetrySample' in message && message.telemetrySample !== undefined
                        ? seenIds.has(message.telemetrySample.recordId)
                        : (('userHistory' in message ? message.userHistory : undefined) ?? []).some(
                              (event) => seenIds.has(event.recordId),
                          )) &&
                    rawMessages[index + 1]?.messageType === 'platform.updated',
            );
            const additionIndex = additionWatermarkPair
                ? rawMessages.indexOf(additionWatermarkPair)
                : -1;
            const watermark = rawMessages[additionIndex + 1];

            expect(additionWatermarkPair).toMatchObject({
                messageType: 'device.updated',
            });
            expect(watermark).toMatchObject({
                messageType: 'platform.updated',
                previousRevision: additionWatermarkPair?.revision,
                revision: (additionWatermarkPair?.revision ?? 0) + 1,
            });

            if (watermark?.messageType === 'platform.updated') {
                expect(watermark.payload.userHistory ?? []).toEqual([]);
                const previousWatermark = rawMessages
                    .slice(0, additionIndex)
                    .reverse()
                    .find(
                        (message) =>
                            message.messageType === 'platform.updated' ||
                            message.messageType === 'room.snapshot',
                    );
                const previousSequence =
                    previousWatermark?.messageType === 'platform.updated'
                        ? previousWatermark.payload.storage.storedThroughSequence
                        : previousWatermark?.messageType === 'room.snapshot'
                          ? previousWatermark.payload.platform.storage.storedThroughSequence
                          : undefined;

                expect(previousSequence).toBeDefined();
                expect(watermark.payload.storage.storedThroughSequence).toBeGreaterThan(
                    previousSequence ?? -1,
                );
            }

            const rawAdditionIds = rawMessages.flatMap((message) =>
                message.messageType === 'device.updated'
                    ? [
                          ...(('userHistory' in message ? message.userHistory : undefined)?.map(
                              (event) => event.recordId,
                          ) ?? []),
                          ...('telemetrySample' in message && message.telemetrySample
                              ? [message.telemetrySample.recordId]
                              : []),
                      ]
                    : [],
            );
            expect(new Set(rawAdditionIds).size).toBe(rawAdditionIds.length);

            expect(state.historyGenerationId).toBe(harness.historyGenerationId);
            expect(state.throughSequence).toBe(firstPageThroughSequence.throughSequence);
        },
    );

    it('restarts an expired cursor through HTTP and keeps SSE additions in the bounded overlay', async () => {
        const harness = await createRuntimeHarness();
        harnesses.push(harness);
        harness.clock.advanceBy(1000);
        harness.runtime.runDeviceScenario('led-main', 'disconnect_device');

        for (let index = 0; index < 51; index += 1) {
            const rejected = harness.runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            expect(rejected.status).toBe('rejected');
        }

        const baseUrl = { current: harness.baseUrl };
        const updates = createUpdateQueue();
        const session = createUserHistorySession(createHistoryFetch(() => baseUrl.current).fetch);
        const connection = connectRoomRealtime(
            {
                onConnectionStatus() {},
                onSnapshot() {},
                onInvalidMessage() {
                    throw new Error('The production realtime client rejected an SSE message.');
                },
                onHistoryUpdate(update) {
                    session.acceptRealtime(update);
                    updates.push(update);
                },
            },
            createFetchEventSourceFactory(() => baseUrl.current, eventSources),
        );
        connections.push(connection);
        await updates.waitFor((update) => update.kind === 'baseline');
        await session.loadNextPage();
        expect(session.getState().nextCursor).not.toBeNull();

        harness.clock.advanceBy(300_001);
        harness.runtime.runDeviceScenario('temp-desk', 'disconnect_device');
        const expiredAddition = await updates.waitFor(
            (update) => update.kind === 'addition' && (update.userHistory?.length ?? 0) > 0,
        );
        const expiredRecordIds =
            expiredAddition.kind === 'addition'
                ? (expiredAddition.userHistory?.map((event) => event.recordId) ?? [])
                : [];

        await session.loadNextPage();

        expect(session.getState()).toMatchObject({
            status: 'ready',
            historyGenerationId: harness.historyGenerationId,
        });
        expect(session.getState().items.map((item) => item.recordId)).toEqual(
            expect.arrayContaining(expiredRecordIds),
        );
    });

    it('refetches after same-generation reconnect while ignoring an older in-flight HTTP page', async () => {
        const harness = await createRuntimeHarness();
        harnesses.push(harness);
        const baseUrl = { current: harness.baseUrl };
        const updates = createUpdateQueue();
        const historyFetch = createHistoryFetch(() => baseUrl.current);
        const session = createUserHistorySession(historyFetch.fetch);
        const connection = connectRoomRealtime(
            {
                onConnectionStatus() {},
                onSnapshot() {},
                onInvalidMessage() {
                    throw new Error('The production realtime client rejected an SSE message.');
                },
                onHistoryUpdate(update) {
                    session.acceptRealtime(update);
                    updates.push(update);
                },
            },
            createFetchEventSourceFactory(() => baseUrl.current, eventSources),
            { reconnectDelayMs: 0 },
        );
        connections.push(connection);
        await updates.waitFor((update) => update.kind === 'baseline');

        const oldResponseGate = historyFetch.holdNextResponse();
        const firstLoad = session.loadNextPage();
        const oldResponse = await oldResponseGate.captured;
        expect(oldResponse.status).toBe(200);

        harness.clock.advanceBy(1_000);
        harness.runtime.runDeviceScenario('temp-desk', 'disconnect_device');
        const firstLiveAddition = await updates.waitFor(
            (update) => update.kind === 'addition' && (update.userHistory?.length ?? 0) > 0,
        );
        const firstLiveIds =
            firstLiveAddition.kind === 'addition'
                ? (firstLiveAddition.userHistory?.map((event) => event.recordId) ?? [])
                : [];

        const newResponseGate = historyFetch.holdNextResponse();
        const nextBaseline = updates.waitFor(
            (update) =>
                update.kind === 'baseline' &&
                update.storage.historyGenerationId === harness.historyGenerationId,
        );
        eventSources.at(-1)?.disconnect();
        await nextBaseline;
        const newResponse = await newResponseGate.captured;
        expect(newResponse.status).toBe(200);
        expect(newResponse.body).not.toEqual(oldResponse.body);

        harness.clock.advanceBy(1_000);
        harness.runtime.runDeviceScenario('temp-desk', 'reconnect_device');
        const secondLiveAddition = await updates.waitFor(
            (update) => update.kind === 'addition' && (update.userHistory?.length ?? 0) > 0,
        );
        const secondLiveIds =
            secondLiveAddition.kind === 'addition'
                ? (secondLiveAddition.userHistory?.map((event) => event.recordId) ?? [])
                : [];

        newResponseGate.release();
        await waitForCondition(() => session.getState().status === 'ready');
        const stateAfterNewResponse = session.getState();
        expect(stateAfterNewResponse.items.map((item) => item.recordId)).toEqual(
            expect.arrayContaining([...firstLiveIds, ...secondLiveIds]),
        );

        oldResponseGate.release();
        await firstLoad;
        expect(session.getState()).toEqual(stateAfterNewResponse);
        expect(historyFetch.responses).toHaveLength(2);
    });

    it('rebuilds an open session after reconnect to a replacement history generation', async () => {
        const original = await createRuntimeHarness();
        const replacement = await createRuntimeHarness();
        harnesses.push(original, replacement);
        expect(replacement.historyGenerationId).not.toBe(original.historyGenerationId);
        const baseUrl = { current: original.baseUrl };
        const updates = createUpdateQueue();
        const fetcher = createHistoryFetch(() => baseUrl.current);
        const session = createUserHistorySession(fetcher.fetch);
        const connection = connectRoomRealtime(
            {
                onConnectionStatus() {},
                onSnapshot() {},
                onInvalidMessage() {
                    throw new Error('The production realtime client rejected an SSE message.');
                },
                onHistoryUpdate(update) {
                    session.acceptRealtime(update);
                    updates.push(update);
                },
            },
            createFetchEventSourceFactory(() => baseUrl.current, eventSources),
            { reconnectDelayMs: 0 },
        );
        connections.push(connection);
        await updates.waitFor((update) => update.kind === 'baseline');
        await session.loadNextPage();
        const oldIds = session.getState().items.map((item) => item.recordId);

        original.clock.advanceBy(1_000);
        original.runtime.runDeviceScenario('temp-desk', 'disconnect_device');
        const oldGenerationAddition = await updates.waitFor(
            (update) => update.kind === 'addition' && (update.userHistory?.length ?? 0) > 0,
        );

        if (oldGenerationAddition.kind === 'addition') {
            oldGenerationAddition.userHistory?.forEach((event) => oldIds.push(event.recordId));
        }

        baseUrl.current = replacement.baseUrl;
        const nextBaseline = updates.waitFor(
            (update) =>
                update.kind === 'baseline' &&
                update.storage.historyGenerationId === replacement.historyGenerationId,
        );
        eventSources.at(-1)?.disconnect();
        await nextBaseline;
        await waitForCondition(() => session.getState().status === 'ready');

        const state = session.getState();
        expect(state.historyGenerationId).toBe(replacement.historyGenerationId);
        expect(state.items.map((item) => item.recordId)).not.toEqual(
            expect.arrayContaining(oldIds),
        );
    });

    it('keeps live data through a history 503 and refetches when reads recover', async () => {
        const harness = await createRuntimeHarness();
        harnesses.push(harness);
        const baseUrl = { current: harness.baseUrl };
        const updates = createUpdateQueue();
        const session = createRoomHistorySession(
            {
                kind: 'telemetry',
                deviceId: 'temp-desk',
                metric: 'temperature',
                ...telemetryRange,
                pageSize: 100,
            },
            createHistoryFetch(() => baseUrl.current).fetch,
        );
        const connection = connectRoomRealtime(
            {
                onConnectionStatus() {},
                onSnapshot() {},
                onInvalidMessage() {
                    throw new Error('The production realtime client rejected an SSE message.');
                },
                onHistoryUpdate(update) {
                    session.acceptRealtime(update);
                    updates.push(update);
                },
            },
            createFetchEventSourceFactory(() => baseUrl.current, eventSources),
        );
        connections.push(connection);
        await updates.waitFor((update) => update.kind === 'baseline');
        harness.setHistoryUnavailable(true);
        await session.loadFirstPage();
        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'history_unavailable',
            complete: false,
        });

        harness.setHistoryUnavailable(false);
        harness.clock.advanceBy(1_000);
        harness.runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
        const recoveredSample = await updates.waitFor(
            (update) => update.kind === 'addition' && update.telemetrySample !== undefined,
        );
        await waitForCondition(() => session.getState().status === 'ready');

        expect(recoveredSample.kind).toBe('addition');
        expect(session.getState()).toMatchObject({
            status: 'ready',
            complete: true,
            historyGenerationId: harness.historyGenerationId,
        });

        if (recoveredSample.kind === 'addition' && recoveredSample.telemetrySample) {
            expect(session.getState().items.map((item) => item.recordId)).toContain(
                recoveredSample.telemetrySample.recordId,
            );
        }
    });

    it('keeps volatile live telemetry through a real storage outage and refetches on available', async () => {
        const harness = await createRuntimeHarness();
        harnesses.push(harness);
        const updates = createUpdateQueue();
        const historyFetch = createHistoryFetch(() => harness.baseUrl);
        const session = createRoomHistorySession(
            {
                kind: 'telemetry',
                deviceId: 'temp-desk',
                metric: 'temperature',
                ...telemetryRange,
                pageSize: 100,
            },
            historyFetch.fetch,
        );
        const connection = connectRoomRealtime(
            {
                onConnectionStatus() {},
                onSnapshot() {},
                onInvalidMessage() {
                    throw new Error('The production realtime client rejected an SSE message.');
                },
                onHistoryUpdate(update) {
                    session.acceptRealtime(update);
                    updates.push(update);
                },
            },
            createFetchEventSourceFactory(() => harness.baseUrl, eventSources),
        );
        connections.push(connection);
        await updates.waitFor((update) => update.kind === 'baseline');
        harness.setStorageFailing(true);
        harness.clock.advanceBy(1_000);
        harness.runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

        const degraded = await updates.waitFor(
            (update) => update.kind === 'addition' && update.storage.status === 'degraded',
        );
        expect(degraded.kind).toBe('addition');

        const volatileAddition = await updates.waitFor(
            (update) => update.kind === 'addition' && update.telemetrySample !== undefined,
        );

        if (volatileAddition.kind !== 'addition' || !volatileAddition.telemetrySample) {
            throw new Error('The storage outage did not publish its live telemetry sample.');
        }

        const liveRecordId = volatileAddition.telemetrySample.recordId;
        const failedRead = session.loadFirstPage();
        await failedRead;
        expect(historyFetch.responses.at(-1)?.status).toBe(503);
        expect(session.getState()).toMatchObject({
            status: 'error',
            error: 'history_unavailable',
            complete: false,
        });
        expect(session.getState().items.map((item) => item.recordId)).toContain(liveRecordId);

        harness.setStorageFailing(false);
        harness.clock.advanceBy(1_000);
        harness.runStorageRecovery();
        await updates.waitFor(
            (update) => update.kind === 'addition' && update.storage.status === 'available',
        );
        await waitForCondition(() => session.getState().status === 'ready');

        expect(historyFetch.responses.map((response) => response.status)).toEqual([503, 200]);
        expect(session.getState()).toMatchObject({
            status: 'ready',
            complete: true,
            historyGenerationId: harness.historyGenerationId,
        });
        expect(session.getState().items.map((item) => item.recordId)).toContain(liveRecordId);
        expect(
            eventSources
                .at(-1)
                ?.messages.some(
                    (message) =>
                        message.messageType === 'platform.updated' &&
                        message.payload.storage.status === 'available',
                ),
        ).toBe(true);
    });
});

interface RuntimeHarness {
    baseUrl: string;
    historyGenerationId: string;
    clock: MutableClock;
    runtime: ReturnType<typeof createTemperatureRoomRuntime>;
    server: FastifyInstance;
    setHistoryUnavailable(unavailable: boolean): void;
    setStorageFailing(failing: boolean): void;
    runStorageRecovery(): void;
    close(): Promise<void>;
}

async function createRuntimeHarness(): Promise<RuntimeHarness> {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-history-transport-'));
    const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
    let storageFailing = false;
    const runtimeStorage = createFaultInjectingStorage(storage, () => storageFailing);
    const recoveryTimer = createManualIntervalTimer();
    const clock = createMutableClock(initialTime);
    const runtime = createTemperatureRoomRuntime({
        storage: runtimeStorage,
        storageFactory: () => runtimeStorage,
        clock,
        timer: manualTimer,
        recoveryTimer,
        storageRecoveryProbeIntervalMs: 1,
        intervalMs: 60_000,
        snapshotBroadcastIntervalMs: 60_000,
    });
    runtime.start();
    let historyUnavailable = false;
    const server = createRoomBffServer({
        getRoomSnapshot: runtime.getRoomSnapshot,
        getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
        readSignificantFactPage: (query) =>
            historyUnavailable ? { status: 'unavailable' } : runtime.readSignificantFactPage(query),
        readRawTelemetryPage: (query) =>
            historyUnavailable ? { status: 'unavailable' } : runtime.readRawTelemetryPage(query),
        readTrend: runtime.readTrend,
        subscribeRoomPublicationBatch: runtime.subscribeRoomPublicationBatch,
    });
    await server.listen({ port: 0, host: '127.0.0.1' });
    const address = server.server.address() as AddressInfo;

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        historyGenerationId: storage.getMetadata().historyGenerationId,
        clock,
        runtime,
        server,
        setHistoryUnavailable(unavailable) {
            historyUnavailable = unavailable;
        },
        setStorageFailing(failing) {
            storageFailing = failing;
        },
        runStorageRecovery() {
            recoveryTimer.runIntervals();
        },
        async close() {
            runtime.stop();
            await server.close();
            storage.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
}

interface CapturedHistoryResponse {
    status: number;
    body: unknown;
}

interface ResponseGate {
    captured: Promise<CapturedHistoryResponse>;
    release(): void;
}

function createHistoryFetch(getBaseUrl: () => string) {
    const responses: CapturedHistoryResponse[] = [];
    let nextGate:
        | {
              capture: (response: CapturedHistoryResponse) => void;
              wait: Promise<void>;
              release: () => void;
          }
        | undefined;

    return {
        fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const requested = new URL(typeof input === 'string' ? input : input.toString());
            const target = new URL(`${requested.pathname}${requested.search}`, getBaseUrl());
            const response = await fetch(target, init);

            if (requested.pathname.startsWith('/room/history/')) {
                const capturedResponse = {
                    status: response.status,
                    body: await response.clone().json(),
                };
                responses.push(capturedResponse);

                if (nextGate) {
                    const gate = nextGate;
                    nextGate = undefined;
                    gate.capture(capturedResponse);
                    await gate.wait;
                }
            }

            return response;
        }) as typeof fetch,
        holdNextResponse(): ResponseGate {
            if (nextGate) {
                throw new Error('Only one HTTP history response can be held at a time.');
            }

            let capture: ((response: CapturedHistoryResponse) => void) | undefined;
            let release: (() => void) | undefined;
            const captured = new Promise<CapturedHistoryResponse>((resolve) => {
                capture = resolve;
            });
            const wait = new Promise<void>((resolve) => {
                release = resolve;
            });
            nextGate = {
                capture(response) {
                    capture?.(response);
                },
                wait,
                release() {
                    release?.();
                },
            };

            return {
                captured,
                release() {
                    release?.();
                },
            };
        },
        responses,
    };
}

function createFetchEventSourceFactory(
    getBaseUrl: () => string,
    sources: FetchEventSource[],
): new (url: string) => FetchEventSource {
    return class BoundFetchEventSource extends FetchEventSource {
        constructor(url: string) {
            super(url, getBaseUrl);
            sources.push(this);
        }
    };
}

class FetchEventSource {
    private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    private readonly abortController = new AbortController();
    private isClosed = false;
    readonly messages: RoomBffRealtimeServerMessage[] = [];

    constructor(
        _url: string,
        private readonly getBaseUrl: () => string,
    ) {
        void this.readStream();
    }

    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
        if (!listener) {
            return;
        }

        const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    close(): void {
        this.isClosed = true;
        this.abortController.abort();
    }

    disconnect(): void {
        this.dispatch('error', new Event('error'));
    }

    private async readStream(): Promise<void> {
        try {
            const response = await fetch(`${this.getBaseUrl()}/room/realtime`, {
                signal: this.abortController.signal,
            });

            if (!response.ok || !response.body) {
                throw new Error('SSE endpoint did not provide a readable stream.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (!this.isClosed) {
                const result = await reader.read();

                if (result.done) {
                    break;
                }

                buffer += decoder.decode(result.value, { stream: true });
                let boundary = buffer.indexOf('\n\n');

                while (boundary >= 0) {
                    this.dispatchFrame(buffer.slice(0, boundary));
                    buffer = buffer.slice(boundary + 2);
                    boundary = buffer.indexOf('\n\n');
                }
            }

            if (!this.isClosed) {
                this.disconnect();
            }
        } catch {
            if (!this.isClosed) {
                this.disconnect();
            }
        }
    }

    private dispatchFrame(frame: string): void {
        const lines = frame.split(/\r?\n/u);
        const eventType = lines
            .find((line) => line.startsWith('event:'))
            ?.slice(6)
            .trim();
        const data = lines
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');

        if (eventType && data) {
            const message: unknown = JSON.parse(data);

            if (!isRoomBffRealtimeServerMessage(message)) {
                throw new Error('Invalid BFF SSE frame');
            }

            this.messages.push(message);
            this.dispatch(eventType, new MessageEvent(eventType, { data }));
        }
    }

    private dispatch(type: string, event: Event): void {
        this.listeners.get(type)?.forEach((listener) => {
            if (typeof listener === 'function') {
                listener(event);
            } else {
                listener.handleEvent(event);
            }
        });
    }
}

function createUpdateQueue() {
    const pending: RoomHistoryRealtimeUpdate[] = [];
    const waiters: Array<{
        predicate: (update: RoomHistoryRealtimeUpdate) => boolean;
        resolve(update: RoomHistoryRealtimeUpdate): void;
    }> = [];

    return {
        push(update: RoomHistoryRealtimeUpdate): void {
            for (const [index, waiter] of waiters.entries()) {
                if (waiter.predicate(update)) {
                    waiters.splice(index, 1);
                    waiter.resolve(update);

                    return;
                }
            }

            pending.push(update);
        },
        waitFor(
            predicate: (update: RoomHistoryRealtimeUpdate) => boolean,
        ): Promise<RoomHistoryRealtimeUpdate> {
            const existingIndex = pending.findIndex(predicate);

            if (existingIndex >= 0) {
                const [existing] = pending.splice(existingIndex, 1);

                if (existing) {
                    return Promise.resolve(existing);
                }
            }

            return new Promise((resolve) => waiters.push({ predicate, resolve }));
        },
    };
}

function hasAddition(
    update: RoomHistoryRealtimeUpdate,
    kind: 'significant-facts' | 'telemetry',
    seenIds: Set<string>,
): boolean {
    const additions =
        update.kind === 'addition'
            ? kind === 'significant-facts'
                ? (update.userHistory ?? [])
                : update.telemetrySample
                  ? [update.telemetrySample]
                  : []
            : [];

    if (additions.length === 0) {
        return false;
    }

    additions.forEach((item) => seenIds.add(item.recordId));

    return true;
}

function createMutableClock(start: string): MutableClock {
    let current = Date.parse(start);

    return {
        now: () => new Date(current).toISOString(),
        advanceBy(milliseconds) {
            current += milliseconds;
        },
    };
}

interface MutableClock {
    now(): string;
    advanceBy(milliseconds: number): void;
}

const manualTimer = {
    setInterval() {
        return 0;
    },
    clearInterval() {},
};

function createManualIntervalTimer(): {
    setInterval(callback: () => void): number;
    clearInterval(handle: unknown): void;
    runIntervals(): void;
} {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 0;

    return {
        setInterval(callback) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);

            return handle;
        },
        clearInterval(handle) {
            if (typeof handle === 'number') {
                callbacks.delete(handle);
            }
        },
        runIntervals() {
            [...callbacks.values()].forEach((callback) => callback());
        },
    };
}

function createFaultInjectingStorage(storage: RoomStorage, shouldFail: () => boolean): RoomStorage {
    return new Proxy(storage, {
        get(target, property) {
            if (property === 'close') {
                return () => {};
            }

            if (property === 'transact') {
                const transact: RoomStorage['transact'] = <Value>(
                    operation: (transaction: RoomStorageTransaction) => Value,
                    options: { retentionAsOf: string; beforeCommit?: () => boolean },
                ): StorageTransactionOutcome<Value> => {
                    if (shouldFail()) {
                        return {
                            status: 'confirmed_rolled_back',
                            error: new StorageAvailabilityError(
                                'Test-injected temporary storage outage.',
                                new Error('Storage unavailable in transport integration test.'),
                            ),
                        };
                    }

                    return target.transact(operation, options);
                };

                return transact;
            }

            const value: unknown = Reflect.get(target, property, target);

            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

async function waitForCondition(condition: () => boolean): Promise<void> {
    while (!condition()) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}
