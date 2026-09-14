import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { migrateSqliteDatabase, roomStorageMigrations } from './sqlite-migrations';
import { createSqliteRoomStorage, executeStorageTransaction } from './sqlite-room-storage';
import { createSqliteRoomStorageLifecycle } from './sqlite-room-storage-lifecycle';
import {
    classifySqliteError,
    StorageAvailabilityError,
    StorageInvariantError,
    StorageManualInterventionError,
    StorageMigrationError,
    StorageSchemaError,
} from './storage-errors';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

describe('SQLite room storage', () => {
    it('lists open runtime sessions and never moves their durable commit timestamp backwards', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });

        try {
            storage.transact((transaction) => {
                transaction.activateRuntimeSession({
                    sessionId: 'later-session',
                    sessionStartedAt: '2026-09-09T10:01:00.000Z',
                    lastDurableCommitAt: '2026-09-09T10:03:00.000Z',
                });
                transaction.activateRuntimeSession({
                    sessionId: 'earlier-session',
                    sessionStartedAt: '2026-09-09T10:00:00.000Z',
                    lastDurableCommitAt: '2026-09-09T10:02:00.000Z',
                });
                transaction.activateRuntimeSession({
                    sessionId: 'later-session',
                    sessionStartedAt: '2026-09-09T10:01:00.000Z',
                    lastDurableCommitAt: '2026-09-09T10:02:30.000Z',
                });
            });

            expect(storage.listUnclosedRuntimeSessions()).toEqual([
                {
                    sessionId: 'earlier-session',
                    sessionStartedAt: '2026-09-09T10:00:00.000Z',
                    lastDurableCommitAt: '2026-09-09T10:02:00.000Z',
                },
                {
                    sessionId: 'later-session',
                    sessionStartedAt: '2026-09-09T10:01:00.000Z',
                    lastDurableCommitAt: '2026-09-09T10:03:00.000Z',
                },
            ]);

            storage.transact((transaction) => {
                transaction.closeRuntimeSession({
                    sessionId: 'earlier-session',
                    closedAt: '2026-09-09T10:04:00.000Z',
                });
            });

            expect(storage.listUnclosedRuntimeSessions()).toEqual([
                expect.objectContaining({ sessionId: 'later-session' }),
            ]);
        } finally {
            storage.close();
        }
    });

    it('keeps a missing recovery target absent after a rollback-only first-initialization probe', () => {
        const databasePath = temporaryDatabasePath();
        const lifecycle = createSqliteRoomStorageLifecycle({
            databasePath,
            ensureDirectory() {},
            generateHistoryGenerationId: () => '11111111-1111-4111-8111-111111111111',
        });

        expect(lifecycle.probe({ verifiedHistoryGenerationId: undefined })).toEqual({
            kind: 'first_initialization',
        });
        expect(existsSync(databasePath)).toBe(false);
    });

    it('classifies recovery probe directory failures as availability errors', () => {
        const lifecycle = createSqliteRoomStorageLifecycle({
            databasePath: join(tmpdir(), 'unavailable', 'room.sqlite'),
            ensureDirectory() {
                throw { code: 'EACCES' };
            },
        });

        expect(() => lifecycle.probe({ verifiedHistoryGenerationId: undefined })).toThrow(
            StorageAvailabilityError,
        );
    });

    it('refuses automatic recovery when a verified generation changes', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const metadata = storage.getMetadata();
        storage.close();
        const lifecycle = createSqliteRoomStorageLifecycle({ databasePath, ensureDirectory() {} });

        expect(() =>
            lifecycle.probe({
                verifiedHistoryGenerationId: `${metadata.historyGenerationId}-other`,
            }),
        ).toThrow(StorageManualInterventionError);
    });

    it('treats migration-manifest checksum and continuity drift as fatal during recovery probes', () => {
        const checksumPath = temporaryDatabasePath();
        const checksumStorage = createSqliteRoomStorage({ databasePath: checksumPath });
        checksumStorage.close();
        const checksumDatabase = new DatabaseSync(checksumPath);
        checksumDatabase
            .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
            .run('changed');
        checksumDatabase.close();

        const checksumLifecycle = createSqliteRoomStorageLifecycle({
            databasePath: checksumPath,
            ensureDirectory() {},
        });
        expect(() => checksumLifecycle.probe({ verifiedHistoryGenerationId: undefined })).toThrow(
            StorageSchemaError,
        );

        const continuityPath = temporaryDatabasePath();
        const continuityStorage = createSqliteRoomStorage({ databasePath: continuityPath });
        continuityStorage.close();
        const continuityDatabase = new DatabaseSync(continuityPath);
        continuityDatabase.prepare('DELETE FROM schema_migrations WHERE version = 1').run();
        continuityDatabase.close();

        const continuityLifecycle = createSqliteRoomStorageLifecycle({
            databasePath: continuityPath,
            ensureDirectory() {},
        });
        expect(() => continuityLifecycle.probe({ verifiedHistoryGenerationId: undefined })).toThrow(
            StorageSchemaError,
        );
    });

    it('does not let an abort latch hide a classified existing-generation cutover failure', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const lifecycle = createSqliteRoomStorageLifecycle({ databasePath, ensureDirectory() {} });
        const probe = lifecycle.probe({ verifiedHistoryGenerationId: undefined });

        if (probe.kind === 'existing_generation') {
            probe.storage.close();
        }

        const outcome = lifecycle.cutover({
            probe,
            shouldAbort: () => true,
            operation() {
                throw new StorageInvariantError('recovery invariant failed', undefined);
            },
        });

        expect(outcome).toEqual({
            status: 'confirmed_rolled_back',
            error: expect.objectContaining({ kind: 'fatal', category: 'invariant' }),
        });
    });

    it('creates schema and a recovery gap in one first-initialization cutover', () => {
        const databasePath = temporaryDatabasePath();
        const lifecycle = createSqliteRoomStorageLifecycle({
            databasePath,
            ensureDirectory() {},
            generateHistoryGenerationId: () => '22222222-2222-4222-8222-222222222222',
        });
        const probe = lifecycle.probe({ verifiedHistoryGenerationId: undefined });
        const outcome = lifecycle.cutover({
            probe,
            shouldAbort: () => false,
            operation(transaction) {
                return transaction.appendSignificantFact({
                    recordId: `rec:v1:sha256:${'1'.repeat(64)}`,
                    eventType: 'storage.gap.recorded',
                    source: 'backend',
                    occurredAt: '2026-09-03T08:00:00.000Z',
                    payload: { observationsBackfilled: false },
                }).storageSequence;
            },
        });

        expect(outcome).toMatchObject({
            status: 'committed',
            value: 1,
            metadata: {
                historyGenerationId: '22222222-2222-4222-8222-222222222222',
                lastStorageSequence: 1,
            },
        });

        if (outcome.status === 'committed') {
            expect(outcome.storage.listSignificantFacts()).toHaveLength(1);
            outcome.storage.close();
        }
    });

    it('rolls back the complete first-initialization schema, checkpoint, session, and gap', () => {
        const databasePath = temporaryDatabasePath();
        const lifecycle = createSqliteRoomStorageLifecycle({ databasePath, ensureDirectory() {} });
        const probe = lifecycle.probe({ verifiedHistoryGenerationId: undefined });
        const outcome = lifecycle.cutover({
            probe,
            shouldAbort: () => true,
            operation(transaction) {
                transaction.appendSignificantFact({
                    recordId: `rec:v1:sha256:${'2'.repeat(64)}`,
                    eventType: 'storage.gap.recorded',
                    source: 'backend',
                    occurredAt: '2026-09-03T08:00:00.000Z',
                    payload: { observationsBackfilled: false },
                });
                transaction.saveLatestRoomProjection({
                    updatedAt: '2026-09-03T08:00:00.000Z',
                    projection: emptyRoomProjection('2026-09-03T08:00:00.000Z'),
                    projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                    volatileGuards: [],
                    recentEvents: [],
                });
                transaction.activateRuntimeSession({
                    sessionId: 'session-aborted',
                    sessionStartedAt: '2026-09-03T08:00:00.000Z',
                    lastDurableCommitAt: '2026-09-03T08:00:00.000Z',
                });

                return undefined;
            },
        });

        expect(outcome).toEqual({ status: 'aborted' });
        const database = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(),
        ).toEqual([]);
        database.close();
    });

    it('reclassifies a target created after a first-initialization probe without overwriting it', () => {
        const databasePath = temporaryDatabasePath();
        const lifecycle = createSqliteRoomStorageLifecycle({ databasePath, ensureDirectory() {} });
        const probe = lifecycle.probe({ verifiedHistoryGenerationId: undefined });
        const foreign = new DatabaseSync(databasePath);
        foreign.exec('CREATE TABLE foreign_data (id INTEGER PRIMARY KEY) STRICT;');
        foreign.close();

        const outcome = lifecycle.cutover({
            probe,
            shouldAbort: () => false,
            operation() {
                return undefined;
            },
        });

        expect(outcome).toEqual({
            status: 'confirmed_rolled_back',
            error: expect.any(StorageManualInterventionError),
        });
        const after = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            after.prepare("SELECT name FROM sqlite_schema WHERE name = 'foreign_data'").get(),
        ).toBeDefined();
        expect(
            after.prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migrations'").get(),
        ).toBeUndefined();
        after.close();
    });

    it('treats a partial application target that appears after probe as fatal without overwriting it', () => {
        const databasePath = temporaryDatabasePath();
        const lifecycle = createSqliteRoomStorageLifecycle({ databasePath, ensureDirectory() {} });
        const probe = lifecycle.probe({ verifiedHistoryGenerationId: undefined });
        const partial = new DatabaseSync(databasePath);
        partial.exec('CREATE TABLE storage_metadata (history_generation_id TEXT NOT NULL) STRICT;');
        partial.close();

        const outcome = lifecycle.cutover({
            probe,
            shouldAbort: () => false,
            operation() {
                return undefined;
            },
        });

        expect(outcome).toEqual({
            status: 'confirmed_rolled_back',
            error: expect.any(StorageSchemaError),
        });
        const after = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            after.prepare("SELECT name FROM sqlite_schema WHERE name = 'storage_metadata'").get(),
        ).toBeDefined();
        expect(
            after.prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migrations'").get(),
        ).toBeUndefined();
        after.close();
    });

    it('classifies a foreign SQLite target as manual intervention without replacing it', () => {
        const databasePath = temporaryDatabasePath();
        const database = new DatabaseSync(databasePath);
        database.exec('CREATE TABLE foreign_data (id INTEGER PRIMARY KEY) STRICT;');
        database.close();
        const lifecycle = createSqliteRoomStorageLifecycle({
            databasePath,
            ensureDirectory() {},
        });

        expect(lifecycle.openAtStartup()).toEqual({
            kind: 'degraded',
            error: expect.any(StorageManualInterventionError),
        });

        const after = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            after.prepare("SELECT name FROM sqlite_schema WHERE name = 'foreign_data'").get(),
        ).toBeDefined();
        expect(
            after.prepare("SELECT name FROM sqlite_schema WHERE name = 'schema_migrations'").get(),
        ).toBeUndefined();
        after.close();
    });

    it('does not migrate an existing incompatible generation during lifecycle probe', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        database.prepare('DELETE FROM schema_migrations WHERE version = 5').run();
        database.close();
        const lifecycle = createSqliteRoomStorageLifecycle({
            databasePath,
            ensureDirectory() {},
        });

        expect(() => lifecycle.probe({ verifiedHistoryGenerationId: undefined })).toThrow(
            StorageSchemaError,
        );

        const after = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            after.prepare('SELECT MAX(version) AS version FROM schema_migrations').get(),
        ).toEqual({
            version: 4,
        });
        after.close();
    });

    it('initializes a fresh database once and preserves its history generation on reopen', () => {
        const databasePath = temporaryDatabasePath();
        const first = createSqliteRoomStorage({ databasePath });
        const initialMetadata = first.getMetadata();
        first.close();

        const reopened = createSqliteRoomStorage({ databasePath });

        expect(initialMetadata).toEqual({
            historyGenerationId: expect.stringMatching(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            ),
            schemaVersion: 5,
            lastStorageSequence: 0,
        });
        expect(reopened.getMetadata()).toEqual(initialMetadata);
        reopened.close();
    });

    it('migrates legacy storage-gap IDs and keys retained history rows by generation and sequence', () => {
        const databasePath = temporaryDatabasePath();
        const generation = 'legacy-generation';
        const database = new DatabaseSync(databasePath);
        migrateSqliteDatabase(database, generation, roomStorageMigrations.slice(0, 4));
        database
            .prepare(
                `INSERT INTO significant_facts (
                    storage_sequence, record_id, event_type, source, occurred_at, payload_json, retired_at
                ) VALUES (1, ?, 'storage.gap.recorded', 'backend', ?, '{}', NULL)`,
            )
            .run('platform:storage-gap:legacy-gap', '2026-09-10T10:00:00.000Z');
        database
            .prepare(
                `INSERT INTO significant_facts (
                    storage_sequence, record_id, event_type, source, occurred_at, payload_json, retired_at
                ) VALUES (2, ?, 'storage.gap.recorded', 'backend', ?, '{}', ?)`,
            )
            .run(
                'platform:storage-gap:legacy-gap',
                '2026-08-01T10:00:00.000Z',
                '2026-09-01T10:00:00.000Z',
            );
        database
            .prepare('UPDATE storage_metadata SET last_storage_sequence = 2 WHERE id = 1')
            .run();
        database
            .prepare(
                `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                 VALUES (1, ?, ?)`,
            )
            .run(
                '2026-09-10T10:00:00.000Z',
                JSON.stringify({
                    checkpointVersion: 4,
                    updatedAt: '2026-09-10T10:00:00.000Z',
                    projection: emptyRoomProjection('2026-09-10T10:00:00.000Z'),
                    projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                    volatileGuards: [],
                    recentEvents: [
                        {
                            recordId: 'platform:storage-gap:legacy-gap',
                            eventType: 'storage.gap.recorded',
                            occurredAt: '2026-09-10T10:00:00.000Z',
                            durability: 'durable',
                            storageSequence: 1,
                            source: 'backend',
                            payload: {
                                outageStartedAt: '2026-09-10T09:00:00.000Z',
                                outageEndedAt: '2026-09-10T10:00:00.000Z',
                                failureReason: 'storage_write_failed',
                                boundaryBasis: 'same_process_first_degraded_at',
                                observationsBackfilled: false,
                            },
                        },
                    ],
                }),
            );
        database.close();

        const storage = createSqliteRoomStorage({ databasePath });
        const expectedRecordId = /^rec:v1:sha256:[a-f0-9]{64}$/;

        expect(storage.getMetadata()).toMatchObject({
            historyGenerationId: generation,
            schemaVersion: 5,
            lastStorageSequence: 2,
        });
        expect(storage.listSignificantFacts()).toEqual([
            expect.objectContaining({
                historyGenerationId: generation,
                storageSequence: 1,
                recordId: expect.stringMatching(expectedRecordId),
            }),
        ]);
        expect(storage.getLatestRoomProjection()?.recentEvents).toEqual([
            expect.objectContaining({ recordId: expect.stringMatching(expectedRecordId) }),
        ]);
        storage.close();

        const migrated = new DatabaseSync(databasePath, { readOnly: true });
        expect(
            migrated
                .prepare(
                    "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'significant_facts'",
                )
                .get(),
        ).toEqual(
            expect.objectContaining({
                sql: expect.stringMatching(
                    /primary key \(history_generation_id, storage_sequence\)/i,
                ),
            }),
        );
        expect(
            migrated
                .prepare(
                    `SELECT history_generation_id, storage_sequence, record_id
                     FROM significant_facts
                     WHERE storage_sequence = 2`,
                )
                .get(),
        ).toEqual({
            history_generation_id: generation,
            storage_sequence: 2,
            record_id: expect.stringMatching(expectedRecordId),
        });
        migrated.close();
    });

    it('stores and reads every Stage 4 storage category through the port', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const receipt = {
            source: 'simulator-led',
            commandId: 'command-1',
            updatedAt: '2026-08-14T10:00:03.000Z',
            receipt: { scenario: 'confirm_delayed', dueAt: '2026-08-14T10:00:05.000Z' },
        };
        const projection = {
            updatedAt: '2026-08-14T10:00:04.000Z',
            projection: emptyRoomProjection('2026-08-14T10:00:04.000Z'),
            projectionEvidence: {
                availabilityDeviceIds: [],
                healthDeviceIds: [],
                commandConfirmationSources: [{ commandId: 'command-1', eventId: 'state-report-1' }],
            },
            volatileGuards: [],
            recentEvents: [],
        };

        const outcome = storage.transact((transaction) => {
            const fact = transaction.appendSignificantFact({
                recordId: 'fact-1',
                eventId: 'event-fact-1',
                eventType: 'device.availability.changed',
                deviceId: 'led-main',
                source: 'simulator-adapter',
                occurredAt: '2026-08-14T10:00:00.000Z',
                payload: { availability: 'online' },
            });
            const telemetry = transaction.appendTelemetrySample({
                recordId: 'telemetry-1',
                eventId: 'event-telemetry-1',
                deviceId: 'temp-desk',
                metric: 'temperature',
                value: 22.5,
                unit: 'celsius',
                occurredAt: '2026-08-14T10:00:01.000Z',
                payload: { value: 22.5, unit: 'celsius' },
            });
            const quarantine = transaction.appendQuarantineEntry({
                eventId: 'event-invalid-1',
                reason: 'invalid_payload',
                recordedAt: '2026-08-14T10:00:02.000Z',
                rawEvent: { malformed: true },
            });
            transaction.saveLatestRoomProjection(projection);

            return { fact, telemetry, quarantine };
        });

        if (outcome.status !== 'committed') {
            throw outcome.error;
        }

        const { fact, telemetry, quarantine } = outcome.value;
        storage.upsertSimulatorCommandReceipt(receipt);

        expect(fact.storageSequence).toBe(1);
        expect(telemetry.storageSequence).toBe(2);
        expect(storage.getMetadata().lastStorageSequence).toBe(2);
        expect(storage.listSignificantFacts()).toEqual([fact]);
        expect(
            storage.listTelemetrySamples({ deviceId: 'temp-desk', metric: 'temperature' }),
        ).toEqual([telemetry]);
        expect(storage.listQuarantineEntries()).toEqual([quarantine]);
        expect(storage.getSimulatorCommandReceipt(receipt.source, receipt.commandId)).toEqual(
            receipt,
        );
        expect(storage.getLatestRoomProjection()).toEqual(projection);
        storage.close();
    });

    it('keeps non-terminal simulator receipts and evicts only terminal receipts older than 30 days', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const outcome = storage.transact((transaction) => {
            transaction.insertSimulatorCommandReceipt({
                source: 'simulator-led',
                commandId: 'pending',
                updatedAt: '2026-07-01T00:00:00.000Z',
                receipt: { version: 1, state: 'pending' },
            });
            transaction.insertSimulatorCommandReceipt({
                source: 'simulator-led',
                commandId: 'old-terminal',
                updatedAt: '2026-07-01T00:00:00.000Z',
                terminalAt: '2026-07-01T00:00:00.000Z',
                receipt: { version: 1, state: 'terminal' },
            });
            transaction.insertSimulatorCommandReceipt({
                source: 'simulator-led',
                commandId: 'boundary-terminal',
                updatedAt: '2026-07-02T00:00:00.000Z',
                terminalAt: '2026-07-02T00:00:00.000Z',
                receipt: { version: 1, state: 'terminal' },
            });
            transaction.retireTerminalSimulatorCommandReceipts({
                source: 'simulator-led',
                asOf: '2026-08-01T00:00:00.000Z',
            });
        });

        expect(outcome.status).toBe('committed');
        expect(
            storage
                .listSimulatorCommandReceipts('simulator-led')
                .map((receipt) => receipt.commandId),
        ).toEqual(['boundary-terminal', 'pending']);
        storage.close();
    });

    it('rolls back an outbox intent atomically and retains only active work past terminal retention', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const readyIntent = {
            commandId: 'cmd-ready',
            deviceId: 'led-main',
            commandType: 'set.power' as const,
            requestedPower: 'on' as const,
            target: 'simulator-adapter' as const,
            state: 'ready' as const,
            createdAt: '2026-08-01T10:00:00.000Z',
        };

        const rolledBack = storage.transact((transaction) => {
            transaction.upsertCommandDispatchOutboxIntent(readyIntent);

            throw new Error('force rollback');
        });
        expect(rolledBack.status).toBe('confirmed_rolled_back');
        expect(storage.listCommandDispatchOutboxIntents()).toEqual([]);

        expect(
            storage.transact((transaction) => {
                transaction.upsertCommandDispatchOutboxIntent(readyIntent);
                transaction.upsertCommandDispatchOutboxIntent({
                    ...readyIntent,
                    commandId: 'cmd-uncertain',
                    state: 'uncertain',
                    attemptedAt: '2026-08-01T10:00:00.000Z',
                    firstAttemptedAt: '2026-08-01T10:00:00.000Z',
                    deadlineAt: '2026-08-01T10:00:05.000Z',
                    nextAttemptAt: '2026-08-01T10:00:00.500Z',
                });
                transaction.upsertCommandDispatchOutboxIntent({
                    ...readyIntent,
                    commandId: 'cmd-delivered',
                    state: 'delivered',
                    handedOffAt: '2026-08-01T10:00:01.000Z',
                });
                transaction.upsertCommandDispatchOutboxIntent({
                    ...readyIntent,
                    commandId: 'cmd-closed',
                    state: 'closed',
                    closedAt: '2026-08-01T10:00:01.000Z',
                });
                transaction.retireExpiredRecords({ asOf: '2026-09-02T10:00:01.000Z' });
            }).status,
        ).toBe('committed');

        expect(storage.listCommandDispatchOutboxIntents()).toEqual([
            expect.objectContaining({ commandId: 'cmd-ready', state: 'ready' }),
            expect.objectContaining({ commandId: 'cmd-uncertain', state: 'uncertain' }),
        ]);
        storage.close();
    });

    it('orders and retires canonical timestamps by instant rather than text representation', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });

        storage.transact((transaction) => {
            transaction.appendSignificantFact({
                recordId: 'whole-second',
                eventId: 'whole-second-event',
                eventType: 'device.availability.changed',
                occurredAt: '2026-08-14T00:00:00Z',
                payload: { availability: 'online' },
            });
            transaction.appendSignificantFact({
                recordId: 'fractional-second',
                eventId: 'fractional-second-event',
                eventType: 'device.availability.changed',
                occurredAt: '2026-08-14T00:00:00.500Z',
                payload: { availability: 'offline' },
            });
            transaction.retireExpiredRecords({ asOf: '2026-09-13T00:00:00.500Z' });
        });

        expect(storage.listSignificantFacts()).toEqual([
            expect.objectContaining({ recordId: 'fractional-second' }),
        ]);
        storage.close();
    });

    it('retires expired accepted and quarantine records before an injected-time history read', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const asOf = '2026-09-01T00:00:00.000Z';

        try {
            storage.transact((transaction) => {
                transaction.appendSignificantFact({
                    recordId: 'expired-fact',
                    eventId: 'expired-fact-event',
                    eventType: 'device.availability.changed',
                    occurredAt: '2026-08-01T23:59:59.999Z',
                    payload: { availability: 'offline' },
                });
                transaction.appendSignificantFact({
                    recordId: 'boundary-fact',
                    eventId: 'boundary-fact-event',
                    eventType: 'device.availability.changed',
                    occurredAt: '2026-08-02T00:00:00.000Z',
                    payload: { availability: 'online' },
                });
                transaction.appendTelemetrySample({
                    recordId: 'expired-telemetry',
                    eventId: 'expired-telemetry-event',
                    deviceId: 'temp-desk',
                    metric: 'temperature',
                    value: 21,
                    unit: 'celsius',
                    occurredAt: '2026-08-01T23:59:59.999Z',
                    payload: { metric: 'temperature', value: 21, unit: 'celsius' },
                });
                transaction.appendTelemetrySample({
                    recordId: 'boundary-telemetry',
                    eventId: 'boundary-telemetry-event',
                    deviceId: 'temp-desk',
                    metric: 'temperature',
                    value: 22,
                    unit: 'celsius',
                    occurredAt: '2026-08-02T00:00:00.000Z',
                    payload: { metric: 'temperature', value: 22, unit: 'celsius' },
                });
                transaction.appendQuarantineEntry({
                    eventId: 'expired-quarantine-event',
                    reason: 'invalid_payload',
                    recordedAt: '2026-08-01T23:59:59.999Z',
                    rawEvent: { invalid: true },
                });
                transaction.appendQuarantineEntry({
                    eventId: 'boundary-quarantine-event',
                    reason: 'invalid_payload',
                    recordedAt: '2026-08-02T00:00:00.000Z',
                    rawEvent: { invalid: true },
                });
            });

            expect(storage.listSignificantFacts({ asOf })).toEqual([
                expect.objectContaining({ recordId: 'boundary-fact' }),
            ]);
            expect(
                storage.listTelemetrySamples({ deviceId: 'temp-desk', metric: 'temperature' }),
            ).toEqual([expect.objectContaining({ recordId: 'boundary-telemetry' })]);
            expect(storage.listQuarantineEntries()).toEqual([
                expect.objectContaining({ eventId: 'boundary-quarantine-event' }),
            ]);
        } finally {
            storage.close();
        }
    });

    it('immediately retires late accepted and quarantine records in their write transaction', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });

        const outcome = storage.transact((transaction) => {
            transaction.appendSignificantFact({
                recordId: 'late-fact',
                eventId: 'late-fact-event',
                eventType: 'device.availability.changed',
                occurredAt: '2026-08-01T23:59:59.999Z',
                payload: { availability: 'online' },
            });
            transaction.appendTelemetrySample({
                recordId: 'late-telemetry',
                eventId: 'late-telemetry-event',
                deviceId: 'temp-desk',
                metric: 'temperature',
                value: 22,
                unit: 'celsius',
                occurredAt: '2026-08-01T23:59:59.999Z',
                payload: { metric: 'temperature', value: 22, unit: 'celsius' },
            });
            transaction.appendQuarantineEntry({
                eventId: 'late-quarantine-event',
                reason: 'invalid_payload',
                recordedAt: '2026-08-01T23:59:59.999Z',
                rawEvent: { invalid: true },
            });

            transaction.retireExpiredRecords({ asOf: '2026-09-01T00:00:00.000Z' });
        });

        expect(outcome.status).toBe('committed');
        expect(storage.listSignificantFacts()).toEqual([]);
        expect(
            storage.listTelemetrySamples({ deviceId: 'temp-desk', metric: 'temperature' }),
        ).toEqual([]);
        expect(storage.listQuarantineEntries()).toEqual([]);
        storage.close();
    });

    it('enforces independent count caps with deterministic equal-timestamp tie breakers', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const timestamp = '2026-08-15T00:00:00.000Z';

        try {
            const outcome = storage.transact((transaction) => {
                for (let index = 0; index <= 5_000; index += 1) {
                    transaction.appendSignificantFact({
                        recordId: `count-fact-${index}`,
                        eventId: `count-fact-event-${index}`,
                        eventType: 'device.availability.changed',
                        occurredAt: timestamp,
                        payload: { availability: 'online' },
                    });
                }

                transaction.appendTelemetrySample({
                    recordId: 'count-telemetry-device-b',
                    eventId: 'count-telemetry-device-b-event',
                    deviceId: 'temp-b',
                    metric: 'temperature',
                    value: 20,
                    unit: 'celsius',
                    occurredAt: timestamp,
                    payload: { metric: 'temperature', value: 20, unit: 'celsius' },
                });

                for (let index = 0; index <= 10_000; index += 1) {
                    transaction.appendTelemetrySample({
                        recordId: `count-telemetry-device-a-${index}`,
                        eventId: `count-telemetry-device-a-event-${index}`,
                        deviceId: 'temp-a',
                        metric: 'temperature',
                        value: index,
                        unit: 'celsius',
                        occurredAt: timestamp,
                        payload: { metric: 'temperature', value: index, unit: 'celsius' },
                    });
                }

                for (let index = 0; index <= 1_000; index += 1) {
                    transaction.appendQuarantineEntry({
                        eventId: `count-quarantine-event-${index}`,
                        reason: 'invalid_payload',
                        recordedAt: timestamp,
                        rawEvent: { index },
                    });
                }

                transaction.retireExpiredRecords({ asOf: '2026-09-01T00:00:00.000Z' });
            });

            expect(outcome.status).toBe('committed');

            const facts = storage.listSignificantFacts();
            expect(facts).toHaveLength(5_000);
            expect(facts.at(0)).toMatchObject({ recordId: 'count-fact-1' });
            expect(facts.at(-1)).toMatchObject({ recordId: 'count-fact-5000' });

            const telemetryForDeviceA = storage.listTelemetrySamples({
                deviceId: 'temp-a',
                metric: 'temperature',
            });
            expect(telemetryForDeviceA).toHaveLength(10_000);
            expect(telemetryForDeviceA.at(0)).toMatchObject({
                recordId: 'count-telemetry-device-a-1',
            });
            expect(telemetryForDeviceA.at(-1)).toMatchObject({
                recordId: 'count-telemetry-device-a-10000',
            });
            expect(
                storage.listTelemetrySamples({ deviceId: 'temp-b', metric: 'temperature' }),
            ).toEqual([expect.objectContaining({ recordId: 'count-telemetry-device-b' })]);

            const quarantine = storage.listQuarantineEntries();
            expect(quarantine).toHaveLength(1_000);
            expect(quarantine.at(0)).toMatchObject({ eventId: 'count-quarantine-event-1' });
            expect(quarantine.at(-1)).toMatchObject({ eventId: 'count-quarantine-event-1000' });
        } finally {
            storage.close();
        }
    });

    it('removes an accepted identity only after its final active record is retired', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const eventId = 'identity-retention-event';
        const fingerprint = 'fp:v1:sha256:identity-retention';

        const firstOutcome = storage.transact((transaction) => {
            transaction.appendSignificantFact({
                recordId: 'identity-fact',
                eventId,
                eventType: 'device.availability.changed',
                occurredAt: '2026-08-01T00:00:00.000Z',
                payload: { availability: 'online' },
            });
            transaction.appendTelemetrySample({
                recordId: 'identity-telemetry',
                eventId,
                deviceId: 'temp-desk',
                metric: 'temperature',
                value: 22,
                unit: 'celsius',
                occurredAt: '2026-08-15T00:00:00.000Z',
                payload: { metric: 'temperature', value: 22, unit: 'celsius' },
            });
            transaction.upsertAcceptedInputIdentity({
                eventId,
                fingerprint,
                durability: 'durable',
                acceptedAt: '2026-08-15T00:00:00.000Z',
            });

            return transaction.retireExpiredRecords({ asOf: '2026-09-01T00:00:00.000Z' });
        });

        expect(firstOutcome).toMatchObject({ status: 'committed', value: [] });
        expect(storage.listAcceptedInputIdentities()).toEqual([
            expect.objectContaining({ eventId, fingerprint }),
        ]);
        expect(storage.isAcceptedInputIdentityActive(eventId, '2026-09-01T00:00:00.000Z')).toBe(
            true,
        );

        const secondOutcome = storage.transact((transaction) =>
            transaction.retireExpiredRecords({ asOf: '2026-09-15T00:00:00.000Z' }),
        );

        expect(secondOutcome).toMatchObject({ status: 'committed', value: [eventId] });
        expect(storage.listAcceptedInputIdentities()).toEqual([]);
        expect(storage.isAcceptedInputIdentityActive(eventId, '2026-09-15T00:00:00.000Z')).toBe(
            false,
        );
        storage.close();
    });

    it('uses active-retention indexes for the write-side ordering keys', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        const plans = [
            database
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT storage_sequence FROM significant_facts
                     WHERE retired_at IS NULL
                     ORDER BY occurred_at DESC, storage_sequence DESC`,
                )
                .all(),
            database
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT storage_sequence FROM telemetry_samples
                     WHERE retired_at IS NULL AND device_id = ?
                     ORDER BY occurred_at DESC, storage_sequence DESC`,
                )
                .all('temp-desk'),
            database
                .prepare(
                    `EXPLAIN QUERY PLAN
                     SELECT internal_sequence FROM quarantine_entries
                     WHERE retired_at IS NULL
                     ORDER BY recorded_at DESC, internal_sequence DESC`,
                )
                .all(),
        ];
        database.close();

        expect(plans.map((plan) => JSON.stringify(plan)).join(' ')).toContain(
            'significant_facts_active_by_time',
        );
        expect(plans.map((plan) => JSON.stringify(plan)).join(' ')).toContain(
            'telemetry_samples_active_by_device_time',
        );
        expect(plans.map((plan) => JSON.stringify(plan)).join(' ')).toContain(
            'quarantine_entries_active_by_time',
        );
    });

    it('keeps volatile guards in the latest typed checkpoint', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const guard = {
            eventId: 'volatile-event-1',
            fingerprint: 'fp:v1:sha256:guard',
            durability: 'volatile' as const,
            acceptedAt: '2026-08-14T10:00:00.000Z',
        };

        const outcome = storage.transact((transaction) => {
            transaction.saveLatestRoomProjection({
                updatedAt: '2026-08-14T10:00:01.000Z',
                projection: emptyRoomProjection('2026-08-14T10:00:01.000Z'),
                projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                volatileGuards: [guard],
                recentEvents: [],
            });
        });

        expect(outcome.status).toBe('committed');

        expect(storage.getLatestRoomProjection()).toEqual({
            updatedAt: '2026-08-14T10:00:01.000Z',
            projection: emptyRoomProjection('2026-08-14T10:00:01.000Z'),
            projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
            volatileGuards: [guard],
            recentEvents: [],
        });
        storage.close();

        const database = new DatabaseSync(databasePath, { readOnly: true });
        const row = database
            .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
            .get() as { projection_json: string };
        database.close();

        expect(JSON.parse(row.projection_json)).toMatchObject({ checkpointVersion: 4 });
    });

    it('migrates a known version 0 checkpoint and remains idempotent on reopen', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        database
            .prepare(
                `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                 VALUES (1, ?, ?)`,
            )
            .run('2026-08-14T10:00:01.000Z', JSON.stringify(legacyCheckpoint()));
        database.close();

        const migrated = createSqliteRoomStorage({ databasePath });

        expect(migrated.getLatestRoomProjection()).toMatchObject({
            projection: {
                activeCommands: [],
                devices: [expect.not.objectContaining({ activeCommandId: expect.anything() })],
                recentCommands: [
                    expect.objectContaining({
                        status: 'confirmed',
                        delivery: {
                            status: 'handed_off',
                            dispatchedAt: '2026-08-14T10:00:00.000Z',
                            deadlineAt: '2026-08-14T10:00:05.000Z',
                        },
                    }),
                ],
            },
        });
        migrated.close();

        const migratedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const afterFirstOpen = (
            migratedDatabase
                .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
                .get() as { projection_json: string }
        ).projection_json;
        migratedDatabase.close();

        const reopened = createSqliteRoomStorage({ databasePath });
        reopened.close();

        const reopenedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const afterSecondOpen = (
            reopenedDatabase
                .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
                .get() as { projection_json: string }
        ).projection_json;
        reopenedDatabase.close();

        expect(JSON.parse(afterFirstOpen)).toMatchObject({ checkpointVersion: 4 });
        expect(afterSecondOpen).toBe(afterFirstOpen);
    });

    it('repairs a version 1 checkpoint with a terminal command linked as active', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        database
            .prepare(
                `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                 VALUES (1, ?, ?)`,
            )
            .run('2026-08-14T10:00:01.000Z', JSON.stringify(versionOneCheckpoint()));
        database.close();

        const migrated = createSqliteRoomStorage({ databasePath });

        expect(migrated.getLatestRoomProjection()).toMatchObject({
            projection: {
                activeCommands: [],
                devices: [expect.not.objectContaining({ activeCommandId: expect.anything() })],
                recentCommands: [expect.objectContaining({ status: 'confirmed' })],
            },
        });
        migrated.close();

        const migratedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const migratedCheckpoint = JSON.parse(
            (
                migratedDatabase
                    .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
                    .get() as { projection_json: string }
            ).projection_json,
        );
        migratedDatabase.close();

        expect(migratedCheckpoint).toMatchObject({ checkpointVersion: 4 });
    });

    it('migrates a version 3 checkpoint to canonical recent-command ordering', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const prior = versionOneCheckpoint();
        const sourceCommand = prior.projection.recentCommands[0];
        const sourceDevice = prior.projection.devices[0];

        if (!sourceCommand || !sourceDevice) {
            throw new Error('Expected version 1 checkpoint fixtures.');
        }

        const { activeCommandId, ...device } = sourceDevice;
        void activeCommandId;
        const checkpoint = {
            ...prior,
            checkpointVersion: 3,
            projection: {
                ...prior.projection,
                devices: [device],
                recentCommands: [
                    { ...sourceCommand, commandId: 'cmd-a' },
                    { ...sourceCommand, commandId: 'cmd-z' },
                ],
            },
            recentEvents: [],
        };
        const database = new DatabaseSync(databasePath);
        database
            .prepare(
                `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                 VALUES (1, ?, ?)`,
            )
            .run('2026-08-14T10:00:01.000Z', JSON.stringify(checkpoint));
        database.close();

        const migrated = createSqliteRoomStorage({ databasePath });
        expect(migrated.getLatestRoomProjection()?.projection).toMatchObject({
            recentCommands: [{ commandId: 'cmd-z' }, { commandId: 'cmd-a' }],
        });
        migrated.close();

        const migratedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const afterFirstOpen = (
            migratedDatabase
                .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
                .get() as { projection_json: string }
        ).projection_json;
        migratedDatabase.close();

        const reopened = createSqliteRoomStorage({ databasePath });
        reopened.close();
        const reopenedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const afterSecondOpen = (
            reopenedDatabase
                .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
                .get() as { projection_json: string }
        ).projection_json;
        reopenedDatabase.close();

        expect(JSON.parse(afterFirstOpen)).toMatchObject({ checkpointVersion: 4 });
        expect(afterSecondOpen).toBe(afterFirstOpen);
    });

    it('canonicalizes recent commands when saving the current checkpoint format', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const prior = versionOneCheckpoint();
        const sourceCommand = prior.projection.recentCommands[0];
        const sourceDevice = prior.projection.devices[0];

        if (!sourceCommand || !sourceDevice) {
            throw new Error('Expected version 1 checkpoint fixtures.');
        }

        const { activeCommandId, ...device } = sourceDevice;
        void activeCommandId;
        storage.transact((transaction) => {
            transaction.saveLatestRoomProjection({
                updatedAt: prior.projection.updatedAt,
                projection: {
                    ...prior.projection,
                    devices: [device],
                    recentCommands: [
                        { ...sourceCommand, commandId: 'cmd-a' },
                        { ...sourceCommand, commandId: 'cmd-z' },
                    ],
                },
                projectionEvidence: prior.projectionEvidence,
                volatileGuards: [],
                recentEvents: [],
            });
        });

        expect(storage.getLatestRoomProjection()?.projection).toMatchObject({
            recentCommands: [{ commandId: 'cmd-z' }, { commandId: 'cmd-a' }],
        });
        storage.close();
    });

    it('preserves command and event caches when history retention retires their records', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const prior = versionOneCheckpoint();
        const sourceCommand = prior.projection.recentCommands[0];
        const sourceDevice = prior.projection.devices[0];

        if (!sourceCommand || !sourceDevice) {
            throw new Error('Expected version 1 checkpoint fixtures.');
        }

        const { activeCommandId, ...device } = sourceDevice;
        void activeCommandId;
        const projection = {
            ...prior.projection,
            devices: [device],
            recentCommands: [{ ...sourceCommand, commandId: 'cmd-retained' }],
        };
        const recentEvents = [
            {
                recordId: `rec:v1:sha256:${'3'.repeat(64)}`,
                eventType: 'storage.gap.recorded' as const,
                occurredAt: '2026-08-01T00:00:00.000Z',
                durability: 'durable' as const,
                storageSequence: 1,
                source: 'backend' as const,
                payload: {
                    outageStartedAt: '2026-08-01T00:00:00.000Z',
                    outageEndedAt: '2026-08-01T00:00:00.000Z',
                    failureReason: 'storage_write_failed',
                    boundaryBasis: 'same_process_first_degraded_at' as const,
                    observationsBackfilled: false as const,
                },
            },
        ];

        storage.transact((transaction) => {
            transaction.appendSignificantFact({
                recordId: 'retained-cache-history-record',
                eventId: 'retained-cache-history-event',
                eventType: 'device.availability.changed',
                occurredAt: '2026-08-01T00:00:00.000Z',
                payload: { availability: 'online' },
            });
            transaction.saveLatestRoomProjection({
                updatedAt: projection.updatedAt,
                projection,
                projectionEvidence: { availabilityDeviceIds: ['led-main'], healthDeviceIds: [] },
                volatileGuards: [],
                recentEvents,
            });
        });

        const checkpointBeforeRetirement = storage.getLatestRoomProjection();
        storage.transact((transaction) =>
            transaction.retireExpiredRecords({ asOf: '2026-09-01T00:00:00.000Z' }),
        );

        expect(storage.listSignificantFacts()).toEqual([]);
        expect(storage.getLatestRoomProjection()).toEqual(checkpointBeforeRetirement);
        storage.close();
    });

    it('rejects an unknown or malformed checkpoint version without rewriting it', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        const malformedCheckpoint = JSON.stringify({
            roomName: 'Legacy Room',
            devices: [{ deviceId: 'online-device', availability: 'online', health: 'unknown' }],
        });
        database
            .prepare(
                `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                 VALUES (1, ?, ?)`,
            )
            .run('2026-08-14T10:00:01.000Z', malformedCheckpoint);
        database.close();

        expect(() => createSqliteRoomStorage({ databasePath })).toThrow(StorageMigrationError);

        const afterMalformedOpen = new DatabaseSync(databasePath, { readOnly: true });
        const malformedStoredValue = (
            afterMalformedOpen
                .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
                .get() as { projection_json: string }
        ).projection_json;
        afterMalformedOpen.close();

        expect(malformedStoredValue).toBe(malformedCheckpoint);

        const futureDatabase = new DatabaseSync(databasePath);
        futureDatabase
            .prepare('UPDATE latest_room_projection SET projection_json = ? WHERE id = 1')
            .run(JSON.stringify({ ...legacyCheckpoint(), checkpointVersion: 5 }));
        futureDatabase.close();

        expect(() => createSqliteRoomStorage({ databasePath })).toThrow(StorageMigrationError);
    });

    it('rejects a malformed current-version checkpoint during an existing-generation probe', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const seed = storage.transact((transaction) => {
            transaction.saveLatestRoomProjection({
                updatedAt: '2026-09-03T08:00:00.000Z',
                projection: emptyRoomProjection('2026-09-03T08:00:00.000Z'),
                projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                volatileGuards: [],
                recentEvents: [],
            });
        });
        expect(seed.status).toBe('committed');
        storage.close();
        const database = new DatabaseSync(databasePath);
        database.prepare('UPDATE latest_room_projection SET projection_json = ? WHERE id = 1').run(
            JSON.stringify({
                checkpointVersion: 4,
                projection: null,
                projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                volatileGuards: [],
                recentEvents: [],
            }),
        );
        database.close();
        const lifecycle = createSqliteRoomStorageLifecycle({ databasePath, ensureDirectory() {} });

        expect(() => lifecycle.probe({ verifiedHistoryGenerationId: undefined })).toThrow(
            StorageSchemaError,
        );
    });

    it('rejects semantically invalid recent-event checkpoint caches during recovery probes', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const duplicateGap = {
            recordId: `rec:v1:sha256:${'4'.repeat(64)}`,
            eventType: 'storage.gap.recorded' as const,
            occurredAt: '2026-09-03T08:00:00.000Z',
            durability: 'durable' as const,
            storageSequence: 1,
            source: 'backend' as const,
            payload: {
                outageStartedAt: '2026-09-03T07:00:00.000Z',
                outageEndedAt: '2026-09-03T08:00:00.000Z',
                failureReason: 'storage_write_failed',
                boundaryBasis: 'same_process_first_degraded_at' as const,
                observationsBackfilled: false as const,
            },
        };
        const seed = storage.transact((transaction) => {
            transaction.saveLatestRoomProjection({
                updatedAt: duplicateGap.occurredAt,
                projection: emptyRoomProjection(duplicateGap.occurredAt),
                projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                volatileGuards: [],
                recentEvents: [],
            });
        });
        expect(seed.status).toBe('committed');
        storage.close();

        const database = new DatabaseSync(databasePath);
        database.prepare('UPDATE latest_room_projection SET projection_json = ? WHERE id = 1').run(
            JSON.stringify({
                checkpointVersion: 4,
                projection: emptyRoomProjection(duplicateGap.occurredAt),
                projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                volatileGuards: [],
                recentEvents: [duplicateGap, duplicateGap],
            }),
        );
        database.close();
        const lifecycle = createSqliteRoomStorageLifecycle({ databasePath, ensureDirectory() {} });

        expect(() => lifecycle.probe({ verifiedHistoryGenerationId: undefined })).toThrow(
            StorageSchemaError,
        );

        const laterGap = {
            ...duplicateGap,
            recordId: `rec:v1:sha256:${'5'.repeat(64)}`,
            occurredAt: '2026-09-03T09:00:00.000Z',
            storageSequence: 2,
            payload: {
                ...duplicateGap.payload,
                outageEndedAt: '2026-09-03T09:00:00.000Z',
            },
        };
        const reorderedDatabase = new DatabaseSync(databasePath);
        reorderedDatabase
            .prepare('UPDATE latest_room_projection SET projection_json = ? WHERE id = 1')
            .run(
                JSON.stringify({
                    checkpointVersion: 4,
                    projection: emptyRoomProjection(duplicateGap.occurredAt),
                    projectionEvidence: { availabilityDeviceIds: [], healthDeviceIds: [] },
                    volatileGuards: [],
                    recentEvents: [duplicateGap, laterGap],
                }),
            );
        reorderedDatabase.close();

        expect(() => lifecycle.probe({ verifiedHistoryGenerationId: undefined })).toThrow(
            StorageSchemaError,
        );
    });

    it('rejects a semantically invalid version 0 checkpoint before rewriting it', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const invalidCheckpoint = JSON.stringify({
            ...legacyCheckpoint(),
            projectionEvidence: {
                availabilityDeviceIds: ['led-main'],
                healthDeviceIds: 'not-an-array',
            },
        });
        const database = new DatabaseSync(databasePath);
        database
            .prepare(
                `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                 VALUES (1, ?, ?)`,
            )
            .run('2026-08-14T10:00:01.000Z', invalidCheckpoint);
        database.close();

        expect(() => createSqliteRoomStorage({ databasePath })).toThrow(StorageMigrationError);

        const reopenedDatabase = new DatabaseSync(databasePath, { readOnly: true });
        const storedValue = (
            reopenedDatabase
                .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
                .get() as { projection_json: string }
        ).projection_json;
        reopenedDatabase.close();

        expect(storedValue).toBe(invalidCheckpoint);
    });

    it('classifies a COMMIT error as indeterminate even after cleanup succeeds', () => {
        let transactionOpen = false;
        const executed: string[] = [];
        const database = {
            get isTransaction() {
                return transactionOpen;
            },
            exec(statement: string) {
                executed.push(statement);

                if (statement === 'BEGIN IMMEDIATE') {
                    transactionOpen = true;

                    return;
                }

                if (statement === 'COMMIT') {
                    throw Object.assign(new Error('commit failed'), { errcode: 5 });
                }

                if (statement === 'ROLLBACK') {
                    transactionOpen = false;
                }
            },
        };

        expect(executeStorageTransaction(database as never, () => 'value')).toMatchObject({
            status: 'indeterminate',
        });
        expect(executed).toEqual(['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK']);
    });

    it('rolls back a BEGIN error that leaves a transaction active before allowing fallback', () => {
        let transactionOpen = false;
        const executed: string[] = [];
        const database = {
            get isTransaction() {
                return transactionOpen;
            },
            exec(statement: string) {
                executed.push(statement);

                if (statement === 'BEGIN IMMEDIATE') {
                    transactionOpen = true;

                    throw Object.assign(new Error('begin failed'), { errcode: 5 });
                }

                if (statement === 'ROLLBACK') {
                    transactionOpen = false;
                }
            },
        };

        expect(executeStorageTransaction(database as never, () => 'value')).toMatchObject({
            status: 'confirmed_rolled_back',
        });
        expect(executed).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK']);
    });

    it('treats a rollback that leaves the transaction active as indeterminate', () => {
        let transactionOpen = false;
        const database = {
            get isTransaction() {
                return transactionOpen;
            },
            exec(statement: string) {
                if (statement === 'BEGIN IMMEDIATE') {
                    transactionOpen = true;

                    return;
                }

                if (statement === 'ROLLBACK') {
                    return;
                }
            },
        };

        expect(
            executeStorageTransaction(database as never, () => {
                throw new Error('operation failed');
            }),
        ).toMatchObject({ status: 'indeterminate' });
    });

    it('uses the telemetry history index and binds device identifiers as parameters', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const quotedDeviceId = "temp'; DROP TABLE telemetry_samples; --";

        const outcome = storage.transact((transaction) => {
            transaction.appendTelemetrySample({
                recordId: 'telemetry-quoted',
                deviceId: quotedDeviceId,
                metric: 'temperature',
                value: 21,
                unit: 'celsius',
                occurredAt: '2026-08-14T10:00:00.000Z',
                payload: { value: 21 },
            });
            transaction.appendTelemetrySample({
                recordId: 'telemetry-other',
                deviceId: 'temp-other',
                metric: 'temperature',
                value: 20,
                unit: 'celsius',
                occurredAt: '2026-08-14T10:00:01.000Z',
                payload: { value: 20 },
            });
        });

        expect(outcome.status).toBe('committed');

        expect(
            storage.listTelemetrySamples({ deviceId: quotedDeviceId, metric: 'temperature' }),
        ).toMatchObject([{ recordId: 'telemetry-quoted', deviceId: quotedDeviceId }]);
        storage.close();

        const database = new DatabaseSync(databasePath);
        const plan = database
            .prepare(
                `EXPLAIN QUERY PLAN
                 SELECT storage_sequence FROM telemetry_samples
                 WHERE device_id = ? AND metric = ? AND occurred_at >= ?
                 ORDER BY occurred_at ASC, storage_sequence ASC`,
            )
            .all(quotedDeviceId, 'temperature', '2026-08-14T00:00:00.000Z') as { detail: string }[];
        database.close();

        expect(plan.map((row) => row.detail).join(' ')).toContain(
            'telemetry_samples_by_device_metric_time',
        );
    });

    it('rejects checksum drift and newer schema versions as fatal schema errors', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        database
            .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
            .run('changed');
        database.close();

        expect(() => createSqliteRoomStorage({ databasePath })).toThrow(StorageSchemaError);

        const newerDatabasePath = temporaryDatabasePath();
        const newerStorage = createSqliteRoomStorage({ databasePath: newerDatabasePath });
        newerStorage.close();
        const newerDatabase = new DatabaseSync(newerDatabasePath);
        newerDatabase
            .prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (6, ?, ?)')
            .run('future', 'future');
        newerDatabase.close();

        expect(() => createSqliteRoomStorage({ databasePath: newerDatabasePath })).toThrow(
            StorageSchemaError,
        );
    });

    it('rejects a missing or structurally altered table or index before returning a storage port', () => {
        const missingTablePath = temporaryDatabasePath();
        const missingTableStorage = createSqliteRoomStorage({ databasePath: missingTablePath });
        missingTableStorage.close();
        const missingTableDatabase = new DatabaseSync(missingTablePath);
        missingTableDatabase.exec('DROP TABLE telemetry_samples');
        missingTableDatabase.close();

        expect(() => createSqliteRoomStorage({ databasePath: missingTablePath })).toThrow(
            StorageSchemaError,
        );

        const missingIndexPath = temporaryDatabasePath();
        const missingIndexStorage = createSqliteRoomStorage({ databasePath: missingIndexPath });
        missingIndexStorage.close();
        const missingIndexDatabase = new DatabaseSync(missingIndexPath);
        missingIndexDatabase.exec('DROP INDEX telemetry_samples_by_device_metric_time');
        missingIndexDatabase.close();

        expect(() => createSqliteRoomStorage({ databasePath: missingIndexPath })).toThrow(
            StorageSchemaError,
        );

        const alteredTablePath = temporaryDatabasePath();
        const alteredTableStorage = createSqliteRoomStorage({ databasePath: alteredTablePath });
        alteredTableStorage.close();
        const alteredTableDatabase = new DatabaseSync(alteredTablePath);
        alteredTableDatabase.exec(`
            DROP TABLE accepted_input_identities;
            CREATE TABLE accepted_input_identities (
                event_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                durability TEXT NOT NULL CHECK (durability IN ('durable', 'volatile')),
                accepted_at TEXT NOT NULL
            ) STRICT;
            CREATE INDEX accepted_input_identities_by_accepted_at
                ON accepted_input_identities (accepted_at, event_id);
        `);
        alteredTableDatabase.close();

        expect(() => createSqliteRoomStorage({ databasePath: alteredTablePath })).toThrow(
            StorageSchemaError,
        );

        const alteredIndexPath = temporaryDatabasePath();
        const alteredIndexStorage = createSqliteRoomStorage({ databasePath: alteredIndexPath });
        alteredIndexStorage.close();
        const alteredIndexDatabase = new DatabaseSync(alteredIndexPath);
        alteredIndexDatabase.exec(`
            DROP INDEX significant_facts_active_by_time;
            CREATE INDEX significant_facts_active_by_time
                ON significant_facts (occurred_at DESC, storage_sequence DESC);
        `);
        alteredIndexDatabase.close();

        expect(() => createSqliteRoomStorage({ databasePath: alteredIndexPath })).toThrow(
            StorageSchemaError,
        );
    });

    it('classifies native SQLite availability and manual-intervention failures', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const lockHolder = new DatabaseSync(databasePath);
        lockHolder.exec('PRAGMA busy_timeout = 0');
        lockHolder.exec('BEGIN EXCLUSIVE');

        try {
            expect(
                storage.transact((transaction) =>
                    transaction.appendTelemetrySample({
                        recordId: 'blocked-sample',
                        deviceId: 'temp-desk',
                        metric: 'temperature',
                        value: 20,
                        unit: 'celsius',
                        occurredAt: '2026-08-14T10:00:00.000Z',
                        payload: { value: 20 },
                    }),
                ),
            ).toMatchObject({
                status: 'confirmed_rolled_back',
                error: expect.any(StorageAvailabilityError),
            });
        } finally {
            lockHolder.exec('ROLLBACK');
            lockHolder.close();
            storage.close();
        }

        const invalidDatabasePath = temporaryDatabasePath();
        writeFileSync(invalidDatabasePath, 'not a SQLite database');

        expect(() => createSqliteRoomStorage({ databasePath: invalidDatabasePath })).toThrow(
            StorageManualInterventionError,
        );
        expect(() =>
            renameSync(invalidDatabasePath, `${invalidDatabasePath}.preserved`),
        ).not.toThrow();
    });

    it('keeps migration, schema and invariant failures out of availability classification', () => {
        expect(classifySqliteError({ code: 'ERR_SQLITE_ERROR', errcode: 5 }).kind).toBe(
            'availability',
        );
        expect(classifySqliteError({ code: 'ERR_SQLITE_ERROR', errcode: 26 }).kind).toBe(
            'manual_intervention',
        );
        expect(classifySqliteError({ code: 'EACCES' }).kind).toBe('availability');
        expect(classifySqliteError({ code: 'EROFS' }).kind).toBe('availability');
        expect(classifySqliteError({ code: 'ENOSPC' }).kind).toBe('availability');
        expect(
            classifySqliteError(new StorageMigrationError('failed migration', undefined)),
        ).toMatchObject({
            kind: 'fatal',
            category: 'migration',
        });
        expect(classifySqliteError(new StorageSchemaError('bad schema', undefined))).toMatchObject({
            kind: 'fatal',
            category: 'schema',
        });
        expect(
            classifySqliteError(new StorageInvariantError('bad invariant', undefined)),
        ).toMatchObject({
            kind: 'fatal',
            category: 'invariant',
        });
    });
});

function temporaryDatabasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-storage-'));
    temporaryDirectories.push(directory);

    return join(directory, 'room.sqlite');
}

function emptyRoomProjection(updatedAt: string) {
    return { updatedAt, devices: [], activeCommands: [], recentCommands: [] };
}

function legacyCheckpoint() {
    return {
        projection: {
            updatedAt: '2026-08-14T10:00:01.000Z',
            devices: [
                {
                    deviceId: 'led-main',
                    name: 'Main LED',
                    role: 'led-output',
                    availability: 'online',
                    availabilityChangedAt: '2026-08-14T10:00:00.000Z',
                    availabilityDurability: 'durable',
                    health: 'healthy',
                    healthChangedAt: '2026-08-14T10:00:00.000Z',
                    healthDurability: 'durable',
                    reportedState: { power: 'on' },
                    observationStatus: {
                        power: {
                            freshness: 'fresh',
                            lastObservedAt: '2026-08-14T10:00:00.000Z',
                            durability: 'durable',
                        },
                    },
                    commandAvailability: { policy: 'allow' },
                    activeCommandId: 'command-1',
                },
            ],
            activeCommands: [],
            recentCommands: [
                {
                    commandId: 'command-1',
                    deviceId: 'led-main',
                    commandType: 'set.power',
                    requestedState: { power: 'on' },
                    requestedAt: '2026-08-14T10:00:00.000Z',
                    durability: 'durable',
                    lifecycleDurability: 'durable',
                    status: 'confirmed',
                    dispatchedAt: '2026-08-14T10:00:00.000Z',
                    deadlineAt: '2026-08-14T10:00:05.000Z',
                    confirmedAt: '2026-08-14T10:00:01.000Z',
                },
            ],
        },
        projectionEvidence: { availabilityDeviceIds: ['led-main'], healthDeviceIds: [] },
        volatileGuards: [],
    };
}

function versionOneCheckpoint() {
    const checkpoint = legacyCheckpoint();
    const command = checkpoint.projection.recentCommands[0];

    if (!command) {
        throw new Error('Expected a legacy terminal command.');
    }

    const { dispatchedAt, deadlineAt, ...commandWithoutLegacyDelivery } = command;

    return {
        ...checkpoint,
        checkpointVersion: 1,
        projection: {
            ...checkpoint.projection,
            recentCommands: [
                {
                    ...commandWithoutLegacyDelivery,
                    delivery: { status: 'handed_off' as const, dispatchedAt, deadlineAt },
                },
            ],
        },
    };
}
