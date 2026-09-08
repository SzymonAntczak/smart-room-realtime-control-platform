import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
    ActiveCommandProjection,
    TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import type { RecentEventProjection } from '@smart-room/contracts/history';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';
import type { RoomPublicationBatch } from '@smart-room/contracts/realtime';
import type { Clock, TimerScheduler } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { inputFingerprint } from '../platform/event-processing/event-identity';
import { createRoomProjector } from '../platform/read-model/room-projection';
import type {
    AcceptedInputIdentity,
    LatestRoomProjectionInput,
    QuarantineEntryInput,
    RoomStorage,
    RoomStorageTransaction,
    SignificantFactInput,
    SimulatorCommandReceiptInput,
    StoredQuarantineEntry,
    StoredSignificantFact,
    StoredTelemetrySample,
    TelemetrySampleInput,
} from '../platform/storage/room-storage';
import type { RoomStorageLifecycle } from '../platform/storage/room-storage';
import { createSqliteRoomStorage } from '../platform/storage/sqlite-room-storage';
import {
    StorageAvailabilityError,
    StorageInvariantError,
    StorageManualInterventionError,
} from '../platform/storage/storage-errors';

import { createTemperatureRoomRuntime } from './temperature-room-runtime';

describe('createTemperatureRoomRuntime', () => {
    it('publishes ordinary runtime transitions as semantic batches', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateNativeMessageId: createEventIdGenerator(),
        });
        const batches: RoomPublicationBatch[] = [];
        runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            batches.length = 0;
            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

            expect(batches).toHaveLength(1);
            expect(batches[0]?.deltas).toEqual([
                expect.objectContaining({ messageType: 'device.updated' }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('retains recent caches through history retirement without publishing a cache removal', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-retention-'));
        const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
        const clock = createMutableClock('2026-08-01T10:00:00.000Z');
        const timer = createManualTimer();
        const baseline = createTemperatureRoomRuntime({ clock }).getRoomSnapshot();
        const cachedCommand = {
            commandId: 'cmd-retained-through-history-retirement',
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedAt: '2026-08-01T09:59:00.000Z',
            durability: 'durable',
            lifecycleDurability: 'durable',
            status: 'failed',
            failedAt: '2026-08-01T10:00:00.000Z',
            reason: 'device_rejected',
            message: 'The simulated LED rejected the command.',
        } satisfies TerminalCommandProjection;
        const cachedCommands = Array.from({ length: 20 }, (_, index) => ({
            ...cachedCommand,
            commandId: `cmd-retained-${String(19 - index).padStart(2, '0')}`,
        }));
        const cachedEvent = {
            recordId: 'platform:storage-gap:retained-through-history-retirement',
            eventType: 'storage.gap.recorded',
            occurredAt: '2026-08-01T10:00:00.000Z',
            durability: 'durable',
            storageSequence: 1,
            source: 'backend',
            payload: {
                outageStartedAt: '2026-08-01T09:00:00.000Z',
                outageEndedAt: '2026-08-01T10:00:00.000Z',
                failureReason: 'storage_write_failed',
                boundaryBasis: 'same_process_first_degraded_at',
                observationsBackfilled: false,
            },
        } satisfies RecentEventProjection;
        const cachedEvents = Array.from({ length: 20 }, (_, index) => ({
            ...cachedEvent,
            recordId: `platform:storage-gap:retained-${String(19 - index).padStart(2, '0')}`,
            storageSequence: 20 - index,
        }));
        let runtime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            storage.transact((transaction) => {
                transaction.appendSignificantFact({
                    recordId: 'history-retired-but-cache-retained',
                    eventId: 'history-retired-but-cache-retained-event',
                    eventType: 'device.availability.changed',
                    occurredAt: clock.now(),
                    payload: { availability: 'online' },
                });
                transaction.saveLatestRoomProjection({
                    updatedAt: baseline.updatedAt,
                    projection: {
                        updatedAt: baseline.updatedAt,
                        devices: baseline.devices,
                        activeCommands: baseline.activeCommands,
                        recentCommands: cachedCommands,
                    },
                    projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                    volatileGuards: [],
                    recentEvents: cachedEvents,
                });
            });

            runtime = createTemperatureRoomRuntime({
                clock,
                timer,
                intervalMs: 60_000,
                snapshotBroadcastIntervalMs: 1_000,
                storage,
                generateEventId: createEventIdGenerator(),
                generateNativeMessageId: createEventIdGenerator(),
            });
            runtime.start();
            const beforeRetirement = runtime.getRoomSnapshot();
            const batches: RoomPublicationBatch[] = [];
            runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

            clock.advanceBy(31 * 24 * 60 * 60 * 1_000);
            timer.run(1);

            expect(runtime.getRoomSnapshot().recentCommands).toEqual(
                beforeRetirement.recentCommands,
            );
            expect(runtime.getRoomSnapshot().recentEvents).toEqual(beforeRetirement.recentEvents);
            expect(storage.listSignificantFacts()).toEqual([]);
            expect(batches).toHaveLength(1);
            expect(batches[0]?.deltas).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ messageType: 'commands.updated' }),
                ]),
            );

            const oldestCommandId = beforeRetirement.recentCommands.at(-1)?.commandId;
            const oldestEventId = beforeRetirement.recentEvents.at(-1)?.recordId;

            if (!oldestCommandId || !oldestEventId) {
                throw new Error('Expected full recent caches before adding a new candidate.');
            }

            runtime.runDeviceScenario('led-main', 'reject_command');
            const response = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });

            if (response.status !== 'accepted') {
                throw new Error('Expected a command admission before simulated rejection.');
            }

            await flushCommandDispatch();

            const afterCandidate = runtime.getRoomSnapshot();
            expect(afterCandidate.recentCommands).toHaveLength(20);
            expect(afterCandidate.recentCommands[0]).toMatchObject({
                commandId: response.commandId,
                status: 'failed',
            });
            expect(
                afterCandidate.recentCommands.some(
                    (command) => command.commandId === oldestCommandId,
                ),
            ).toBe(false);
            expect(afterCandidate.recentEvents).toHaveLength(20);
            expect(
                afterCandidate.recentEvents.some(
                    (event) => 'commandId' in event && event.commandId === response.commandId,
                ),
            ).toBe(true);
            expect(
                afterCandidate.recentEvents.some((event) => event.recordId === oldestEventId),
            ).toBe(false);
        } finally {
            runtime?.stop();
            storage.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('keeps the same greatest command cache through live insertion, checkpoint restore and recovery', () => {
        const clock = createMutableClock('2026-09-03T09:00:00.000Z');
        const projector = createRoomProjector({
            initialUpdatedAt: clock.now(),
            devices: [{ deviceId: 'led-main', name: 'Main LED', role: 'led-output' }],
        });
        const terminalAt = '2026-09-03T09:00:02.000Z';

        for (let index = 0; index < 23; index += 1) {
            const commandId = `cmd-tied-${String(index).padStart(2, '0')}`;
            projector.applyCommandRequested({
                eventId: `evt-requested-${commandId}`,
                eventType: 'command.requested',
                occurredAt: '2026-09-03T09:00:00.000Z',
                source: 'backend',
                deviceId: 'led-main',
                commandId,
                payload: {
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                    requestedBy: 'user',
                },
            });
            projector.applyCommandFailed({
                eventId: `evt-failed-${commandId}`,
                eventType: 'command.failed',
                occurredAt: terminalAt,
                source: 'backend',
                deviceId: 'led-main',
                commandId,
                payload: {
                    reason: 'device_rejected',
                    message: 'The simulated LED rejected the command.',
                },
            });
        }

        const liveProjection = projector.getProjection();
        const checkpoint: LatestRoomProjectionInput = {
            updatedAt: liveProjection.updatedAt,
            projection: liveProjection,
            projectionEvidence: projector.getEvidence(),
            volatileGuards: [],
            recentEvents: [],
        };
        const expectedCommandIds = Array.from(
            { length: 20 },
            (_, index) => `cmd-tied-${String(22 - index).padStart(2, '0')}`,
        );
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-cache-ordering-'));
        const databasePath = join(directory, 'room.sqlite');
        const initialStorage = createSqliteRoomStorage({ databasePath });
        let restoredStorage: ReturnType<typeof createSqliteRoomStorage> | undefined;
        let restoredRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;
        let recoveryRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            initialStorage.transact((transaction) =>
                transaction.saveLatestRoomProjection(checkpoint),
            );
            expect(liveProjection.recentCommands.map((command) => command.commandId)).toEqual(
                expectedCommandIds,
            );
            initialStorage.close();

            restoredStorage = createSqliteRoomStorage({ databasePath });
            restoredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: restoredStorage,
                timer: createManualTimer(),
            });
            expect(restoredRuntime.getRoomSnapshot().recentCommands).toEqual(
                liveProjection.recentCommands,
            );

            const recoveryStorage = createScriptedStorage();
            recoveryStorage.seedCheckpoint(checkpoint);
            const recoveryTimer = createManualTimer();
            let factoryCalls = 0;
            recoveryRuntime = createTemperatureRoomRuntime({
                clock,
                timer: createManualTimer(),
                recoveryTimer,
                storageFactory() {
                    factoryCalls += 1;

                    if (factoryCalls === 1) {
                        throw new StorageAvailabilityError('database is busy', undefined);
                    }

                    return recoveryStorage.port;
                },
                generateEventId: createEventIdGenerator(),
                generateNativeMessageId: createEventIdGenerator(),
            });
            recoveryRuntime.start();
            recoveryTimer.runLatest();

            expect(recoveryRuntime.getRoomSnapshot().recentCommands).toEqual(
                liveProjection.recentCommands,
            );
        } finally {
            initialStorage.close();
            restoredRuntime?.stop();
            restoredStorage?.close();
            recoveryRuntime?.stop();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('does not deliver an in-flight batch to a reentrantly registered subscriber', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            generateNativeMessageId: createEventIdGenerator(),
        });
        let reentrantBatches = 0;
        let registered = false;

        try {
            runtime.start();
            runtime.subscribeRoomPublicationBatch(() => {
                if (registered) {
                    return;
                }

                registered = true;
                runtime.subscribeRoomPublicationBatch(() => {
                    reentrantBatches += 1;
                });
            });

            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

            expect(reentrantBatches).toBe(0);
            expect(runtime.getRoomSnapshot().devices).toEqual(
                expect.arrayContaining([expect.objectContaining({ deviceId: 'temp-desk' })]),
            );

            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
            expect(reentrantBatches).toBe(1);
        } finally {
            runtime.stop();
        }
    });

    it('does not deliver an in-flight batch to a subscriber registered by a snapshot listener', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            generateNativeMessageId: createEventIdGenerator(),
        });
        let registered = false;
        let reentrantBatches = 0;

        try {
            runtime.start();
            runtime.subscribeRoomSnapshot(() => {
                if (registered) {
                    return;
                }

                registered = true;
                runtime.subscribeRoomPublicationBatch(() => {
                    reentrantBatches += 1;
                });
            });

            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
            expect(reentrantBatches).toBe(0);

            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
            expect(reentrantBatches).toBe(1);
        } finally {
            runtime.stop();
        }
    });

    it('terminates instead of continuing volatile after a rolled-back fatal storage error', () => {
        const fatalError = new StorageInvariantError('broken storage invariant', undefined);
        const storage = {
            getLatestRoomProjection() {
                return undefined;
            },
            transact() {
                return { status: 'confirmed_rolled_back' as const, error: fatalError };
            },
        } as unknown as RoomStorage;

        expect(() =>
            createTemperatureRoomRuntime({
                storage,
                clock: createMutableClock('2026-06-08T09:30:00Z'),
            }),
        ).toThrow('storage_fatal_error');
    });

    it('labels only an indeterminate storage outcome as unknown', () => {
        const storage = {
            transact() {
                return { status: 'indeterminate' as const, error: new Error('commit uncertain') };
            },
        } as unknown as RoomStorage;

        expect(() =>
            createTemperatureRoomRuntime({
                storage,
                clock: createMutableClock('2026-06-08T09:30:00Z'),
            }),
        ).toThrow('storage_commit_outcome_unknown');
    });

    it('terminates when closing the runtime session rolls back a fatal storage error', () => {
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            storage: storage.port,
            clock: createMutableClock('2026-06-08T09:30:00Z'),
            onFatalStorageError(error): never {
                throw error;
            },
        });

        runtime.start();
        storage.failNext(
            'confirmed_rolled_back',
            new StorageInvariantError('session close invariant failed', undefined),
        );

        expect(() => runtime.stop()).toThrow('storage_fatal_error');
    });

    it('starts degraded when a checkpoint read has an availability failure', () => {
        const storage = {
            transact() {
                return { status: 'committed' as const, value: [] };
            },
            getLatestRoomProjection() {
                throw new StorageAvailabilityError('database is busy', undefined);
            },
        } as unknown as RoomStorage;
        const runtime = createTemperatureRoomRuntime({
            storage,
            clock: createMutableClock('2026-06-08T09:30:00Z'),
        });

        try {
            runtime.start();

            expect(runtime.getRoomSnapshot().platform.storage).toEqual({
                status: 'degraded',
                changedAt: '2026-06-08T09:30:00.000Z',
                reason: 'storage_write_failed',
                historyGenerationId: null,
                storedThroughSequence: null,
            });
        } finally {
            runtime.stop();
        }
    });

    it('probes an availability startup failure, records one durable gap, and returns to available', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const runtimeTimer = createManualTimer();
        const recoveryTimer = createManualTimer();
        const recoveredStorage = createScriptedStorage();
        let attempts = 0;
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: runtimeTimer,
            recoveryTimer,
            storageRecoveryProbeIntervalMs: 5_000,
            storageFactory() {
                attempts += 1;

                if (attempts === 1) {
                    throw new StorageAvailabilityError('database is busy', undefined);
                }

                return recoveredStorage.port;
            },
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: Array<ReturnType<typeof runtime.getRoomSnapshot>> = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('degraded');
            expect(recoveryTimer.intervals).toEqual([5_000]);

            clock.advanceBy(5_000);
            recoveryTimer.runLatest();

            expect(snapshots.map((snapshot) => snapshot.platform.storage.status)).toContain(
                'recovering',
            );
            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('available');
            expect(recoveredStorage.significantFacts).toMatchObject([
                {
                    eventType: 'storage.gap.recorded',
                    payload: { boundaryBasis: 'degraded_startup_at' },
                },
            ]);
            expect(runtime.getRoomSnapshot().recentEvents).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventType: 'storage.gap.recorded',
                        durability: 'durable',
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('does not schedule automatic recovery for manual-intervention startup failures', () => {
        const recoveryTimer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-09-03T09:00:00Z'),
            timer: createManualTimer(),
            recoveryTimer,
            storageFactory() {
                throw new StorageManualInterventionError('foreign database', undefined);
            },
        });

        try {
            runtime.start();

            expect(runtime.getRoomSnapshot().platform.storage).toMatchObject({
                status: 'degraded',
                reason: 'storage_manual_intervention_required',
            });
            expect(recoveryTimer.intervals).toEqual([]);
        } finally {
            runtime.stop();
        }
    });

    it('cancels an availability probe schedule when recovery requires manual intervention', () => {
        const recoveryTimer = createManualTimer();
        let probes = 0;
        const lifecycle: RoomStorageLifecycle = {
            openAtStartup() {
                return {
                    kind: 'degraded',
                    error: new StorageAvailabilityError('startup unavailable', undefined),
                };
            },
            probe() {
                probes += 1;

                throw new StorageManualInterventionError('foreign database', undefined);
            },
            cutover() {
                throw new Error('manual probe must not cut over');
            },
        };
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-09-03T09:00:00Z'),
            timer: createManualTimer(),
            recoveryTimer,
            storageLifecycle: lifecycle,
        });

        try {
            runtime.start();
            recoveryTimer.runLatest();
            recoveryTimer.runLatest();

            expect(probes).toBe(1);
            expect(runtime.getRoomSnapshot().platform.storage).toMatchObject({
                status: 'degraded',
                reason: 'storage_manual_intervention_required',
            });
        } finally {
            runtime.stop();
        }
    });

    it('preserves verified startup generation metadata after a recoverable checkpoint read', () => {
        const recoveryTimer = createManualTimer();
        let probeContext: { verifiedHistoryGenerationId: string | undefined } | undefined;
        const storage = {
            transact() {
                return { status: 'committed' as const, value: [] };
            },
            getMetadata() {
                return {
                    historyGenerationId: 'verified-generation',
                    schemaVersion: 3,
                    lastStorageSequence: 17,
                };
            },
            getLatestRoomProjection() {
                throw new StorageAvailabilityError('checkpoint read unavailable', undefined);
            },
        } as unknown as RoomStorage;
        const lifecycle: RoomStorageLifecycle = {
            openAtStartup() {
                return { kind: 'available', storage, metadata: storage.getMetadata() };
            },
            probe(context) {
                probeContext = context;

                throw new StorageAvailabilityError('still unavailable', undefined);
            },
            cutover() {
                throw new Error('unavailable probe must not cut over');
            },
        };
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-09-03T09:00:00Z'),
            timer: createManualTimer(),
            recoveryTimer,
            storageLifecycle: lifecycle,
        });

        try {
            runtime.start();
            expect(runtime.getRoomSnapshot().platform.storage).toMatchObject({
                status: 'degraded',
                historyGenerationId: 'verified-generation',
                storedThroughSequence: 17,
            });
            recoveryTimer.runLatest();
            expect(probeContext).toEqual({ verifiedHistoryGenerationId: 'verified-generation' });
        } finally {
            runtime.stop();
        }
    });

    it('publishes the degraded reversal when a target appears after a first-init probe', () => {
        const recoveryTimer = createManualTimer();
        const lifecycle: RoomStorageLifecycle = {
            openAtStartup() {
                return {
                    kind: 'degraded',
                    error: new StorageAvailabilityError('startup unavailable', undefined),
                };
            },
            probe() {
                return { kind: 'first_initialization' };
            },
            cutover() {
                return { status: 'aborted' };
            },
        };
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-09-03T09:00:00Z'),
            timer: createManualTimer(),
            recoveryTimer,
            storageLifecycle: lifecycle,
        });
        const batches: RoomPublicationBatch[] = [];
        runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            recoveryTimer.runLatest();

            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('degraded');
            expect(
                batches.slice(-2).map((batch) => batch.snapshot.platform.storage.status),
            ).toEqual(['recovering', 'degraded']);
        } finally {
            runtime.stop();
        }
    });

    it('retains a generation verified by an aborted recovery cutover', () => {
        const recoveryTimer = createManualTimer();
        const probeContexts: Array<string | undefined> = [];
        const candidate = {
            getMetadata() {
                return {
                    historyGenerationId: 'recovered-generation',
                    schemaVersion: 3,
                    lastStorageSequence: 0,
                };
            },
            getLatestRoomProjection() {
                return undefined;
            },
            listAcceptedInputIdentities() {
                return [];
            },
            close() {},
        } as unknown as RoomStorage;
        const lifecycle: RoomStorageLifecycle = {
            openAtStartup() {
                return {
                    kind: 'degraded',
                    error: new StorageAvailabilityError('startup unavailable', undefined),
                };
            },
            probe(context) {
                probeContexts.push(context.verifiedHistoryGenerationId);

                return {
                    kind: 'existing_generation',
                    storage: candidate,
                    metadata: candidate.getMetadata(),
                };
            },
            cutover() {
                return { status: 'aborted' };
            },
        };
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-09-03T09:00:00Z'),
            timer: createManualTimer(),
            recoveryTimer,
            storageLifecycle: lifecycle,
        });

        try {
            runtime.start();
            recoveryTimer.runLatest();
            recoveryTimer.runLatest();

            expect(probeContexts).toEqual([undefined, 'recovered-generation']);
        } finally {
            runtime.stop();
        }
    });

    it('terminates on an indeterminate recovery cutover without returning to available', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const recoveryTimer = createManualTimer();
        let queuedRawInput = false;
        const lifecycle: RoomStorageLifecycle = {
            openAtStartup() {
                return {
                    kind: 'degraded',
                    error: new StorageAvailabilityError('startup unavailable', undefined),
                };
            },
            probe() {
                return { kind: 'first_initialization' };
            },
            cutover() {
                runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
                queuedRawInput = true;

                return {
                    status: 'indeterminate',
                    error: new StorageInvariantError('commit outcome unknown', undefined),
                };
            },
        };
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            recoveryTimer,
            storageLifecycle: lifecycle,
            onFatalStorageError(error): never {
                throw error;
            },
        });
        const batches: RoomPublicationBatch[] = [];
        runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            batches.length = 0;
            clock.advanceBy(5_000);

            expect(() => recoveryTimer.runLatest()).toThrow('storage_commit_outcome_unknown');
            expect(queuedRawInput).toBe(true);
            expect(runtime.getRoomSnapshot().platform.storage.status).not.toBe('available');
            expect(device(runtime, 'temp-desk')).toMatchObject({
                reportedState: { temperature: 22, temperatureUnit: 'celsius' },
            });
            expect(batches).toEqual([
                expect.objectContaining({
                    snapshot: expect.objectContaining({
                        platform: expect.objectContaining({
                            storage: expect.objectContaining({ status: 'recovering' }),
                        }),
                    }),
                }),
            ]);
            expect(runtime.getRoomSnapshot().recentEvents).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ eventType: 'storage.gap.recorded' }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('does not drain raw recovery FIFO after a fatal confirmed rollback', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const recoveryTimer = createManualTimer();
        const lifecycle: RoomStorageLifecycle = {
            openAtStartup() {
                return {
                    kind: 'degraded',
                    error: new StorageAvailabilityError('startup unavailable', undefined),
                };
            },
            probe() {
                return { kind: 'first_initialization' };
            },
            cutover() {
                runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

                return {
                    status: 'confirmed_rolled_back',
                    error: new StorageInvariantError('fatal recovery rollback', undefined),
                };
            },
        };
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            recoveryTimer,
            storageLifecycle: lifecycle,
            onFatalStorageError(error): never {
                throw error;
            },
        });
        const batches: RoomPublicationBatch[] = [];
        runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            batches.length = 0;
            clock.advanceBy(5_000);

            expect(() => recoveryTimer.runLatest()).toThrow('storage_fatal_error');
            expect(device(runtime, 'temp-desk')).toMatchObject({
                reportedState: { temperature: 22, temperatureUnit: 'celsius' },
            });
            expect(batches).toEqual([
                expect.objectContaining({
                    snapshot: expect.objectContaining({
                        platform: expect.objectContaining({
                            storage: expect.objectContaining({ status: 'recovering' }),
                        }),
                    }),
                }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('drains raw recovery FIFO against the resolved durable or volatile projection', () => {
        const runRecovery = (outcome: 'committed' | 'confirmed_rolled_back') => {
            const clock = createMutableClock('2026-09-03T09:00:00Z');
            const recoveryTimer = createManualTimer();
            const storage = createScriptedStorage();
            const lifecycle: RoomStorageLifecycle = {
                openAtStartup() {
                    return {
                        kind: 'degraded',
                        error: new StorageAvailabilityError('startup unavailable', undefined),
                    };
                },
                probe() {
                    return {
                        kind: 'existing_generation',
                        storage: storage.port,
                        metadata: storage.port.getMetadata(),
                    };
                },
                cutover(input) {
                    runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

                    if (outcome === 'confirmed_rolled_back') {
                        return {
                            status: 'confirmed_rolled_back',
                            error: new StorageAvailabilityError(
                                'recovery write unavailable',
                                undefined,
                            ),
                        };
                    }

                    const transactionOutcome = storage.port.transact(input.operation);

                    if (transactionOutcome.status !== 'committed') {
                        throw new Error('Scripted recovery transaction did not commit.');
                    }

                    return {
                        status: 'committed',
                        value: transactionOutcome.value,
                        storage: storage.port,
                        metadata: storage.port.getMetadata(),
                    };
                },
            };
            const runtime = createTemperatureRoomRuntime({
                clock,
                timer: createManualTimer(),
                recoveryTimer,
                storageLifecycle: lifecycle,
            });

            try {
                runtime.start();
                clock.advanceBy(5_000);
                recoveryTimer.runLatest();

                return {
                    snapshot: runtime.getRoomSnapshot(),
                    telemetrySamples: storage.telemetrySamples,
                };
            } finally {
                runtime.stop();
            }
        };

        const committed = runRecovery('committed');
        expect(committed.snapshot.platform.storage.status).toBe('available');
        expect(
            committed.snapshot.devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            reportedState: { temperature: 22.2, temperatureUnit: 'celsius' },
            observationStatus: { temperature: { durability: 'durable' } },
        });
        expect(committed.telemetrySamples).toEqual([expect.objectContaining({ value: 22.2 })]);

        const rolledBack = runRecovery('confirmed_rolled_back');
        expect(rolledBack.snapshot.platform.storage.status).toBe('degraded');
        expect(
            rolledBack.snapshot.devices.find((device) => device.deviceId === 'temp-desk'),
        ).toMatchObject({
            reportedState: { temperature: 22.2, temperatureUnit: 'celsius' },
            observationStatus: { temperature: { durability: 'volatile' } },
        });
        expect(rolledBack.telemetrySamples).toEqual([]);
    });

    it('merges the recovered durable event cache with newer volatile recovery evidence', () => {
        const storage = createScriptedStorage();
        const durableClock = createMutableClock('2026-09-03T09:00:00Z');
        const durableRuntime = createTemperatureRoomRuntime({
            storage: storage.port,
            clock: durableClock,
            timer: createManualTimer(),
            generateEventId: createEventIdGenerator(),
        });

        durableRuntime.start();
        durableRuntime.stop();
        const checkpoint = storage.latestCheckpoint;

        if (!checkpoint) {
            throw new Error('Durable source did not write its checkpoint.');
        }

        const futureCache: RecentEventProjection[] = Array.from({ length: 20 }, (_, index) => ({
            recordId: `future-fact-${index}`,
            eventType: 'device.availability.changed' as const,
            occurredAt: '2026-09-03T09:02:00.000Z',
            durability: 'durable' as const,
            storageSequence: index + 1,
            deviceId: 'temp-desk',
            source: 'simulator-adapter' as const,
            payload: {
                previousAvailability: 'unknown' as const,
                availability: 'online' as const,
                reason: 'future_skew_fixture',
            },
        }));
        storage.seedCheckpoint({ ...checkpoint, recentEvents: futureCache });

        const recoveryClock = createMutableClock('2026-09-03T09:01:00Z');
        const recoveryTimer = createManualTimer();
        let factoryCalls = 0;
        const runtime = createTemperatureRoomRuntime({
            clock: recoveryClock,
            timer: createManualTimer(),
            recoveryTimer,
            storageFactory() {
                factoryCalls += 1;

                if (factoryCalls === 1) {
                    throw new StorageAvailabilityError('database is busy', undefined);
                }

                return storage.port;
            },
            generateEventId: createEventIdGenerator(),
        });
        const batches: RoomPublicationBatch[] = [];
        runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            recoveryTimer.runLatest();

            expect(batches.at(-1)?.deltas).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        messageType: 'platform.updated',
                        payload: expect.objectContaining({
                            recentEvents: [
                                expect.objectContaining({ eventType: 'storage.gap.recorded' }),
                            ],
                        }),
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('keeps a newer volatile observation when durable recovery evidence is unknown', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const source = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
        });
        source.start();
        const sourceSnapshot = source.getRoomSnapshot();
        source.stop();

        const storage = createScriptedStorage();
        storage.seedCheckpoint({
            updatedAt: sourceSnapshot.updatedAt,
            projection: {
                updatedAt: sourceSnapshot.updatedAt,
                devices: sourceSnapshot.devices.map((device) =>
                    device.deviceId === 'temp-desk'
                        ? {
                              ...device,
                              reportedState: undefined,
                              observationStatus: {
                                  ...device.observationStatus,
                                  temperature: { freshness: 'unknown', durability: 'durable' },
                              },
                          }
                        : device,
                ),
                activeCommands: sourceSnapshot.activeCommands,
                recentCommands: sourceSnapshot.recentCommands,
            },
            projectionEvidence: {
                availabilityDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
                healthDeviceIds: [],
            },
            volatileGuards: [],
            recentEvents: [],
        });
        const recoveryTimer = createManualTimer();
        let factoryCalls = 0;
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            recoveryTimer,
            storageFactory() {
                factoryCalls += 1;

                if (factoryCalls === 1) {
                    throw new StorageAvailabilityError('startup unavailable', undefined);
                }

                return storage.port;
            },
        });

        try {
            runtime.start();
            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');
            const volatileDevice = device(runtime, 'temp-desk');
            const volatileObservation = volatileDevice?.observationStatus.temperature;

            expect(volatileObservation?.lastObservedAt).toBeDefined();
            expect(volatileObservation?.durability).toBe('volatile');

            recoveryTimer.runLatest();

            expect(device(runtime, 'temp-desk')?.observationStatus.temperature).toEqual(
                volatileObservation,
            );
            expect(device(runtime, 'temp-desk')?.reportedState).toEqual(
                volatileDevice?.reportedState,
            );
        } finally {
            runtime.stop();
        }
    });

    it('merges complete newer device dimensions and volatile-only observations during recovery', () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const source = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
        });
        source.start();
        const sourceSnapshot = source.getRoomSnapshot();
        source.stop();

        const storage = createScriptedStorage();
        storage.seedCheckpoint({
            updatedAt: '2026-09-03T08:00:00.000Z',
            projection: {
                updatedAt: '2026-09-03T08:00:00.000Z',
                devices: sourceSnapshot.devices.map((device) =>
                    device.deviceId === 'led-main'
                        ? {
                              ...device,
                              availability: 'offline',
                              availabilityChangedAt: '2026-09-03T08:00:00.000Z',
                              availabilityDurability: 'durable',
                              availabilityReason: 'device_disconnected',
                              health: 'degraded',
                              healthChangedAt: '2026-09-03T08:00:00.000Z',
                              healthDurability: 'durable',
                              healthReason: 'partial_data',
                              reportedState: {},
                              observationStatus: {},
                              commandAvailability: {
                                  policy: 'block',
                                  reason: 'device_offline',
                              },
                          }
                        : device,
                ),
                activeCommands: sourceSnapshot.activeCommands,
                recentCommands: sourceSnapshot.recentCommands,
            },
            projectionEvidence: {
                availabilityDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
                healthDeviceIds: ['led-main'],
            },
            volatileGuards: [],
            recentEvents: [],
        });
        const recoveryTimer = createManualTimer();
        let factoryCalls = 0;
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            recoveryTimer,
            storageFactory() {
                factoryCalls += 1;

                if (factoryCalls === 1) {
                    throw new StorageAvailabilityError('startup unavailable', undefined);
                }

                return storage.port;
            },
        });

        try {
            runtime.start();
            recoveryTimer.runLatest();

            expect(device(runtime, 'led-main')).toMatchObject({
                availability: 'online',
                availabilityDurability: 'volatile',
                health: 'unknown',
                healthDurability: 'volatile',
                reportedState: { power: 'off' },
                observationStatus: {
                    power: expect.objectContaining({ durability: 'volatile' }),
                },
                commandAvailability: { policy: 'allow' },
            });
            expect(device(runtime, 'led-main')).not.toHaveProperty('availabilityReason');
            expect(device(runtime, 'led-main')).not.toHaveProperty('healthReason');
        } finally {
            runtime.stop();
        }
    });

    it('holds recovery for a volatile-durable active-command conflict and retries after terminalization', async () => {
        const clock = createMutableClock('2026-09-03T09:00:00Z');
        const durableSource = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            ledScenario: 'omit_confirmation',
            commandTimer: createCommandTimer(),
        });
        const storage = createScriptedStorage();
        const recoveryTimer = createManualTimer();
        const commandTimer = createCommandTimer();
        let factoryCalls = 0;
        let runtime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            durableSource.start();
            const durableCommand = durableSource.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            const durableSnapshot = durableSource.getRoomSnapshot();
            expect(durableSnapshot.activeCommands).toEqual([
                expect.objectContaining({ commandId: durableCommand.commandId }),
            ]);
            durableSource.stop();
            storage.seedCheckpoint({
                updatedAt: durableSnapshot.updatedAt,
                projection: {
                    updatedAt: durableSnapshot.updatedAt,
                    devices: durableSnapshot.devices,
                    activeCommands: durableSnapshot.activeCommands.map((command) => ({
                        ...command,
                        durability: 'durable' as const,
                        lifecycleDurability: 'durable' as const,
                    })),
                    recentCommands: durableSnapshot.recentCommands,
                },
                projectionEvidence: {
                    availabilityDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
                    healthDeviceIds: [],
                },
                volatileGuards: [],
                recentEvents: [],
            });

            runtime = createTemperatureRoomRuntime({
                clock,
                timer: createManualTimer(),
                recoveryTimer,
                ledScenario: 'omit_confirmation',
                commandTimer,
                storageFactory() {
                    factoryCalls += 1;

                    if (factoryCalls === 1) {
                        throw new StorageAvailabilityError('startup unavailable', undefined);
                    }

                    return storage.port;
                },
            });
            runtime.start();
            const volatileCommand = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            expect(volatileCommand).toMatchObject({ status: 'accepted', durability: 'volatile' });
            await flushCommandDispatch();

            expect(runtime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({ commandId: volatileCommand.commandId }),
            ]);

            recoveryTimer.runLatest();

            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('recovering');
            expect(
                runtime.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            ).toMatchObject({ error: 'platform_recovering', retryable: true });

            commandTimer.runAll();
            recoveryTimer.runLatest();

            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('available');
            expect(runtime.getRoomSnapshot().recentCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        commandId: volatileCommand.commandId,
                        status: 'timed_out',
                    }),
                ]),
            );
            expect(runtime.getRoomSnapshot().activeCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ commandId: durableCommand.commandId }),
                ]),
            );
        } finally {
            durableSource.stop();
            runtime?.stop();
        }
    });

    it('runs startup retention before loading accepted input identities', () => {
        const calls: string[] = [];
        const storage = {
            getLatestRoomProjection() {
                calls.push('checkpoint');

                return undefined;
            },
            listAcceptedInputIdentities() {
                calls.push('identities');

                return [];
            },
            getMetadata() {
                calls.push('metadata');

                return {
                    historyGenerationId: 'test-generation',
                    schemaVersion: 1,
                    lastStorageSequence: 0,
                };
            },
            transact(
                operation: (transaction: {
                    retireExpiredRecords(): string[];
                    saveLatestRoomProjection(): void;
                }) => unknown,
            ) {
                const value = operation({
                    retireExpiredRecords() {
                        calls.push('retention');

                        return [];
                    },
                    saveLatestRoomProjection() {
                        calls.push('checkpoint-save');
                    },
                });

                return { status: 'committed' as const, value };
            },
        } as unknown as RoomStorage;

        createTemperatureRoomRuntime({
            storage,
            clock: createMutableClock('2026-06-08T09:30:00Z'),
        });

        expect(calls.indexOf('retention')).toBeLessThan(calls.indexOf('identities'));
    });

    it('commits telemetry, identity, retention and checkpoint before publishing its effect', () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            storage: storage.port,
            generateNativeMessageId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        const batches: RoomPublicationBatch[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));
        runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            snapshots.length = 0;
            batches.length = 0;
            const telemetryCount = storage.telemetrySamples.length;
            const identityCount = storage.identities.length;
            const previousState = device(runtime, 'temp-desk')?.reportedState;
            let inspectedBeforeCommit = false;
            storage.setBeforeOutcome((operations) => {
                inspectedBeforeCommit = true;
                expect(operations).toEqual([
                    'appendTelemetrySample',
                    'upsertAcceptedInputIdentity',
                    'retireExpiredRecords',
                    'saveLatestRoomProjection',
                    'activateRuntimeSession',
                ]);
                expect(snapshots).toEqual([]);
                expect(device(runtime, 'temp-desk')?.reportedState).toEqual(previousState);
                expect(storage.telemetrySamples).toHaveLength(telemetryCount);
                expect(storage.identities).toHaveLength(identityCount);
            });

            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

            expect(inspectedBeforeCommit).toBe(true);
            expect(storage.telemetrySamples).toHaveLength(telemetryCount + 1);
            expect(storage.identities).toHaveLength(identityCount + 1);
            expect(snapshots).toHaveLength(1);
            expect(batches).toHaveLength(1);
            expect(batches[0]?.deltas.map((delta) => delta.messageType)).toEqual([
                'device.updated',
                'platform.updated',
            ]);
            expect(device(runtime, 'temp-desk')).toMatchObject({
                reportedState: { temperature: 22.2, temperatureUnit: 'celsius' },
                observationStatus: { temperature: { durability: 'durable' } },
            });
        } finally {
            runtime.stop();
        }
    });

    it('publishes one final degraded snapshot with the rolled-back telemetry as volatile', () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            storage: storage.port,
            generateNativeMessageId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        const batches: RoomPublicationBatch[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));
        runtime.subscribeRoomPublicationBatch((batch) => batches.push(batch));

        try {
            runtime.start();
            snapshots.length = 0;
            batches.length = 0;
            const telemetryCount = storage.telemetrySamples.length;
            const identityCount = storage.identities.length;
            const checkpoint = storage.latestCheckpoint;
            storage.failNext(
                'confirmed_rolled_back',
                new StorageAvailabilityError('database is busy', undefined),
            );

            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

            expect(snapshots).toHaveLength(1);
            expect(batches[0]?.deltas.map((delta) => delta.messageType)).toEqual([
                'platform.updated',
                'device.updated',
            ]);
            expect(snapshots[0]?.platform.storage.status).toBe('degraded');
            expect(
                snapshots[0]?.devices.find((candidate) => candidate.deviceId === 'temp-desk'),
            ).toMatchObject({
                reportedState: { temperature: 22.2, temperatureUnit: 'celsius' },
                observationStatus: { temperature: { durability: 'volatile' } },
            });
            expect(storage.telemetrySamples).toHaveLength(telemetryCount);
            expect(storage.identities).toHaveLength(identityCount);
            expect(storage.latestCheckpoint).toEqual(checkpoint);
        } finally {
            runtime.stop();
        }
    });

    it('publishes degraded before emitting a volatile LED outcome after terminal receipt rollback', async () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            storage: storage.port,
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            storage.failReceiptTransactionContaining(
                'updateSimulatorCommandReceipt',
                'confirmed_rolled_back',
                new StorageAvailabilityError('database is busy', undefined),
            );
            clock.advanceBy(1);

            runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();

            const degradedIndex = snapshots.findIndex(
                (snapshot) => snapshot.platform.storage.status === 'degraded',
            );
            const emittedIndex = snapshots.findIndex(
                (snapshot) =>
                    snapshot.devices.find((candidate) => candidate.deviceId === 'led-main')
                        ?.reportedState.power === 'on',
            );

            expect(degradedIndex).toBeGreaterThanOrEqual(0);
            expect(emittedIndex).toBeGreaterThan(degradedIndex);
        } finally {
            runtime.stop();
        }
    });

    it('publishes and dispatches nothing when command admission has an indeterminate commit', () => {
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-08-31T09:00:00Z'),
            timer: createManualTimer(),
            storage: storage.port,
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            const factCount = storage.significantFacts.length;
            storage.failNext('indeterminate', new Error('commit outcome unknown'));

            expect(() =>
                runtime.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            ).toThrow('storage_commit_outcome_unknown');

            expect(snapshots).toEqual([]);
            expect(storage.significantFacts).toHaveLength(factCount);
            expect(device(runtime, 'led-main')?.reportedState).toEqual({ power: 'off' });
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([]);
        } finally {
            runtime.stop();
        }
    });

    it('stores quarantined inputs without accepted history, identity or projection mutation', () => {
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-08-31T09:00:00Z'),
            timer: createManualTimer(),
            storage: storage.port,
            generateNativeMessageId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const factCount = storage.significantFacts.length;
            const telemetryCount = storage.telemetrySamples.length;
            const identityCount = storage.identities.length;
            const checkpoint = storage.latestCheckpoint;
            const snapshot = runtime.getRoomSnapshot();

            runtime.runDeviceScenario('temp-desk', 'emit_invalid_reading');
            runtime.runDeviceScenario('temp-desk', 'replay_last_reading');

            expect(storage.significantFacts).toHaveLength(factCount);
            expect(storage.telemetrySamples).toHaveLength(telemetryCount);
            expect(storage.identities).toHaveLength(identityCount);
            expect(storage.latestCheckpoint).toEqual(checkpoint);
            expect(runtime.getRoomSnapshot()).toEqual(snapshot);
            expect(storage.quarantineEntries.slice(-2)).toEqual([
                expect.objectContaining({ reason: 'invalid_payload' }),
                expect.objectContaining({ reason: 'duplicate_event' }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('atomically reconciles one checkpointed volatile guard on exact source redelivery', () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const sourceEvent = {
            eventId: 'simulator-adapter:temp-desk-native:source-reading-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-08-31T09:00:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22, unit: 'celsius' },
        } as const;
        const volatileRuntime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            generateNativeMessageId: nativeMessageIdsForRedelivery(),
        });
        volatileRuntime.start();
        const volatileSnapshot = volatileRuntime.getRoomSnapshot();
        volatileRuntime.stop();
        const volatileProjection = {
            updatedAt: volatileSnapshot.updatedAt,
            devices: volatileSnapshot.devices,
            activeCommands: volatileSnapshot.activeCommands,
            recentCommands: volatileSnapshot.recentCommands,
        };
        const storage = createScriptedStorage();
        storage.seedCheckpoint({
            updatedAt: volatileProjection.updatedAt,
            projection: volatileProjection,
            projectionEvidence: {
                availabilityDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
                healthDeviceIds: [],
            },
            volatileGuards: [
                {
                    eventId: sourceEvent.eventId,
                    fingerprint: inputFingerprint(sourceEvent),
                    durability: 'volatile',
                    acceptedAt: sourceEvent.occurredAt,
                },
            ],
            recentEvents: [],
        });
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            storage: storage.port,
            generateNativeMessageId: nativeMessageIdsForRedelivery(),
        });

        try {
            runtime.start();

            expect(
                storage.telemetrySamples.filter((sample) => sample.eventId === sourceEvent.eventId),
            ).toEqual([
                expect.objectContaining({
                    recordId: expect.stringMatching(/^rec:v1:sha256:/),
                    value: 22,
                    occurredAt: sourceEvent.occurredAt,
                }),
            ]);
            expect(storage.identities).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventId: sourceEvent.eventId,
                        fingerprint: inputFingerprint(sourceEvent),
                        durability: 'durable',
                    }),
                ]),
            );
            expect(storage.latestCheckpoint?.volatileGuards).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ eventId: sourceEvent.eventId })]),
            );
            expect(device(runtime, 'temp-desk')?.observationStatus.temperature).toMatchObject({
                lastObservedAt: sourceEvent.occurredAt,
                durability: 'durable',
            });
            expect(storage.quarantineEntries).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventId: sourceEvent.eventId,
                        reason: 'duplicate_event',
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('retains checkpointed volatile guards after degraded-startup recovery', () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const recoveredEventId = 'simulator-adapter:temp-desk-native:extra-7';
        const checkpointGuardEvent = {
            eventId: recoveredEventId,
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-08-31T09:00:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 21, unit: 'celsius' },
        } as const;
        const source = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
        });
        source.start();
        const sourceSnapshot = source.getRoomSnapshot();
        source.stop();

        const storage = createScriptedStorage();
        storage.seedCheckpoint({
            updatedAt: sourceSnapshot.updatedAt,
            projection: {
                updatedAt: sourceSnapshot.updatedAt,
                devices: sourceSnapshot.devices,
                activeCommands: sourceSnapshot.activeCommands,
                recentCommands: sourceSnapshot.recentCommands,
            },
            projectionEvidence: {
                availabilityDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
                healthDeviceIds: [],
            },
            volatileGuards: [
                {
                    eventId: recoveredEventId,
                    fingerprint: inputFingerprint(checkpointGuardEvent),
                    durability: 'volatile',
                    acceptedAt: checkpointGuardEvent.occurredAt,
                },
            ],
            recentEvents: [],
        });
        const recoveryTimer = createManualTimer();
        let factoryCalls = 0;
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            recoveryTimer,
            storageFactory() {
                factoryCalls += 1;

                if (factoryCalls === 1) {
                    throw new StorageAvailabilityError('startup unavailable', undefined);
                }

                return storage.port;
            },
            generateNativeMessageId: nativeMessageIdsForRedelivery(),
        });

        try {
            runtime.start();
            recoveryTimer.runLatest();

            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('available');
            expect(storage.latestCheckpoint?.volatileGuards).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventId: recoveredEventId,
                        fingerprint: inputFingerprint(checkpointGuardEvent),
                        durability: 'volatile',
                    }),
                ]),
            );

            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

            expect(runtime.getDiagnosticsSnapshot().ignoredEvents).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventId: recoveredEventId,
                        reason: 'event_identity_conflict',
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('bounds and expires merged volatile guards before saving a recovery checkpoint', () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const source = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
        });
        source.start();
        const sourceSnapshot = source.getRoomSnapshot();
        source.stop();
        const storage = createScriptedStorage();
        storage.seedCheckpoint({
            updatedAt: sourceSnapshot.updatedAt,
            projection: {
                updatedAt: sourceSnapshot.updatedAt,
                devices: sourceSnapshot.devices,
                activeCommands: sourceSnapshot.activeCommands,
                recentCommands: sourceSnapshot.recentCommands,
            },
            projectionEvidence: {
                availabilityDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
                healthDeviceIds: [],
            },
            volatileGuards: [
                {
                    eventId: 'expired-guard',
                    fingerprint: 'fp:v1:sha256:expired',
                    durability: 'volatile',
                    acceptedAt: '2026-08-31T08:58:00.000Z',
                },
                {
                    eventId: 'guard-a',
                    fingerprint: 'fp:v1:sha256:guard-a',
                    durability: 'volatile',
                    acceptedAt: '2026-08-31T09:00:00.000Z',
                },
                {
                    eventId: 'guard-b',
                    fingerprint: 'fp:v1:sha256:guard-b',
                    durability: 'volatile',
                    acceptedAt: '2026-08-31T09:00:00.000Z',
                },
            ],
            recentEvents: [],
        });
        const recoveryTimer = createManualTimer();
        let factoryCalls = 0;
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            recoveryTimer,
            deduplicationRetentionMs: 60_000,
            deduplicationEntryLimit: 2,
            storageFactory() {
                factoryCalls += 1;

                if (factoryCalls === 1) {
                    throw new StorageAvailabilityError('startup unavailable', undefined);
                }

                return storage.port;
            },
        });

        try {
            runtime.start();
            recoveryTimer.runLatest();

            expect(storage.latestCheckpoint?.volatileGuards).toHaveLength(2);
            expect(storage.latestCheckpoint?.volatileGuards).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ eventId: 'expired-guard' })]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('keeps a restored durable identity ahead of a colliding volatile recovery guard', () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const sourceEvent = {
            eventId: 'simulator-adapter:temp-desk-native:source-reading-1',
            eventType: 'telemetry.reading.recorded',
            occurredAt: '2026-08-31T09:00:00Z',
            source: 'simulator-adapter',
            deviceId: 'temp-desk',
            payload: { metric: 'temperature', value: 22, unit: 'celsius' },
        } as const;
        const storage = createScriptedStorage();
        const durableSource = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            storage: storage.port,
            generateNativeMessageId: nativeMessageIdsForRedelivery(),
        });
        durableSource.start();
        durableSource.stop();
        const checkpoint = storage.latestCheckpoint;

        if (!checkpoint) {
            throw new Error('Durable source did not write its checkpoint.');
        }

        storage.seedCheckpoint({
            ...checkpoint,
            volatileGuards: [
                {
                    eventId: sourceEvent.eventId,
                    fingerprint: inputFingerprint(sourceEvent),
                    durability: 'volatile',
                    acceptedAt: sourceEvent.occurredAt,
                },
            ],
        });
        const recoveryTimer = createManualTimer();
        let factoryCalls = 0;
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            recoveryTimer,
            storageFactory() {
                factoryCalls += 1;

                if (factoryCalls === 1) {
                    throw new StorageAvailabilityError('startup unavailable', undefined);
                }

                return storage.port;
            },
            generateNativeMessageId: (() => {
                const messageIds = ['volatile-start-1', 'volatile-start-2', 'volatile-start-3'];
                let index = 0;

                return () => messageIds[index++] ?? 'source-reading-1';
            })(),
        });

        try {
            runtime.start();
            recoveryTimer.runLatest();

            expect(storage.latestCheckpoint?.volatileGuards).not.toEqual(
                expect.arrayContaining([expect.objectContaining({ eventId: sourceEvent.eventId })]),
            );

            const storedSamplesBeforeReplay = storage.telemetrySamples.length;
            runtime.runDeviceScenario('temp-desk', 'replay_last_reading');

            expect(storage.telemetrySamples).toHaveLength(storedSamplesBeforeReplay);
            expect(runtime.getDiagnosticsSnapshot().ignoredEvents).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventId: sourceEvent.eventId,
                        reason: 'duplicate_event',
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('persists a restored command timeout before exposing the first recovered snapshot', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-'));
        const databasePath = join(directory, 'room.sqlite');
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const initialStorage = createSqliteRoomStorage({ databasePath });
        const initialRuntime = createTemperatureRoomRuntime({
            clock,
            storage: initialStorage,
            ledScenario: 'omit_confirmation',
            commandTimer: createCommandTimer(),
        });
        let recoveredStorage: ReturnType<typeof createSqliteRoomStorage> | undefined;
        let recoveredRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            initialRuntime.start();
            const command = initialRuntime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            const outboxBeforeRestart = initialStorage.listCommandDispatchOutboxIntents();
            initialRuntime.stop();
            initialStorage.close();
            clock.advanceBy(5_000);

            recoveredStorage = createSqliteRoomStorage({ databasePath });
            const commandDispatchedFactsBeforeStartup = recoveredStorage
                .listSignificantFacts()
                .filter((fact) => fact.eventType === 'command.dispatched');
            const recoveredCommandTimer = createCommandTimer();
            recoveredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: recoveredStorage,
                ledScenario: 'omit_confirmation',
                commandTimer: recoveredCommandTimer,
            });
            recoveredRuntime.start();

            expect(recoveredRuntime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(recoveredRuntime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: command.commandId, status: 'timed_out' }),
            ]);
            expect(recoveredStorage.listSignificantFacts()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventType: 'command.timed_out',
                        commandId: command.commandId,
                    }),
                ]),
            );
            expect(recoveredCommandTimer.size()).toBe(0);
            expect(recoveredStorage.listCommandDispatchOutboxIntents()).toEqual([
                expect.objectContaining({
                    ...outboxBeforeRestart[0],
                    state: 'closed',
                    closedAt: '2026-08-05T10:00:05.000Z',
                }),
            ]);
            expect(
                recoveredStorage
                    .listSignificantFacts()
                    .filter((fact) => fact.eventType === 'command.dispatched'),
            ).toEqual(commandDispatchedFactsBeforeStartup);
        } finally {
            initialRuntime.stop();
            initialStorage.close();
            recoveredRuntime?.stop();
            recoveredStorage?.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('restores a durable command timeout for its remaining time without another handoff', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-'));
        const databasePath = join(directory, 'room.sqlite');
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const initialStorage = createSqliteRoomStorage({ databasePath });
        const initialRuntime = createTemperatureRoomRuntime({
            clock,
            storage: initialStorage,
            ledScenario: 'omit_confirmation',
            commandTimer: createCommandTimer(),
        });
        let recoveredStorage: ReturnType<typeof createSqliteRoomStorage> | undefined;
        let recoveredRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            initialRuntime.start();
            const command = initialRuntime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            const outboxBeforeRestart = initialStorage.listCommandDispatchOutboxIntents();
            initialRuntime.stop();
            initialStorage.close();
            clock.advanceBy(2_000);

            recoveredStorage = createSqliteRoomStorage({ databasePath });
            const commandDispatchedFactsBeforeStartup = recoveredStorage
                .listSignificantFacts()
                .filter((fact) => fact.eventType === 'command.dispatched');
            const recoveredCommandTimer = createCommandTimer();
            recoveredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: recoveredStorage,
                ledScenario: 'omit_confirmation',
                commandTimer: recoveredCommandTimer,
            });
            recoveredRuntime.start();

            expect(recoveredRuntime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({ commandId: command.commandId, status: 'pending' }),
            ]);
            expect(recoveredCommandTimer.delays).toEqual([3_000]);
            expect(recoveredStorage.listCommandDispatchOutboxIntents()).toEqual(outboxBeforeRestart);
            expect(
                recoveredStorage
                    .listSignificantFacts()
                    .filter((fact) => fact.eventType === 'command.dispatched'),
            ).toEqual(commandDispatchedFactsBeforeStartup);

            clock.advanceBy(3_000);
            recoveredCommandTimer.runAll();

            expect(recoveredRuntime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(recoveredRuntime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: command.commandId, status: 'timed_out' }),
            ]);
            expect(recoveredStorage.listSignificantFacts()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventType: 'command.timed_out',
                        commandId: command.commandId,
                    }),
                ]),
            );
        } finally {
            initialRuntime.stop();
            initialStorage.close();
            recoveredRuntime?.stop();
            recoveredStorage?.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('restores a mixed checkpoint and bounded caches without promoting volatile feed entries', () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-restart-'));
        const databasePath = join(directory, 'room.sqlite');
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const checkpoint = createMixedRestartCheckpoint(clock);
        const initialStorage = createSqliteRoomStorage({ databasePath });
        let restoredStorage: ReturnType<typeof createSqliteRoomStorage> | undefined;
        let restoredRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            const saved = initialStorage.transact((transaction) => {
                transaction.saveLatestRoomProjection(checkpoint);
            });

            expect(saved.status).toBe('committed');
            const historyBeforeRestart = initialStorage.listSignificantFacts();
            initialStorage.close();

            restoredStorage = createSqliteRoomStorage({ databasePath });
            restoredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: restoredStorage,
                timer: createManualTimer(),
                commandTimer: createCommandTimer(),
            });

            const snapshot = restoredRuntime.getRoomSnapshot();

            expect(snapshot.updatedAt).toBe(checkpoint.projection.updatedAt);
            expect(snapshot.devices).toEqual(checkpoint.projection.devices);
            expect(snapshot.activeCommands).toEqual(checkpoint.projection.activeCommands);
            expect(snapshot.recentCommands).toEqual(checkpoint.projection.recentCommands);
            expect(snapshot.recentCommands).toHaveLength(20);
            expect(snapshot.recentEvents).toEqual(checkpoint.recentEvents);
            expect(snapshot.recentEvents).toHaveLength(2);
            expect(snapshot.recentEvents[0]).toMatchObject({
                recordId: 'checkpoint-volatile-feed',
                durability: 'volatile',
            });
            expect(snapshot.recentEvents[0]).not.toHaveProperty('storageSequence');
            expect(restoredStorage.listSignificantFacts()).toEqual(historyBeforeRestart);
        } finally {
            initialStorage.close();
            restoredRuntime?.stop();
            restoredStorage?.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('re-evaluates restored freshness before the first snapshot without historical side effects', () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-freshness-restart-'));
        const databasePath = join(directory, 'room.sqlite');
        const clock = createMutableClock('2026-08-05T10:00:00.000Z');
        const checkpoint = createMixedRestartCheckpoint(clock);
        const expectedProjection = structuredClone(checkpoint.projection);
        const restoredTemperature = expectedProjection.devices.find(
            (candidate) => candidate.deviceId === 'temp-desk',
        );

        if (!restoredTemperature?.observationStatus.temperature) {
            throw new Error(
                'Expected the checkpoint fixture to include a temperature observation.',
            );
        }

        restoredTemperature.observationStatus.temperature = {
            ...restoredTemperature.observationStatus.temperature,
            freshness: 'stale',
        };

        const initialStorage = createSqliteRoomStorage({ databasePath });
        let recoveredStorage: ReturnType<typeof createSqliteRoomStorage> | undefined;
        let recoveredRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            const persisted = initialStorage.transact((transaction) => {
                transaction.appendSignificantFact({
                    recordId: 'freshness-recovery-significant-fact',
                    eventId: 'evt-freshness-recovery-significant-fact',
                    eventType: 'device.availability.changed',
                    deviceId: 'temp-desk',
                    source: 'simulator-adapter',
                    occurredAt: clock.now(),
                    payload: { availability: 'online' },
                });
                transaction.appendTelemetrySample({
                    recordId: 'freshness-recovery-telemetry',
                    eventId: 'evt-freshness-recovery-telemetry',
                    deviceId: 'temp-desk',
                    metric: 'temperature',
                    value: 22.4,
                    unit: 'celsius',
                    occurredAt: clock.now(),
                    payload: { temperature: 22.4, temperatureUnit: 'celsius' },
                });
                transaction.upsertAcceptedInputIdentity({
                    eventId: 'evt-freshness-recovery-significant-fact',
                    fingerprint: `fp:v1:sha256:${'0'.repeat(64)}`,
                    durability: 'durable',
                    acceptedAt: clock.now(),
                });
                transaction.upsertAcceptedInputIdentity({
                    eventId: 'evt-freshness-recovery-telemetry',
                    fingerprint: `fp:v1:sha256:${'1'.repeat(64)}`,
                    durability: 'durable',
                    acceptedAt: clock.now(),
                });
                transaction.saveLatestRoomProjection(checkpoint);
            });

            expect(persisted.status).toBe('committed');
            const historyBeforeRestart = initialStorage.listSignificantFacts();
            const telemetryBeforeRestart = initialStorage.listTelemetrySamples({
                deviceId: 'temp-desk',
                metric: 'temperature',
            });
            const identitiesBeforeRestart = initialStorage.listAcceptedInputIdentities();
            const metadataBeforeRestart = initialStorage.getMetadata();
            initialStorage.close();
            clock.advanceBy(2_501);

            recoveredStorage = createSqliteRoomStorage({ databasePath });
            recoveredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: recoveredStorage,
                timer: createManualTimer(),
                commandTimer: createCommandTimer(),
            });

            const restoredCheckpoint = recoveredStorage.getLatestRoomProjection();
            const snapshot = recoveredRuntime.getRoomSnapshot();

            expect(restoredCheckpoint).toMatchObject({
                projection: expectedProjection,
                projectionEvidence: checkpoint.projectionEvidence,
                volatileGuards: checkpoint.volatileGuards,
                recentEvents: checkpoint.recentEvents,
            });
            expect(snapshot.devices).toEqual(expectedProjection.devices);
            expect(snapshot.activeCommands).toEqual(expectedProjection.activeCommands);
            expect(snapshot.recentCommands).toEqual(expectedProjection.recentCommands);
            expect(
                snapshot.devices.find((candidate) => candidate.deviceId === 'temp-desk')
                    ?.observationStatus.temperature,
            ).toEqual(restoredTemperature.observationStatus.temperature);
            expect(recoveredStorage.listSignificantFacts()).toEqual(historyBeforeRestart);
            expect(
                recoveredStorage.listTelemetrySamples({
                    deviceId: 'temp-desk',
                    metric: 'temperature',
                }),
            ).toEqual(telemetryBeforeRestart);
            expect(recoveredStorage.listAcceptedInputIdentities()).toEqual(identitiesBeforeRestart);
            expect(recoveredStorage.getMetadata()).toEqual(metadataBeforeRestart);
        } finally {
            initialStorage.close();
            recoveredRuntime?.stop();
            recoveredStorage?.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('does not rewrite a restored checkpoint when startup freshness is unchanged', () => {
        const clock = createMutableClock('2026-08-05T10:00:00.000Z');
        const storage = createScriptedStorage();
        const checkpoint = createMixedRestartCheckpoint(clock);
        storage.seedCheckpoint(checkpoint);

        const runtime = createTemperatureRoomRuntime({
            clock,
            storage: storage.port,
            timer: createManualTimer(),
            commandTimer: createCommandTimer(),
        });

        try {
            expect(storage.transactionOperations).toEqual([['retireExpiredRecords']]);
            expect(runtime.getRoomSnapshot().devices).toEqual(checkpoint.projection.devices);
        } finally {
            runtime.stop();
        }
    });

    it('starts from a migrated legacy checkpoint without retaining a terminal command as active', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-'));
        const databasePath = join(directory, 'room.sqlite');
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const initialStorage = createSqliteRoomStorage({ databasePath });
        const initialRuntime = createTemperatureRoomRuntime({
            clock,
            storage: initialStorage,
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
        });
        let recoveredStorage: ReturnType<typeof createSqliteRoomStorage> | undefined;
        let recoveredRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            initialRuntime.start();
            initialRuntime.stop();
            initialStorage.close();

            const commandId = writeLegacyCommandCheckpoint(databasePath);

            recoveredStorage = createSqliteRoomStorage({ databasePath });
            recoveredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: recoveredStorage,
                commandTimer: createCommandTimer(),
            });
            recoveredRuntime.start();

            expect(recoveredRuntime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(device(recoveredRuntime, 'led-main')).not.toHaveProperty('activeCommandId');
            expect(recoveredRuntime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId, status: 'confirmed' }),
            ]);
        } finally {
            initialRuntime.stop();
            initialStorage.close();
            recoveredRuntime?.stop();
            recoveredStorage?.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('commits durable admission and its ready outbox intent before the scheduled handoff', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-'));
        const storage = createSqliteRoomStorage({ databasePath: join(directory, 'room.sqlite') });
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-08-05T10:00:00Z'),
            storage,
            ledScenario: 'omit_confirmation',
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const response = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });

            expect(response).toMatchObject({
                status: 'accepted',
                durability: 'durable',
                lifecycleDurability: 'durable',
            });
            expect(storage.listCommandDispatchOutboxIntents()).toEqual([
                expect.objectContaining({ commandId: response.commandId, state: 'ready' }),
            ]);
            expect(storage.listSignificantFacts()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventType: 'command.requested',
                        commandId: response.commandId,
                    }),
                ]),
            );

            await flushCommandDispatch();

            expect(storage.listCommandDispatchOutboxIntents()).toEqual([
                expect.objectContaining({
                    commandId: response.commandId,
                    state: 'delivered',
                    handedOffAt: expect.any(String),
                    deadlineAt: expect.any(String),
                }),
            ]);
        } finally {
            runtime.stop();
            storage.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('confirms an overdue durable LED receipt after a backend and simulator restart', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-receipt-restart-'));
        const databasePath = join(directory, 'room.sqlite');
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const firstStorage = createSqliteRoomStorage({ databasePath });
        const firstRuntime = createTemperatureRoomRuntime({
            clock,
            storage: firstStorage,
            ledScenario: 'confirm_delayed',
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
        });
        let restoredStorage: ReturnType<typeof createSqliteRoomStorage> | undefined;
        let restoredRuntime: ReturnType<typeof createTemperatureRoomRuntime> | undefined;

        try {
            firstRuntime.start();
            const response = firstRuntime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            firstRuntime.stop();
            firstStorage.close();

            clock.advanceBy(3_000);
            restoredStorage = createSqliteRoomStorage({ databasePath });
            restoredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: restoredStorage,
                ledScenario: 'confirm_immediately',
                commandTimer: createCommandTimer(),
            });
            expect(restoredRuntime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({ commandId: response.commandId, status: 'pending' }),
            ]);
            restoredRuntime.start();
            await flushCommandDispatch();
            await flushCommandDispatch();

            expect(restoredRuntime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: response.commandId, status: 'confirmed' }),
            ]);
            expect(device(restoredRuntime, 'led-main')?.reportedState).toEqual({ power: 'on' });
        } finally {
            firstRuntime.stop();
            firstStorage.close();
            restoredRuntime?.stop();
            restoredStorage?.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('falls back once to a volatile admission with the same command id after durable admission rollback', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            storage: storage.port,
            generateEventId: createEventIdGenerator(),
            generateCommandId: () => 'cmd-rollback-1',
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            storage.failNext(
                'confirmed_rolled_back',
                new StorageAvailabilityError('database is busy', undefined),
            );

            const response = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({
                    commandId: 'cmd-rollback-1',
                    durability: 'volatile',
                    lifecycleDurability: 'volatile',
                }),
            ]);
            await flushCommandDispatch();

            expect(response).toEqual({
                commandId: 'cmd-rollback-1',
                status: 'accepted',
                durability: 'volatile',
                lifecycleDurability: 'volatile',
            });
            expect(snapshots[0]?.platform.storage.status).toBe('degraded');
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({
                    commandId: 'cmd-rollback-1',
                    status: 'pending',
                    durability: 'volatile',
                    lifecycleDurability: 'volatile',
                }),
            ]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([]);
            expect(
                storage.significantFacts.filter((fact) => fact.commandId === 'cmd-rollback-1'),
            ).toEqual([]);
        } finally {
            runtime.stop();
        }
    });

    it('does not publish or dispatch a command after a fatal durable-admission rollback', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            storage: storage.port,
            generateEventId: createEventIdGenerator(),
            generateCommandId: () => 'cmd-fatal-admission-1',
        });

        try {
            runtime.start();
            storage.failNext(
                'confirmed_rolled_back',
                new StorageInvariantError('broken storage invariant', undefined),
            );

            expect(() =>
                runtime.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            ).toThrow('storage_fatal_error');
            await flushCommandDispatch();

            expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(
                storage.significantFacts.filter(
                    (fact) => fact.commandId === 'cmd-fatal-admission-1',
                ),
            ).toEqual([]);
        } finally {
            runtime.stop();
        }
    });

    it('keeps a volatile pending handoff with its original deadline after durable dispatch persistence rolls back', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            storage: storage.port,
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
            generateCommandId: () => 'cmd-dispatch-rollback-1',
            ledScenario: 'omit_confirmation',
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            const command = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            storage.failNext(
                'confirmed_rolled_back',
                new StorageAvailabilityError('database is busy', undefined),
            );
            await flushCommandDispatch();

            expect(runtime.getRoomSnapshot().platform.storage.status).toBe('degraded');
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({
                    commandId: command.commandId,
                    status: 'pending',
                    durability: 'durable',
                    lifecycleDurability: 'volatile',
                    delivery: {
                        status: 'handed_off',
                        dispatchedAt: '2026-08-05T10:00:00.001Z',
                        deadlineAt: '2026-08-05T10:00:05.001Z',
                    },
                }),
            ]);
            expect(
                storage.significantFacts.filter(
                    (fact) =>
                        fact.commandId === command.commandId &&
                        fact.eventType === 'command.dispatched',
                ),
            ).toEqual([]);
        } finally {
            runtime.stop();
        }
    });

    it('admits the first replay after its durable retention horizon expires', () => {
        const directory = mkdtempSync(join(tmpdir(), 'smart-room-runtime-'));
        const databasePath = join(directory, 'room.sqlite');
        const storage = createSqliteRoomStorage({ databasePath });
        const clock = createMutableClock('2026-08-01T10:00:00Z');
        const timer = createManualTimer();
        let nativeMessageIndex = 0;
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer,
            storage,
            generateNativeMessageId() {
                nativeMessageIndex += 1;

                return nativeMessageIndex === 1 || nativeMessageIndex === 7
                    ? 'expired-availability'
                    : `native-${nativeMessageIndex}`;
            },
        });

        try {
            runtime.start();
            clock.advanceBy(31 * 24 * 60 * 60 * 1_000);
            runtime.runDeviceScenario('led-main', 'disconnect_device');

            expect(device(runtime, 'led-main')).toMatchObject({ availability: 'offline' });
            expect(storage.listQuarantineEntries()).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventId: 'simulator-adapter:led-main-native:expired-availability',
                        reason: 'event_identity_conflict',
                    }),
                ]),
            );
            expect(storage.listSignificantFacts()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventId: 'simulator-adapter:led-main-native:expired-availability',
                        payload: expect.objectContaining({ availability: 'offline' }),
                    }),
                ]),
            );
        } finally {
            runtime.stop();
            storage.close();
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('starts with two independently configured temperature projections', () => {
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-06-08T09:30:00Z'),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();

            expect(runtime.getRoomSnapshot().devices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        deviceId: 'temp-desk',
                        reportedState: { temperature: 22, temperatureUnit: 'celsius' },
                    }),
                    expect.objectContaining({
                        deviceId: 'temp-window',
                        reportedState: { temperature: 20, temperatureUnit: 'celsius' },
                    }),
                    expect.objectContaining({
                        deviceId: 'led-main',
                        reportedState: { power: 'off' },
                    }),
                ]),
            );
            expect(runtime.getDeviceScenarios('temp-desk')?.deviceId).toBe('temp-desk');
            expect(runtime.getDeviceScenarios('temp-window')?.deviceId).toBe('temp-window');
        } finally {
            runtime.stop();
        }
    });

    it('accepts an injected native-message ID generator for deterministic runtime sources', () => {
        const nativeMessageIds = ['native-1', 'native-2', 'native-3', 'native-4', 'native-5'];
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-06-08T09:30:00Z'),
            generateEventId: createEventIdGenerator(),
            generateNativeMessageId: () => nativeMessageIds.shift() ?? 'native-overflow',
        });

        try {
            runtime.start();
            runtime.runDeviceScenario('temp-desk', 'replay_last_reading');

            expect(runtime.getDiagnosticsSnapshot().ignoredEvents).toEqual([
                expect.objectContaining({
                    eventId: 'simulator-adapter:temp-desk-native:native-4',
                    reason: 'duplicate_event',
                }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('uses separate cadence timers and updates only the sensor whose timer runs', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const initialWindow = device(runtime, 'temp-window')?.reportedState;

            clock.advanceBy(1000);
            timer.run(2);

            expect(timer.intervals).toEqual([1000, 1000, 2000]);
            expect(device(runtime, 'temp-desk')?.reportedState).toEqual({
                temperature: 22.2,
                temperatureUnit: 'celsius',
            });
            expect(device(runtime, 'temp-window')?.reportedState).toEqual(initialWindow);
        } finally {
            runtime.stop();
        }
    });

    it('scopes pause and resume scenarios to their selected device', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            runtime.runDeviceScenario('temp-window', 'pause_telemetry');
            clock.advanceBy(1000);
            timer.run(2);
            timer.run(1);

            expect(device(runtime, 'temp-desk')?.reportedState).toEqual({
                temperature: 22.2,
                temperatureUnit: 'celsius',
            });
            expect(device(runtime, 'temp-window')?.reportedState).toEqual({
                temperature: 20,
                temperatureUnit: 'celsius',
            });

            runtime.runDeviceScenario('temp-window', 'resume_telemetry');
            timer.runLatest();

            expect(device(runtime, 'temp-window')?.reportedState).toEqual({
                temperature: 20.2,
                temperatureUnit: 'celsius',
            });
        } finally {
            runtime.stop();
        }
    });

    it('publishes freshness changes for the affected device without changing availability', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            snapshotBroadcastIntervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            runtime.runDeviceScenario('temp-window', 'pause_telemetry');
            clock.advanceBy(1000);
            timer.run(2);
            clock.advanceBy(1501);
            timer.run(1);

            expect(snapshots.at(-1)?.devices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        deviceId: 'temp-desk',
                        availability: 'online',
                        observationStatus: expect.objectContaining({
                            temperature: expect.objectContaining({ freshness: 'fresh' }),
                        }),
                    }),
                    expect.objectContaining({
                        deviceId: 'temp-window',
                        availability: 'online',
                        observationStatus: expect.objectContaining({
                            temperature: expect.objectContaining({ freshness: 'stale' }),
                        }),
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('does not publish unchanged freshness and publishes one snapshot for a freshness transition', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            snapshotBroadcastIntervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;

            timer.run(1);
            expect(snapshots).toHaveLength(0);

            clock.advanceBy(2_501);
            timer.run(1);
            expect(snapshots).toHaveLength(1);
        } finally {
            runtime.stop();
        }
    });

    it('persists prepared freshness before publication without history, identity or watermark', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            snapshotBroadcastIntervalMs: 1000,
            clock,
            timer,
            storage: storage.port,
            generateEventId: createEventIdGenerator(),
            generateNativeMessageId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            const factCount = storage.significantFacts.length;
            const telemetryCount = storage.telemetrySamples.length;
            const identityCount = storage.identities.length;
            const storedThroughSequence = storage.port.getMetadata().lastStorageSequence;
            const checkpoint = storage.latestCheckpoint;
            let inspectedBeforeCommit = false;
            storage.setBeforeOutcome((operations) => {
                inspectedBeforeCommit = true;
                expect(operations).toEqual([
                    'retireExpiredRecords',
                    'saveLatestRoomProjection',
                    'activateRuntimeSession',
                ]);
                expect(snapshots).toEqual([]);
                expect(storage.latestCheckpoint).toEqual(checkpoint);
                expect(storage.port.getMetadata().lastStorageSequence).toBe(storedThroughSequence);
            });

            clock.advanceBy(2_501);
            timer.run(1);

            expect(inspectedBeforeCommit).toBe(true);
            expect(snapshots).toHaveLength(1);
            expect(storage.significantFacts).toHaveLength(factCount);
            expect(storage.telemetrySamples).toHaveLength(telemetryCount);
            expect(storage.identities).toHaveLength(identityCount);
            expect(storage.port.getMetadata().lastStorageSequence).toBe(storedThroughSequence);
            expect(snapshots[0]?.platform.storage.storedThroughSequence).toBe(
                storedThroughSequence,
            );
            expect(device(runtime, 'temp-desk')?.observationStatus.temperature).toMatchObject({
                freshness: 'stale',
                durability: 'durable',
            });
            expect(storage.latestCheckpoint).not.toEqual(checkpoint);
        } finally {
            runtime.stop();
        }
    });

    it('publishes one batch with degraded status before rolled-back freshness', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer,
            storage: storage.port,
            generateNativeMessageId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            const checkpoint = storage.latestCheckpoint;
            storage.failNext(
                'confirmed_rolled_back',
                new StorageAvailabilityError('database is busy', undefined),
            );

            clock.advanceBy(2_501);
            timer.run(1);

            expect(snapshots).toHaveLength(1);
            expect(snapshots[0]?.platform.storage.status).toBe('degraded');
            expect(
                snapshots[0]?.devices.find((candidate) => candidate.deviceId === 'temp-desk')
                    ?.observationStatus.temperature,
            ).toMatchObject({ freshness: 'stale', durability: 'durable' });
            expect(storage.latestCheckpoint).toEqual(checkpoint);
        } finally {
            runtime.stop();
        }
    });

    it('keeps a paused sensor online while freshness becomes stale and then recovers', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            snapshotBroadcastIntervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            runtime.runDeviceScenario('temp-window', 'pause_telemetry');
            clock.advanceBy(10_001);
            timer.run(1);

            expect(device(runtime, 'temp-window')?.availability).toBe('online');
            expect(device(runtime, 'temp-window')?.observationStatus.temperature?.freshness).toBe(
                'stale',
            );

            runtime.runDeviceScenario('temp-window', 'resume_telemetry');
            clock.advanceBy(1);
            timer.runLatest();

            expect(device(runtime, 'temp-window')).toEqual(
                expect.objectContaining({
                    availability: 'online',
                    observationStatus: expect.objectContaining({
                        temperature: expect.objectContaining({ freshness: 'fresh' }),
                    }),
                    reportedState: { temperature: 20.2, temperatureUnit: 'celsius' },
                }),
            );
        } finally {
            runtime.stop();
        }
    });

    it('stops periodic telemetry while a sensor is offline and resumes its schedule on reconnect', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const timer = createManualTimer();
        const runtime = createTemperatureRoomRuntime({
            intervalMs: 1000,
            clock,
            timer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const reportedStateBeforeDisconnect = device(runtime, 'temp-window')?.reportedState;

            clock.advanceBy(1);
            runtime.runDeviceScenario('temp-window', 'disconnect_device');
            clock.advanceBy(1_000);
            timer.run(3);

            expect(device(runtime, 'temp-window')).toMatchObject({
                availability: 'offline',
                reportedState: reportedStateBeforeDisconnect,
            });

            for (const action of [
                'pause_telemetry',
                'resume_telemetry',
                'emit_next_reading',
                'replay_last_reading',
                'emit_invalid_reading',
                'emit_future_dated_reading',
                'reset',
            ] as const) {
                expect(() => runtime.runDeviceScenario('temp-window', action)).toThrow(
                    expect.objectContaining({ code: 'device_offline' }),
                );
            }

            clock.advanceBy(1);
            runtime.runDeviceScenario('temp-window', 'reconnect_device');

            expect(device(runtime, 'temp-window')).toMatchObject({
                availability: 'online',
                reportedState: reportedStateBeforeDisconnect,
            });

            clock.advanceBy(1_000);
            timer.runLatest();

            expect(device(runtime, 'temp-window')?.reportedState).toEqual({
                temperature: 20.2,
                temperatureUnit: 'celsius',
            });
        } finally {
            runtime.stop();
        }
    });

    it('changes temperature health independently of availability and freshness', () => {
        const clock = createMutableClock('2026-06-08T09:30:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const before = device(runtime, 'temp-window');
            runtime.runDeviceScenario('temp-window', 'degrade_device');

            expect(device(runtime, 'temp-window')).toMatchObject({
                availability: 'online',
                health: 'degraded',
                healthReason: 'partial_data',
                reportedState: before?.reportedState,
                observationStatus: before?.observationStatus,
            });

            clock.advanceBy(1);
            runtime.runDeviceScenario('temp-window', 'recover_device');
            expect(device(runtime, 'temp-window')).toMatchObject({
                availability: 'online',
                health: 'healthy',
            });
            expect(device(runtime, 'temp-window')?.healthReason).toBeUndefined();
        } finally {
            runtime.stop();
        }
    });

    it('records invalid and duplicate scenarios without changing the other sensor projection', () => {
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-06-08T09:30:00Z'),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            const deskBefore = device(runtime, 'temp-desk')?.reportedState;
            runtime.runDeviceScenario('temp-window', 'emit_invalid_reading');
            runtime.runDeviceScenario('temp-window', 'replay_last_reading');
            runtime.runDeviceScenario('temp-window', 'emit_future_dated_reading');

            expect(device(runtime, 'temp-desk')?.reportedState).toEqual(deskBefore);
            expect(
                runtime.getDiagnosticsSnapshot().ignoredEvents.map((event) => event.reason),
            ).toEqual(['future_dated_report', 'duplicate_event', 'invalid_payload']);
        } finally {
            runtime.stop();
        }
    });

    it('dispatches an LED command through the composed runtime and publishes its reported state', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            clock.advanceBy(1);

            runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();

            expect(device(runtime, 'led-main')).toEqual(
                expect.objectContaining({
                    reportedState: { power: 'on' },
                    commandAvailability: { policy: 'allow' },
                }),
            );
            expect(snapshots.at(-1)?.devices).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        deviceId: 'led-main',
                        reportedState: { power: 'on' },
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('configures the next LED command scenario without changing reported LED state', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            commandTimer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            expect(runtime.getDeviceScenarios('led-main')?.scenarios).toEqual(
                expect.arrayContaining([{ action: 'omit_confirmation' }]),
            );
            runtime.runDeviceScenario('led-main', 'omit_confirmation');
            expect(device(runtime, 'led-main')?.reportedState).toEqual({ power: 'off' });

            runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            clock.advanceBy(5_000);
            commandTimer.runAll();

            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ status: 'timed_out' }),
            ]);

            runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            expect(runtime.getRoomSnapshot().recentCommands).toEqual(
                expect.arrayContaining([expect.objectContaining({ status: 'confirmed' })]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('records dispatch before a synchronous LED confirmation and clears its timeout', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            commandTimer,
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            clock.advanceBy(1);

            const result = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();

            expect(result).toEqual(expect.objectContaining({ status: 'accepted' }));
            expect(device(runtime, 'led-main')).toEqual(
                expect.objectContaining({ reportedState: { power: 'on' } }),
            );
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: result.commandId, status: 'confirmed' }),
            ]);
            expect(commandTimer.size()).toBe(0);
            expect(runtime.getDiagnosticsSnapshot().ignoredEvents).toEqual([]);
        } finally {
            runtime.stop();
        }
    });

    it('retains a synchronous report ingress captured before lifecycle persistence crosses deadline', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            storage: storage.port,
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            clock.advanceBy(4_999);
            const command = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            storage.setBeforeOutcome((operations) => {
                if (!operations.includes('appendSignificantFact')) {
                    return false;
                }

                clock.advanceBy(5_000);

                return true;
            });
            await flushCommandDispatch();

            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: command.commandId, status: 'confirmed' }),
            ]);
            expect(device(runtime, 'led-main')?.reportedState).toEqual({ power: 'on' });
        } finally {
            runtime.stop();
        }
    });

    it('atomically prepares both the observed report and derived confirmation record', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const storage = createCapturingStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            storage: storage.port,
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            const result = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            const confirmation = storage.significantFacts.find(
                (fact) =>
                    fact.eventType === 'command.confirmed' && fact.commandId === result.commandId,
            );

            expect(confirmation).toEqual(
                expect.objectContaining({
                    payload: expect.objectContaining({ sourceEventId: expect.any(String) }),
                }),
            );
            expect(
                storage.significantFacts.some(
                    (fact) =>
                        fact.eventType === 'device.state.reported' &&
                        fact.eventId ===
                            (confirmation?.payload as { sourceEventId?: string } | undefined)
                                ?.sourceEventId,
                ),
            ).toBe(true);
        } finally {
            runtime.stop();
        }
    });

    it('cancels the timeout when a delayed matching report confirms the command', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const ledScheduler = createLedScheduler();
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
            ledScenario: 'confirm_delayed',
            ledScenarioScheduler: ledScheduler,
            commandTimer,
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            expect(runtime.getRoomSnapshot().activeCommands).toHaveLength(1);

            clock.advanceBy(2_000);
            ledScheduler.runAll();

            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ status: 'confirmed' }),
            ]);
            expect(commandTimer.size()).toBe(0);
        } finally {
            runtime.stop();
        }
    });

    it('uses captured report ingress time for the strict confirmation deadline', async () => {
        const cases = [
            [4_999, 'confirmed'],
            [5_000, 'timed_out'],
            [5_001, 'timed_out'],
        ] as const;

        for (const [advanceByMs, expectedStatus] of cases) {
            const clock = createMutableClock('2026-08-05T10:00:00Z');
            const ledScheduler = createLedScheduler();
            const runtime = createTemperatureRoomRuntime({
                clock,
                commandTimer: createCommandTimer(),
                generateEventId: createEventIdGenerator(),
                ledScenario: 'confirm_delayed',
                ledScenarioScheduler: ledScheduler,
            });

            try {
                runtime.start();
                clock.advanceBy(1);
                const command = runtime.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                });
                await flushCommandDispatch();

                clock.advanceBy(advanceByMs);
                ledScheduler.runAll();

                expect(device(runtime, 'led-main')?.reportedState).toEqual({ power: 'on' });
                expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                    expect.objectContaining({
                        commandId: command.commandId,
                        status: expectedStatus,
                    }),
                ]);
            } finally {
                runtime.stop();
            }
        }
    });

    it('keeps a pending LED command active when the device becomes offline', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
            ledScenario: 'omit_confirmation',
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            runtime.runDeviceScenario('led-main', 'disconnect_device');

            expect(device(runtime, 'led-main')).toMatchObject({ availability: 'offline' });
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({ status: 'pending' }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('records a terminal failure when a second command conflicts with an active command', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const runtime = createTemperatureRoomRuntime({
            clock,
            commandTimer: createCommandTimer(),
            generateEventId: createEventIdGenerator(),
            ledScenario: 'omit_confirmation',
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            const first = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            const second = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'off' },
            });

            expect(first).toEqual(expect.objectContaining({ status: 'accepted' }));
            expect(second).toEqual(
                expect.objectContaining({ status: 'rejected', reason: 'command_already_active' }),
            );
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([
                expect.objectContaining({ commandId: first.commandId, status: 'pending' }),
            ]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: second.commandId, status: 'failed' }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('projects simulator rejection, timeout and late report as distinct terminal outcomes', async () => {
        const scenarios = [
            ['reject_command', 'failed'],
            ['omit_confirmation', 'timed_out'],
            ['report_after_timeout', 'timed_out'],
        ] as const;

        for (const [scenario, expectedStatus] of scenarios) {
            const clock = createMutableClock('2026-08-05T10:00:00Z');
            const ledScheduler = createLedScheduler();
            const commandTimer = createCommandTimer();
            const runtime = createTemperatureRoomRuntime({
                clock,
                generateEventId: createEventIdGenerator(),
                ledScenario: scenario,
                ledScenarioScheduler: ledScheduler,
                commandTimer,
            });

            try {
                runtime.start();
                clock.advanceBy(1);
                runtime.requestCommand({
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                });
                await flushCommandDispatch();

                if (scenario !== 'reject_command') {
                    clock.advanceBy(5_000);
                    commandTimer.runAll();
                }

                if (scenario === 'report_after_timeout') {
                    clock.advanceBy(1_000);
                    ledScheduler.runAll();
                    expect(device(runtime, 'led-main')?.reportedState).toEqual({ power: 'on' });
                }

                expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
                expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                    expect.objectContaining({ status: expectedStatus }),
                ]);
            } finally {
                runtime.stop();
            }
        }
    });

    it('persists a late state report without reconfirming its timed-out command', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const storage = createScriptedStorage();
        const ledScheduler = createLedScheduler();
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            storage: storage.port,
            generateEventId: createEventIdGenerator(),
            generateNativeMessageId: createEventIdGenerator(),
            ledScenario: 'report_after_timeout',
            ledScenarioScheduler: ledScheduler,
            commandTimer,
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            const command = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();
            clock.advanceBy(5_000);
            commandTimer.runAll();
            clock.advanceBy(1_000);
            ledScheduler.runAll();

            expect(device(runtime, 'led-main')?.reportedState).toEqual({ power: 'on' });
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: command.commandId, status: 'timed_out' }),
            ]);
            expect(storage.significantFacts).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventType: 'command.timed_out',
                        commandId: command.commandId,
                    }),
                    expect.objectContaining({
                        eventType: 'device.state.reported',
                        deviceId: 'led-main',
                        payload: { reportedState: { power: 'on' } },
                    }),
                ]),
            );
            expect(storage.significantFacts).not.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        eventType: 'command.confirmed',
                        commandId: command.commandId,
                    }),
                ]),
            );
        } finally {
            runtime.stop();
        }
    });

    it('records dispatch before a synchronous simulator rejection without lifecycle diagnostics', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            commandTimer,
            generateEventId: createEventIdGenerator(),
            ledScenario: 'reject_command',
        });

        try {
            runtime.start();
            clock.advanceBy(1);
            const result = runtime.requestCommand({
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedState: { power: 'on' },
            });
            await flushCommandDispatch();

            expect(result).toEqual(expect.objectContaining({ status: 'accepted' }));
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ commandId: result.commandId, status: 'failed' }),
            ]);
            expect(commandTimer.size()).toBe(0);
            expect(runtime.getDiagnosticsSnapshot().ignoredEvents).toEqual([]);
        } finally {
            runtime.stop();
        }
    });

    it('returns the documented read-only rejection reason for a temperature sensor', () => {
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-08-05T10:00:00Z'),
            generateEventId: createEventIdGenerator(),
        });

        try {
            runtime.start();

            expect(
                runtime.requestCommand({
                    deviceId: 'temp-desk',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                }),
            ).toEqual(expect.objectContaining({ status: 'rejected', reason: 'read_only_device' }));
        } finally {
            runtime.stop();
        }
    });

    it('reschedules a pending command timeout after a runtime restart', async () => {
        const clock = createMutableClock('2026-08-05T10:00:00Z');
        const commandTimer = createCommandTimer();
        const runtime = createTemperatureRoomRuntime({
            clock,
            generateEventId: createEventIdGenerator(),
            ledScenario: 'omit_confirmation',
            commandTimer,
        });

        runtime.start();
        clock.advanceBy(1);
        runtime.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        await flushCommandDispatch();
        runtime.stop();
        clock.advanceBy(5_000);
        runtime.start();

        try {
            commandTimer.runAll();
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([
                expect.objectContaining({ status: 'timed_out' }),
            ]);
        } finally {
            runtime.stop();
        }
    });

    it('cancels a delayed LED report when the runtime stops before restarting', () => {
        const scheduler = createLedScheduler();
        const runtime = createTemperatureRoomRuntime({
            clock: createMutableClock('2026-08-05T10:00:00Z'),
            generateEventId: createEventIdGenerator(),
            ledScenario: 'confirm_delayed',
            ledScenarioScheduler: scheduler,
        });

        runtime.start();
        runtime.requestCommand({
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        });
        runtime.stop();
        scheduler.runAll();
        runtime.start();

        try {
            expect(device(runtime, 'led-main')).toEqual(
                expect.objectContaining({ reportedState: { power: 'off' } }),
            );
        } finally {
            runtime.stop();
        }
    });
});

function device(runtime: ReturnType<typeof createTemperatureRoomRuntime>, deviceId: string) {
    return runtime.getRoomSnapshot().devices.find((candidate) => candidate.deviceId === deviceId);
}

function createMixedRestartCheckpoint(clock: Clock): LatestRoomProjectionInput & {
    projection: Pick<
        RoomSnapshotProjection,
        'updatedAt' | 'devices' | 'activeCommands' | 'recentCommands'
    >;
} {
    const baseline = createTemperatureRoomRuntime({
        clock,
        timer: createManualTimer(),
    }).getRoomSnapshot();
    const timestamp = clock.now();
    const activeCommand = {
        commandId: 'checkpoint-active-command',
        deviceId: 'led-main',
        commandType: 'set.power',
        requestedState: { power: 'on' },
        requestedAt: timestamp,
        durability: 'durable',
        lifecycleDurability: 'volatile',
        status: 'accepted',
    } satisfies ActiveCommandProjection;
    const recentCommands: TerminalCommandProjection[] = Array.from({ length: 20 }, (_, index) => {
        const failedAt = new Date(Date.parse(timestamp) - (index + 1) * 1_000).toISOString();

        return {
            commandId: `checkpoint-terminal-${String(index).padStart(2, '0')}`,
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: index % 2 === 0 ? 'off' : 'on' },
            requestedAt: new Date(Date.parse(failedAt) - 1_000).toISOString(),
            durability: index % 2 === 0 ? 'durable' : 'volatile',
            lifecycleDurability: index % 2 === 0 ? 'volatile' : 'durable',
            status: 'failed',
            failedAt,
            reason: 'checkpoint_restart_fixture',
            message: 'Persisted terminal command used for restart verification.',
        };
    });
    const devices = baseline.devices.map((candidate) => {
        if (candidate.deviceId === 'temp-desk') {
            return {
                ...candidate,
                availability: 'online' as const,
                availabilityChangedAt: timestamp,
                availabilityDurability: 'volatile' as const,
                health: 'degraded' as const,
                healthChangedAt: timestamp,
                healthDurability: 'durable' as const,
                healthReason: 'partial_data',
                reportedState: { temperature: 22.4, temperatureUnit: 'celsius' },
                observationStatus: {
                    temperature: {
                        freshness: 'fresh' as const,
                        lastObservedAt: timestamp,
                        durability: 'volatile' as const,
                    },
                },
            };
        }

        if (candidate.deviceId === 'temp-window') {
            return {
                ...candidate,
                availability: 'offline' as const,
                availabilityChangedAt: timestamp,
                availabilityDurability: 'durable' as const,
                availabilityReason: 'checkpoint_restart_fixture',
                health: 'healthy' as const,
                healthChangedAt: timestamp,
                healthDurability: 'volatile' as const,
                observationStatus: {
                    temperature: { freshness: 'unknown' as const, durability: 'volatile' as const },
                },
            };
        }

        if (candidate.deviceId === 'led-main') {
            return {
                ...candidate,
                availability: 'online' as const,
                availabilityChangedAt: timestamp,
                availabilityDurability: 'durable' as const,
                health: 'healthy' as const,
                healthChangedAt: timestamp,
                healthDurability: 'volatile' as const,
                reportedState: { power: 'off' as const },
                observationStatus: {
                    power: { freshness: 'unknown' as const, durability: 'volatile' as const },
                },
                commandAvailability: { policy: 'allow' as const },
                activeCommandId: activeCommand.commandId,
            };
        }

        return candidate;
    });
    const projection = {
        updatedAt: timestamp,
        devices,
        activeCommands: [activeCommand],
        recentCommands,
    } satisfies Pick<
        RoomSnapshotProjection,
        'updatedAt' | 'devices' | 'activeCommands' | 'recentCommands'
    >;
    const recentEvents: RecentEventProjection[] = [
        {
            recordId: 'checkpoint-volatile-feed',
            eventType: 'device.availability.changed',
            occurredAt: timestamp,
            durability: 'volatile',
            deviceId: 'temp-desk',
            source: 'simulator-adapter',
            payload: {
                previousAvailability: 'unknown',
                availability: 'online',
                reason: 'checkpoint_restart_fixture',
            },
        },
        {
            recordId: 'checkpoint-durable-feed',
            eventType: 'device.availability.changed',
            occurredAt: new Date(Date.parse(timestamp) - 1_000).toISOString(),
            durability: 'durable',
            storageSequence: 7,
            deviceId: 'temp-window',
            source: 'simulator-adapter',
            payload: {
                previousAvailability: 'unknown',
                availability: 'offline',
                reason: 'checkpoint_restart_fixture',
            },
        },
    ];

    return {
        updatedAt: timestamp,
        projection,
        projectionEvidence: {
            availabilityDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
            healthDeviceIds: ['led-main', 'temp-desk', 'temp-window'],
        },
        volatileGuards: [],
        recentEvents,
    };
}

function writeLegacyCommandCheckpoint(databasePath: string): string {
    const database = new DatabaseSync(databasePath);
    const row = database
        .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
        .get() as { projection_json: string };
    const checkpoint = JSON.parse(row.projection_json) as {
        checkpointVersion?: number;
        projection: {
            devices: Array<{ deviceId: string; activeCommandId?: string }>;
            recentCommands: unknown[];
        };
    };
    delete checkpoint.checkpointVersion;

    const led = checkpoint.projection.devices.find(
        (candidate) => candidate.deviceId === 'led-main',
    );

    if (!led) {
        database.close();

        throw new Error('Expected an LED device checkpoint.');
    }

    const commandId = 'legacy-confirmed-command';

    led.activeCommandId = commandId;
    checkpoint.projection.recentCommands = [
        {
            commandId,
            deviceId: 'led-main',
            commandType: 'set.power',
            requestedState: { power: 'on' },
            requestedAt: '2026-08-05T10:00:00.000Z',
            durability: 'durable',
            lifecycleDurability: 'durable',
            status: 'confirmed',
            dispatchedAt: '2026-08-05T10:00:00.000Z',
            deadlineAt: '2026-08-05T10:00:05.000Z',
            confirmedAt: '2026-08-05T10:00:01.000Z',
        },
    ];
    database
        .prepare('UPDATE latest_room_projection SET projection_json = ? WHERE id = 1')
        .run(JSON.stringify(checkpoint));
    database.close();

    return commandId;
}

function createEventIdGenerator(): () => string {
    let index = 0;

    return () => `evt-temperature-${++index}`;
}

function nativeMessageIdsForRedelivery(): () => string {
    const messageIds = [
        'led-availability',
        'led-state',
        'temp-desk-availability',
        'source-reading-1',
        'temp-window-availability',
        'temp-window-reading',
    ];
    let index = 0;

    return () => messageIds[index++] ?? `extra-${index}`;
}

function createMutableClock(
    initialTimestamp: string,
): Clock & { advanceBy(milliseconds: number): void } {
    let currentTimeMs = Date.parse(initialTimestamp);

    return {
        now: () => new Date(currentTimeMs).toISOString(),
        advanceBy(milliseconds) {
            currentTimeMs += milliseconds;
        },
    };
}

function createManualTimer(): TimerScheduler<number> & {
    intervals: number[];
    run(handle: number): void;
    runLatest(): void;
} {
    const callbacks = new Map<number, () => void>();
    const intervals: number[] = [];
    let nextHandle = 1;

    return {
        intervals,
        setInterval(callback, intervalMs) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);
            intervals.push(intervalMs);

            return handle;
        },
        clearInterval(handle) {
            callbacks.delete(handle);
        },
        run(handle) {
            callbacks.get(handle)?.();
        },
        runLatest() {
            callbacks.get(nextHandle - 1)?.();
        },
    };
}

function createLedScheduler() {
    const callbacks = new Map<number, () => void>();
    let nextHandle = 1;

    return {
        setTimeout(callback: () => void) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);

            return handle;
        },
        clearTimeout(timerHandle: unknown) {
            if (typeof timerHandle === 'number') {
                callbacks.delete(timerHandle);
            }
        },
        runAll() {
            for (const callback of callbacks.values()) {
                callback();
            }

            callbacks.clear();
        },
    };
}

function createCommandTimer() {
    const callbacks = new Map<number, () => void>();
    const delays: number[] = [];
    let nextHandle = 1;

    return {
        delays,
        setTimeout(callback: () => void, delayMs: number) {
            const handle = nextHandle++;
            callbacks.set(handle, callback);
            delays.push(delayMs);

            return handle;
        },
        clearTimeout(timerHandle: unknown) {
            if (typeof timerHandle === 'number') {
                callbacks.delete(timerHandle);
            }
        },
        runAll() {
            for (const callback of callbacks.values()) {
                callback();
            }

            callbacks.clear();
        },
        size() {
            return callbacks.size;
        },
    };
}

function createScriptedStorage() {
    const significantFacts: StoredSignificantFact[] = [];
    const telemetrySamples: StoredTelemetrySample[] = [];
    const quarantineEntries: StoredQuarantineEntry[] = [];
    const identities: AcceptedInputIdentity[] = [];
    const receipts = new Map<string, SimulatorCommandReceiptInput>();
    const transactionOperations: string[][] = [];
    let storageSequence = 0;
    let internalSequence = 0;
    let latestCheckpoint: LatestRoomProjectionInput | undefined;
    let nextOutcome:
        | { status: 'confirmed_rolled_back' | 'indeterminate'; error: unknown }
        | undefined;
    let receiptFailure:
        | {
              operation: string;
              outcome: { status: 'confirmed_rolled_back' | 'indeterminate'; error: unknown };
          }
        | undefined;
    let beforeOutcome: ((operations: string[]) => boolean | void) | undefined;

    const port: RoomStorage = {
        getMetadata() {
            return {
                historyGenerationId: 'scripted-generation',
                schemaVersion: 1,
                lastStorageSequence: storageSequence,
            };
        },
        transact<Value>(operation: (transaction: RoomStorageTransaction) => Value) {
            const operations: string[] = [];
            const stagedFacts: StoredSignificantFact[] = [];
            const stagedTelemetry: StoredTelemetrySample[] = [];
            const stagedQuarantine: StoredQuarantineEntry[] = [];
            const stagedIdentities: AcceptedInputIdentity[] = [];
            let stagedCheckpoint: LatestRoomProjectionInput | undefined;
            let stagedStorageSequence = storageSequence;
            let stagedInternalSequence = internalSequence;
            const stagedReceipts = new Map(receipts);
            const transaction: RoomStorageTransaction = {
                getMetadata() {
                    return {
                        historyGenerationId: 'scripted-generation',
                        schemaVersion: 1,
                        lastStorageSequence: stagedStorageSequence,
                    };
                },
                appendSignificantFact(input: SignificantFactInput) {
                    operations.push('appendSignificantFact');
                    const stored = { ...input, storageSequence: ++stagedStorageSequence };
                    stagedFacts.push(stored);

                    return stored;
                },
                appendTelemetrySample(input: TelemetrySampleInput) {
                    operations.push('appendTelemetrySample');
                    const stored = { ...input, storageSequence: ++stagedStorageSequence };
                    stagedTelemetry.push(stored);

                    return stored;
                },
                appendQuarantineEntry(input: QuarantineEntryInput) {
                    operations.push('appendQuarantineEntry');
                    const stored = { ...input, internalSequence: ++stagedInternalSequence };
                    stagedQuarantine.push(stored);

                    return stored;
                },
                upsertAcceptedInputIdentity(input: AcceptedInputIdentity) {
                    operations.push('upsertAcceptedInputIdentity');
                    stagedIdentities.push(input);
                },
                retireExpiredRecords() {
                    operations.push('retireExpiredRecords');

                    return [];
                },
                saveLatestRoomProjection(input: LatestRoomProjectionInput) {
                    operations.push('saveLatestRoomProjection');
                    stagedCheckpoint = input;
                },
                upsertCommandDispatchOutboxIntent() {
                    operations.push('upsertCommandDispatchOutboxIntent');
                },
                closeCommandDispatchOutboxIntent() {
                    operations.push('closeCommandDispatchOutboxIntent');
                },
                getSimulatorCommandReceipt(source, commandId) {
                    operations.push('getSimulatorCommandReceipt');

                    return stagedReceipts.get(`${source}:${commandId}`);
                },
                insertSimulatorCommandReceipt(input) {
                    operations.push('insertSimulatorCommandReceipt');
                    const key = `${input.source}:${input.commandId}`;

                    if (stagedReceipts.has(key)) {
                        return false;
                    }

                    stagedReceipts.set(key, input);

                    return true;
                },
                updateSimulatorCommandReceipt(input) {
                    operations.push('updateSimulatorCommandReceipt');
                    stagedReceipts.set(`${input.source}:${input.commandId}`, input);
                },
                retireTerminalSimulatorCommandReceipts() {
                    operations.push('retireTerminalSimulatorCommandReceipts');
                },
                activateRuntimeSession() {
                    operations.push('activateRuntimeSession');
                },
                closeRuntimeSession() {
                    operations.push('closeRuntimeSession');
                },
            };
            const value = operation(transaction);
            transactionOperations.push([...operations]);
            const hook = beforeOutcome;
            const hookHandled = hook?.(operations);

            if (hookHandled !== false) {
                beforeOutcome = undefined;
            }

            const usesReceiptPort = operations.some((operationName) =>
                operationName.includes('SimulatorCommandReceipt'),
            );
            const configuredOutcome = usesReceiptPort
                ? receiptFailure && operations.includes(receiptFailure.operation)
                    ? receiptFailure.outcome
                    : undefined
                : nextOutcome;

            if (usesReceiptPort && configuredOutcome) {
                receiptFailure = undefined;
            }

            if (!usesReceiptPort) {
                nextOutcome = undefined;
            }

            if (configuredOutcome) {
                return configuredOutcome;
            }

            significantFacts.push(...stagedFacts);
            telemetrySamples.push(...stagedTelemetry);
            quarantineEntries.push(...stagedQuarantine);

            for (const identity of stagedIdentities) {
                const index = identities.findIndex(
                    (candidate) => candidate.eventId === identity.eventId,
                );

                if (index >= 0) {
                    identities[index] = identity;
                } else {
                    identities.push(identity);
                }
            }

            if (stagedCheckpoint) {
                latestCheckpoint = stagedCheckpoint;
            }

            storageSequence = stagedStorageSequence;
            internalSequence = stagedInternalSequence;
            receipts.clear();

            for (const [key, receipt] of stagedReceipts) {
                receipts.set(key, receipt);
            }

            return { status: 'committed', value };
        },
        listAcceptedInputIdentities() {
            return [...identities];
        },
        isAcceptedInputIdentityActive(eventId) {
            return identities.some((identity) => identity.eventId === eventId);
        },
        listSignificantFacts() {
            return [...significantFacts];
        },
        listTelemetrySamples({ deviceId, metric, from, to }) {
            return telemetrySamples.filter(
                (sample) =>
                    sample.deviceId === deviceId &&
                    sample.metric === metric &&
                    (from === undefined || Date.parse(sample.occurredAt) >= Date.parse(from)) &&
                    (to === undefined || Date.parse(sample.occurredAt) < Date.parse(to)),
            );
        },
        listQuarantineEntries() {
            return [...quarantineEntries];
        },
        upsertSimulatorCommandReceipt(input) {
            receipts.set(`${input.source}:${input.commandId}`, input);
        },
        getSimulatorCommandReceipt(source, commandId) {
            return receipts.get(`${source}:${commandId}`);
        },
        listSimulatorCommandReceipts(source) {
            return [...receipts.values()].filter((receipt) => receipt.source === source);
        },
        getLatestRoomProjection() {
            return latestCheckpoint;
        },
        listCommandDispatchOutboxIntents() {
            return [];
        },
        close() {},
    };

    return {
        port,
        significantFacts,
        telemetrySamples,
        quarantineEntries,
        identities,
        transactionOperations,
        get latestCheckpoint() {
            return latestCheckpoint;
        },
        failNext(status: 'confirmed_rolled_back' | 'indeterminate', error: unknown) {
            nextOutcome = { status, error };
        },
        failReceiptTransactionContaining(
            operation: string,
            status: 'confirmed_rolled_back' | 'indeterminate',
            error: unknown,
        ) {
            receiptFailure = { operation, outcome: { status, error } };
        },
        setBeforeOutcome(callback: (operations: string[]) => boolean | void) {
            beforeOutcome = callback;
        },
        seedCheckpoint(checkpoint: LatestRoomProjectionInput) {
            latestCheckpoint = checkpoint;
        },
    };
}

function createCapturingStorage() {
    const significantFacts: Array<{
        eventId?: string;
        eventType: string;
        commandId?: string;
        payload: unknown;
    }> = [];
    let storageSequence = 0;
    const receipts = new Map<string, SimulatorCommandReceiptInput>();

    return {
        significantFacts,
        port: {
            getMetadata() {
                return {
                    historyGenerationId: 'test-generation',
                    schemaVersion: 1,
                    lastStorageSequence: storageSequence,
                };
            },
            getLatestRoomProjection() {
                return undefined;
            },
            listAcceptedInputIdentities() {
                return [];
            },
            transact(
                operation: (transaction: {
                    appendSignificantFact(input: {
                        eventId?: string;
                        eventType: string;
                        commandId?: string;
                        payload: unknown;
                    }): { storageSequence: number };
                    appendTelemetrySample(): { storageSequence: number };
                    appendQuarantineEntry(): { internalSequence: number };
                    upsertAcceptedInputIdentity(): void;
                    retireExpiredRecords(): void;
                    saveLatestRoomProjection(): void;
                    upsertCommandDispatchOutboxIntent(): void;
                    closeCommandDispatchOutboxIntent(): void;
                    getSimulatorCommandReceipt(
                        source: string,
                        commandId: string,
                    ): SimulatorCommandReceiptInput | undefined;
                    insertSimulatorCommandReceipt(input: SimulatorCommandReceiptInput): boolean;
                    updateSimulatorCommandReceipt(input: SimulatorCommandReceiptInput): void;
                    retireTerminalSimulatorCommandReceipts(): void;
                }) => unknown,
            ) {
                const value = operation({
                    appendSignificantFact(input) {
                        significantFacts.push(input);

                        return { storageSequence: ++storageSequence };
                    },
                    appendTelemetrySample() {
                        return { storageSequence: ++storageSequence };
                    },
                    appendQuarantineEntry() {
                        return { internalSequence: 1 };
                    },
                    upsertAcceptedInputIdentity() {},
                    retireExpiredRecords() {},
                    saveLatestRoomProjection() {},
                    upsertCommandDispatchOutboxIntent() {},
                    closeCommandDispatchOutboxIntent() {},
                    getSimulatorCommandReceipt(source, commandId) {
                        return receipts.get(`${source}:${commandId}`);
                    },
                    insertSimulatorCommandReceipt(input) {
                        const key = `${input.source}:${input.commandId}`;

                        if (receipts.has(key)) {
                            return false;
                        }

                        receipts.set(key, input);

                        return true;
                    },
                    updateSimulatorCommandReceipt(input) {
                        receipts.set(`${input.source}:${input.commandId}`, input);
                    },
                    retireTerminalSimulatorCommandReceipts() {},
                });

                return { status: 'committed' as const, value };
            },
            listSimulatorCommandReceipts(source: string) {
                return [...receipts.values()].filter((receipt) => receipt.source === source);
            },
            listCommandDispatchOutboxIntents() {
                return [];
            },
            isAcceptedInputIdentityActive() {
                return false;
            },
            listSignificantFacts() {
                return [];
            },
            listTelemetrySamples() {
                return [];
            },
            listQuarantineEntries() {
                return [];
            },
            upsertSimulatorCommandReceipt(input: SimulatorCommandReceiptInput) {
                receipts.set(`${input.source}:${input.commandId}`, input);
            },
            getSimulatorCommandReceipt(source: string, commandId: string) {
                return receipts.get(`${source}:${commandId}`);
            },
            close() {},
        } as unknown as RoomStorage,
    };
}

async function flushCommandDispatch(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}
