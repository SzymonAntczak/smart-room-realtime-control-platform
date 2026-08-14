import { randomUUID } from 'node:crypto';
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { roomStorageMigrations } from './sqlite-migrations';
import { createSqliteRoomStorage } from './sqlite-room-storage';
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
            schemaVersion: 2,
            lastStorageSequence: 0,
        });
        expect(reopened.getMetadata()).toEqual(initialMetadata);
        reopened.close();
    });

    it('migrates a database stopped at the previous supported migration', () => {
        const databasePath = temporaryDatabasePath();
        const historyGenerationId = randomUUID();
        createVersionOneDatabase(databasePath, historyGenerationId);

        const storage = createSqliteRoomStorage({ databasePath });
        const metadata = storage.getMetadata();
        storage.close();
        const database = new DatabaseSync(databasePath);
        const index = database
            .prepare("SELECT name FROM pragma_index_list('telemetry_samples') WHERE name = ?")
            .get('telemetry_samples_by_device_metric_time');
        database.close();

        expect(metadata).toEqual({
            historyGenerationId,
            schemaVersion: 2,
            lastStorageSequence: 0,
        });
        expect(index).toEqual({ name: 'telemetry_samples_by_device_metric_time' });
    });

    it('stores and reads every Stage 4 storage category through the port', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const fact = storage.appendSignificantFact({
            recordId: 'fact-1',
            eventId: 'event-fact-1',
            eventType: 'device.availability.changed',
            deviceId: 'led-main',
            source: 'simulator-adapter',
            occurredAt: '2026-08-14T10:00:00.000Z',
            payload: { availability: 'online' },
        });
        const telemetry = storage.appendTelemetrySample({
            recordId: 'telemetry-1',
            eventId: 'event-telemetry-1',
            deviceId: 'temp-desk',
            metric: 'temperature',
            value: 22.5,
            unit: 'celsius',
            occurredAt: '2026-08-14T10:00:01.000Z',
            payload: { value: 22.5, unit: 'celsius' },
        });
        const quarantine = storage.appendQuarantineEntry({
            eventId: 'event-invalid-1',
            reason: 'invalid_payload',
            recordedAt: '2026-08-14T10:00:02.000Z',
            rawEvent: { malformed: true },
        });
        const receipt = {
            source: 'simulator-led',
            commandId: 'command-1',
            updatedAt: '2026-08-14T10:00:03.000Z',
            receipt: { scenario: 'confirm_delayed', dueAt: '2026-08-14T10:00:05.000Z' },
        };
        const projection = {
            updatedAt: '2026-08-14T10:00:04.000Z',
            projection: { roomName: 'Smart Room', devices: [] },
        };

        storage.upsertSimulatorCommandReceipt(receipt);
        storage.saveLatestRoomProjection(projection);

        expect(fact.storageSequence).toBe(1);
        expect(telemetry.storageSequence).toBe(2);
        expect(storage.getMetadata().lastStorageSequence).toBe(2);
        expect(storage.listSignificantFacts()).toEqual([fact]);
        expect(storage.listTelemetrySamples({ deviceId: 'temp-desk', metric: 'temperature' })).toEqual([
            telemetry,
        ]);
        expect(storage.listQuarantineEntries()).toEqual([quarantine]);
        expect(storage.getSimulatorCommandReceipt(receipt.source, receipt.commandId)).toEqual(receipt);
        expect(storage.getLatestRoomProjection()).toEqual(projection);
        storage.close();
    });

    it('uses the telemetry history index and binds device identifiers as parameters', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const quotedDeviceId = "temp'; DROP TABLE telemetry_samples; --";

        storage.appendTelemetrySample({
            recordId: 'telemetry-quoted',
            deviceId: quotedDeviceId,
            metric: 'temperature',
            value: 21,
            unit: 'celsius',
            occurredAt: '2026-08-14T10:00:00.000Z',
            payload: { value: 21 },
        });
        storage.appendTelemetrySample({
            recordId: 'telemetry-other',
            deviceId: 'temp-other',
            metric: 'temperature',
            value: 20,
            unit: 'celsius',
            occurredAt: '2026-08-14T10:00:01.000Z',
            payload: { value: 20 },
        });

        expect(storage.listTelemetrySamples({ deviceId: quotedDeviceId, metric: 'temperature' })).toMatchObject([
            { recordId: 'telemetry-quoted', deviceId: quotedDeviceId },
        ]);
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
        database.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 2').run('changed');
        database.close();

        expect(() => createSqliteRoomStorage({ databasePath })).toThrow(StorageSchemaError);

        const newerDatabasePath = temporaryDatabasePath();
        const newerStorage = createSqliteRoomStorage({ databasePath: newerDatabasePath });
        newerStorage.close();
        const newerDatabase = new DatabaseSync(newerDatabasePath);
        newerDatabase
            .prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (3, ?, ?)')
            .run('future', 'future');
        newerDatabase.close();

        expect(() => createSqliteRoomStorage({ databasePath: newerDatabasePath })).toThrow(
            StorageSchemaError,
        );
    });

    it('rejects a missing table or index before returning a storage port', () => {
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
    });

    it('classifies native SQLite availability and manual-intervention failures', () => {
        const databasePath = temporaryDatabasePath();
        const storage = createSqliteRoomStorage({ databasePath });
        const lockHolder = new DatabaseSync(databasePath);
        lockHolder.exec('PRAGMA busy_timeout = 0');
        lockHolder.exec('BEGIN EXCLUSIVE');

        try {
            expect(() =>
                storage.appendTelemetrySample({
                    recordId: 'blocked-sample',
                    deviceId: 'temp-desk',
                    metric: 'temperature',
                    value: 20,
                    unit: 'celsius',
                    occurredAt: '2026-08-14T10:00:00.000Z',
                    payload: { value: 20 },
                }),
            ).toThrow(StorageAvailabilityError);
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
        expect(() => renameSync(invalidDatabasePath, `${invalidDatabasePath}.preserved`)).not.toThrow();
    });

    it('keeps migration, schema and invariant failures out of availability classification', () => {
        expect(classifySqliteError({ code: 'ERR_SQLITE_ERROR', errcode: 5 }).kind).toBe('availability');
        expect(classifySqliteError({ code: 'ERR_SQLITE_ERROR', errcode: 26 }).kind).toBe(
            'manual_intervention',
        );
        expect(classifySqliteError(new StorageMigrationError('failed migration', undefined))).toMatchObject({
            kind: 'fatal',
            category: 'migration',
        });
        expect(classifySqliteError(new StorageSchemaError('bad schema', undefined))).toMatchObject({
            kind: 'fatal',
            category: 'schema',
        });
        expect(classifySqliteError(new StorageInvariantError('bad invariant', undefined))).toMatchObject({
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

function createVersionOneDatabase(databasePath: string, historyGenerationId: string): void {
    const migration = roomStorageMigrations[0];

    if (!migration) {
        throw new Error('Expected the first room storage migration.');
    }

    const database = new DatabaseSync(databasePath);
    database.exec(`
        CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL
        ) STRICT;
        BEGIN IMMEDIATE;
    `);
    migration.apply(database, historyGenerationId);
    database
        .prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, migration.checksum);
    database.exec('COMMIT');
    database.close();
}
