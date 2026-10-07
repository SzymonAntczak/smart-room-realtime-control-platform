import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import {
    isRoomBffRealtimeServerMessage,
    isRoomBffSnapshot,
    type RoomBffRealtimeServerMessage,
} from '@smart-room/contracts/room-bff';
import { afterEach, expect, vi } from 'vitest';

import { createRoomBffServer } from '../../api/room-bff';
import type { RoomStorage } from '../../platform/storage/room-storage';
import { createSqliteRoomStorage } from '../../platform/storage/sqlite-room-storage';
import { StorageAvailabilityError } from '../../platform/storage/storage-errors';
import { createTemperatureRoomRuntime } from '../../runtime/temperature-room-runtime';

import { nativeSources } from './integration-setup';

const runtimes: Array<{ close(): Promise<void> }> = [];
let runtimeIdentity = 0;
afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
});

export async function createBackendIntegrationRuntime({
    start = '2026-09-26T10:00:00.000Z',
    intervalMs = 1000,
}: { start?: string; intervalMs?: number } = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-backend-integration-'));
    const disposers: Array<() => unknown> = [() => removeIntegrationDirectory(directory)];
    let closed = false;

    const close = async () => {
        if (closed) {
            return;
        }

        closed = true;
        const errors: unknown[] = [];

        for (const dispose of [...disposers].reverse()) {
            try {
                await dispose();
            } catch (error) {
                errors.push(error);
            }
        }

        if (errors.length > 0) {
            throw new AggregateError(errors, 'Backend integration cleanup failed');
        }
    };

    runtimes.push({ close });

    try {
        const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
        disposers.push(() => storage.close());
        let storageFailing = false;
        let readsFailing = false;
        let current = Date.parse(start);
        let identity = 0;
        const identityPrefix = ++runtimeIdentity;
        const clock = {
            now: () => new Date(current).toISOString(),
            advanceBy(milliseconds: number) {
                current += milliseconds;
                commandTimer.runDue();
            },
        };
        const commandTimer = createManualScheduler(() => current);
        const periodicTimer = createManualScheduler(() => current);
        const recoveryTimer = createManualScheduler(() => current);
        const runtimeStorage = faultInjectingStorage(
            storage,
            () => storageFailing,
            () => readsFailing,
        );
        const runtime = createTemperatureRoomRuntime({
            storage: runtimeStorage,
            storageFactory: () => runtimeStorage,
            clock,
            timer: periodicTimer,
            recoveryTimer,
            commandTimer,
            ledScenarioScheduler: commandTimer,
            intervalMs,
            snapshotBroadcastIntervalMs: 100,
            storageRecoveryProbeIntervalMs: 1,
            generateEventId: () => `integration-${identityPrefix}-event-${++identity}`,
            generateNativeMessageId: () => `integration-${identityPrefix}-native-${++identity}`,
            generateCommandId: () => `integration-${identityPrefix}-command-${++identity}`,
            historyCursorSecret: new Uint8Array(32).fill(1),
        });
        disposers.push(() => runtime.stop());
        const sources = {
            desk: nativeSources.temperature(),
            window: nativeSources.temperature('temp-window-native'),
            led: undefined as ReturnType<typeof nativeSources.led> | undefined,
        };
        const streams: Array<{ close(): Promise<void> }> = [];
        const server = createRoomBffServer({
            getRoomSnapshot: runtime.getRoomSnapshot,
            getDiagnosticsSnapshot: runtime.getDiagnosticsSnapshot,
            readSignificantFactPage: runtime.readSignificantFactPage,
            readRawTelemetryPage: runtime.readRawTelemetryPage,
            readTrend: runtime.readTrend,
            subscribeRoomPublicationBatch: runtime.subscribeRoomPublicationBatch,
            requestCommand: runtime.requestCommand,
            runDeviceScenario: runtime.runDeviceScenario,
            getDeviceScenarios: runtime.getDeviceScenarios,
            now: clock.now,
        });
        disposers.push(() => server.close());
        disposers.push(() => Promise.all(streams.map((stream) => stream.close())));
        runtime.start();
        sources.led = nativeSources.led();
        await server.listen({ host: '127.0.0.1', port: 0 });
        const address = server.server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;

        return {
            directory,
            storage,
            runtime,
            server,
            clock,
            sources,
            close,
            baseUrl,
            get historyGenerationId() {
                return storage.getMetadata().historyGenerationId;
            },
            led() {
                if (!sources.led) {
                    throw new Error('LED runtime did not start');
                }

                return sources.led;
            },
            setStorageFailing(failing: boolean) {
                storageFailing = failing;
            },
            setReadsFailing(failing: boolean) {
                readsFailing = failing;
            },
            runStorageRecovery() {
                recoveryTimer.runIntervals();
            },
            // The first interval is the runtime freshness evaluator; source ticks stay controlled.
            evaluateFreshness() {
                periodicTimer.runFirstInterval();
            },
            async request(path: string, init?: RequestInit) {
                const response = await fetch(new URL(path, baseUrl), init);
                const body: unknown = await response.json();

                return { status: response.status, body };
            },
            async snapshot() {
                const response = await fetch(`${baseUrl}/room`);
                const body: unknown = await response.json();

                if (!response.ok || !isRoomBffSnapshot(body)) {
                    throw new Error('Invalid room HTTP snapshot');
                }

                return body;
            },
            async connectSse() {
                const stream = await connectSse(`${baseUrl}/room/realtime`);
                streams.push(stream);

                return stream;
            },
        };
    } catch (error) {
        await close();

        throw error;
    }
}

export type BackendIntegrationRuntime = Awaited<ReturnType<typeof createBackendIntegrationRuntime>>;

async function connectSse(url: string) {
    const abort = new AbortController();
    const response = await fetch(url, { signal: abort.signal });

    if (!response.ok || !response.body) {
        throw new Error('SSE did not return a stream');
    }

    const reader = response.body.getReader();
    const messages: RoomBffRealtimeServerMessage[] = [];
    let failure: unknown;
    let closed = false;
    const reading = (async () => {
        let buffer = '';
        const decoder = new TextDecoder();

        try {
            while (!abort.signal.aborted) {
                const chunk = await reader.read();

                if (chunk.done) {
                    break;
                }

                buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
                let boundary = buffer.indexOf('\n\n');

                while (boundary >= 0) {
                    const frame = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const lines = frame.split('\n');
                    const event = lines
                        .find((line) => line.startsWith('event:'))
                        ?.slice(6)
                        .trim();
                    const data = lines
                        .filter((line) => line.startsWith('data:'))
                        .map((line) => line.slice(5).trimStart())
                        .join('\n');

                    if (event && data) {
                        const message: unknown = JSON.parse(data);

                        if (
                            !isRoomBffRealtimeServerMessage(message) ||
                            message.messageType !== event
                        ) {
                            throw new Error('Invalid BFF SSE frame');
                        }

                        messages.push(message);
                    }

                    boundary = buffer.indexOf('\n\n');
                }
            }
        } catch (error) {
            if (!abort.signal.aborted) {
                failure = error;
            }
        }
    })();
    const stream = {
        messages,
        async waitFor(predicate: (message: RoomBffRealtimeServerMessage) => boolean, after = 0) {
            await vi.waitFor(() => {
                if (failure) {
                    throw failure;
                }

                expect(messages.slice(after).some(predicate)).toBe(true);
            });
            const message = messages.slice(after).find(predicate);

            if (!message) {
                throw new Error('Expected SSE message');
            }

            return message;
        },
        async close() {
            if (closed) {
                return;
            }

            closed = true;
            abort.abort();
            await reading;
            reader.releaseLock();
        },
    };

    try {
        await stream.waitFor((message) => message.messageType === 'room.snapshot');
    } catch (error) {
        await stream.close();

        throw error;
    }

    return stream;
}

function createManualScheduler(now: () => number) {
    const timeouts = new Map<number, { due: number; callback(): void }>();
    const intervals = new Map<number, () => void>();
    let identity = 0;

    return {
        setTimeout(callback: () => void, delay: number) {
            const handle = ++identity;
            timeouts.set(handle, { due: now() + delay, callback });

            return handle;
        },
        clearTimeout(handle: unknown) {
            if (typeof handle === 'number') {
                timeouts.delete(handle);
            }
        },
        setInterval(callback: () => void) {
            const handle = ++identity;
            intervals.set(handle, callback);

            return handle;
        },
        clearInterval(handle: unknown) {
            if (typeof handle === 'number') {
                intervals.delete(handle);
            }
        },
        runDue() {
            for (const [handle, timeout] of [...timeouts]) {
                if (timeout.due <= now()) {
                    timeouts.delete(handle);
                    timeout.callback();
                }
            }
        },
        runIntervals() {
            [...intervals.values()].forEach((callback) => callback());
        },
        runFirstInterval() {
            intervals.values().next().value?.();
        },
    };
}

function faultInjectingStorage(
    storage: RoomStorage,
    writesFail: () => boolean,
    readsFail: () => boolean,
): RoomStorage {
    return new Proxy(storage, {
        get(target, property) {
            if (property === 'close') {
                return () => {};
            }

            if (property === 'transact') {
                const transact: RoomStorage['transact'] = (operation, options) => {
                    if (writesFail()) {
                        return {
                            status: 'confirmed_rolled_back',
                            error: new StorageAvailabilityError(
                                'Injected transaction failure',
                                null,
                            ),
                        };
                    }

                    return target.transact(operation, options);
                };

                return transact;
            }

            if (property === 'readPinnedSignificantFacts' || property === 'readPinnedTelemetry') {
                return (...args: unknown[]) => {
                    if (readsFail()) {
                        throw new StorageAvailabilityError('Injected history read failure', null);
                    }

                    const method = Reflect.get(target, property, target);

                    return Reflect.apply(method, target, args);
                };
            }

            const value: unknown = Reflect.get(target, property, target);

            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

function removeIntegrationDirectory(directory: string): void {
    if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !basename(directory).startsWith('smart-room-backend-integration-')
    ) {
        throw new Error('Unexpected backend integration directory');
    }

    rmSync(directory, { recursive: true, force: true });
}
