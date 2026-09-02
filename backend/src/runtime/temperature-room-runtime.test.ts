import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Clock, TimerScheduler } from '@smart-room/simulator';
import { describe, expect, it } from 'vitest';

import { inputFingerprint } from '../platform/event-processing/event-identity';
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
import { createSqliteRoomStorage } from '../platform/storage/sqlite-room-storage';
import {
    StorageAvailabilityError,
    StorageInvariantError,
} from '../platform/storage/storage-errors';

import { createTemperatureRoomRuntime } from './temperature-room-runtime';

describe('createTemperatureRoomRuntime', () => {
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
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
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
            expect(device(runtime, 'temp-desk')).toMatchObject({
                reportedState: { temperature: 22.2, temperatureUnit: 'celsius' },
                observationStatus: { temperature: { durability: 'durable' } },
            });
        } finally {
            runtime.stop();
        }
    });

    it('publishes degraded before applying the rolled-back telemetry as volatile', () => {
        const clock = createMutableClock('2026-08-31T09:00:00Z');
        const storage = createScriptedStorage();
        const runtime = createTemperatureRoomRuntime({
            clock,
            timer: createManualTimer(),
            storage: storage.port,
            generateNativeMessageId: createEventIdGenerator(),
        });
        const snapshots: ReturnType<typeof runtime.getRoomSnapshot>[] = [];
        runtime.subscribeRoomSnapshot((snapshot) => snapshots.push(snapshot));

        try {
            runtime.start();
            snapshots.length = 0;
            const telemetryCount = storage.telemetrySamples.length;
            const identityCount = storage.identities.length;
            const checkpoint = storage.latestCheckpoint;
            const previousState = device(runtime, 'temp-desk')?.reportedState;
            storage.failNext(
                'confirmed_rolled_back',
                new StorageAvailabilityError('database is busy', undefined),
            );

            clock.advanceBy(1_000);
            runtime.runDeviceScenario('temp-desk', 'emit_next_reading');

            expect(snapshots).toHaveLength(2);
            expect(snapshots[0]?.platform.storage.status).toBe('degraded');
            expect(
                snapshots[0]?.devices.find((candidate) => candidate.deviceId === 'temp-desk')
                    ?.reportedState,
            ).toEqual(previousState);
            expect(
                snapshots[1]?.devices.find((candidate) => candidate.deviceId === 'temp-desk'),
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
            initialRuntime.stop();
            initialStorage.close();
            clock.advanceBy(5_000);

            recoveredStorage = createSqliteRoomStorage({ databasePath });
            recoveredRuntime = createTemperatureRoomRuntime({
                clock,
                storage: recoveredStorage,
                ledScenario: 'omit_confirmation',
                commandTimer: createCommandTimer(),
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
        } finally {
            initialRuntime.stop();
            initialStorage.close();
            recoveredRuntime?.stop();
            recoveredStorage?.close();
            rmSync(directory, { force: true, recursive: true });
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
                expect(operations).toEqual(['retireExpiredRecords', 'saveLatestRoomProjection']);
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

    it('publishes degraded before applying rolled-back freshness in memory', () => {
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

            expect(snapshots).toHaveLength(2);
            expect(snapshots[0]?.platform.storage.status).toBe('degraded');
            expect(
                snapshots[0]?.devices.find((candidate) => candidate.deviceId === 'temp-desk')
                    ?.observationStatus.temperature,
            ).toMatchObject({ freshness: 'fresh', durability: 'durable' });
            expect(
                snapshots[1]?.devices.find((candidate) => candidate.deviceId === 'temp-desk')
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
            storage.setBeforeOutcome(() => clock.advanceBy(5_000));
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
    let storageSequence = 0;
    let internalSequence = 0;
    let latestCheckpoint: LatestRoomProjectionInput | undefined;
    let nextOutcome:
        | { status: 'confirmed_rolled_back' | 'indeterminate'; error: unknown }
        | undefined;
    let beforeOutcome: ((operations: string[]) => void) | undefined;

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
            const transaction: RoomStorageTransaction = {
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
            };
            const value = operation(transaction);
            const hook = beforeOutcome;
            beforeOutcome = undefined;
            hook?.(operations);
            const configuredOutcome = nextOutcome;
            nextOutcome = undefined;

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
        get latestCheckpoint() {
            return latestCheckpoint;
        },
        failNext(status: 'confirmed_rolled_back' | 'indeterminate', error: unknown) {
            nextOutcome = { status, error };
        },
        setBeforeOutcome(callback: (operations: string[]) => void) {
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
                });

                return { status: 'committed' as const, value };
            },
        } as unknown as RoomStorage,
    };
}

async function flushCommandDispatch(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}
