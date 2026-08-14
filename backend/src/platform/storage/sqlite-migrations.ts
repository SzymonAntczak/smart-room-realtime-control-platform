import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { StorageMigrationError, StorageSchemaError } from './storage-errors';

export interface Migration {
    version: number;
    name: string;
    checksum: string;
    apply(database: DatabaseSync, historyGenerationId: string): void;
}

const migrationOneSql = `
CREATE TABLE storage_metadata (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    history_generation_id TEXT NOT NULL,
    last_storage_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_storage_sequence >= 0)
) STRICT;
`;

const migrationTwoSql = `
CREATE TABLE significant_facts (
    storage_sequence INTEGER PRIMARY KEY,
    record_id TEXT NOT NULL,
    event_id TEXT,
    event_type TEXT NOT NULL,
    device_id TEXT,
    command_id TEXT,
    source TEXT,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
) STRICT;

CREATE TABLE telemetry_samples (
    storage_sequence INTEGER PRIMARY KEY,
    record_id TEXT NOT NULL,
    event_id TEXT,
    device_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
) STRICT;

CREATE INDEX telemetry_samples_by_device_metric_time
    ON telemetry_samples (device_id, metric, occurred_at, storage_sequence);

CREATE INDEX significant_facts_by_device_time
    ON significant_facts (device_id, occurred_at, storage_sequence);

CREATE TABLE quarantine_entries (
    internal_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT,
    reason TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    raw_event_json TEXT NOT NULL
) STRICT;

CREATE TABLE simulator_command_receipts (
    source TEXT NOT NULL,
    command_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    PRIMARY KEY (source, command_id)
) STRICT;

CREATE TABLE latest_room_projection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at TEXT NOT NULL,
    projection_json TEXT NOT NULL
) STRICT;
`;

export const roomStorageMigrations: readonly Migration[] = [
    {
        version: 1,
        name: 'storage-metadata',
        checksum: checksum(migrationOneSql),
        apply(database, historyGenerationId) {
            database.exec(migrationOneSql);
            database
                .prepare(
                    `INSERT INTO storage_metadata (id, history_generation_id, last_storage_sequence)
                     VALUES (1, ?, 0)`,
                )
                .run(historyGenerationId);
        },
    },
    {
        version: 2,
        name: 'storage-records-and-projection',
        checksum: checksum(migrationTwoSql),
        apply(database) {
            database.exec(migrationTwoSql);
        },
    },
];

export function migrateSqliteDatabase(
    database: DatabaseSync,
    historyGenerationId: string,
    migrations: readonly Migration[] = roomStorageMigrations,
): void {
    assertMigrationManifest(migrations);
    assertDatabaseCanBeMigrated(database);
    ensureMigrationHistory(database);

    const applied = readAppliedMigrations(database);
    validateAppliedMigrations(applied, migrations);

    for (const migration of migrations.slice(applied.length)) {
        applyMigration(database, migration, historyGenerationId);
    }
}

function assertMigrationManifest(migrations: readonly Migration[]): void {
    for (const [index, migration] of migrations.entries()) {
        if (migration.version !== index + 1) {
            throw new StorageMigrationError('Migration versions must be contiguous and start at 1.', migration);
        }
    }
}

function assertDatabaseCanBeMigrated(database: DatabaseSync): void {
    const historyExists = database
        .prepare(
            `SELECT 1 AS present
             FROM sqlite_schema
             WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get();

    if (historyExists) {
        return;
    }

    const userTable = database
        .prepare(
            `SELECT name
             FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
             LIMIT 1`,
        )
        .get() as { name: string } | undefined;

    if (userTable) {
        throw new StorageSchemaError(
            `Database has an unmanaged user table: ${userTable.name}.`,
            userTable,
        );
    }
}

function ensureMigrationHistory(database: DatabaseSync): void {
    database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            checksum TEXT NOT NULL
        ) STRICT;
    `);
}

function readAppliedMigrations(database: DatabaseSync): readonly {
    version: number;
    name: string;
    checksum: string;
}[] {
    return database
        .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC')
        .all() as { version: number; name: string; checksum: string }[];
}

function validateAppliedMigrations(
    applied: readonly { version: number; name: string; checksum: string }[],
    migrations: readonly Migration[],
): void {
    if (applied.length > migrations.length) {
        throw new StorageSchemaError('Database schema version is newer than this backend supports.', applied);
    }

    for (const [index, appliedMigration] of applied.entries()) {
        const expected = migrations[index];

        if (
            !expected ||
            appliedMigration.version !== expected.version ||
            appliedMigration.name !== expected.name ||
            appliedMigration.checksum !== expected.checksum
        ) {
            throw new StorageSchemaError('Applied migration does not match the deterministic manifest.', {
                appliedMigration,
                expected,
            });
        }
    }
}

function applyMigration(
    database: DatabaseSync,
    migration: Migration,
    historyGenerationId: string,
): void {
    try {
        database.exec('BEGIN IMMEDIATE');
        migration.apply(database, historyGenerationId);
        database
            .prepare('INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)')
            .run(migration.version, migration.name, migration.checksum);
        database.exec('COMMIT');
    } catch (error) {
        try {
            database.exec('ROLLBACK');
        } catch {
            // Migration errors are fatal even if rollback itself cannot be observed.
        }

        throw new StorageMigrationError(`Migration ${migration.version} (${migration.name}) failed.`, error);
    }
}

function checksum(sql: string): string {
    return createHash('sha256').update(sql).digest('hex');
}
