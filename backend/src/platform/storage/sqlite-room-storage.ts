import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type {
    LatestRoomProjectionInput,
    RoomStorage,
    SimulatorCommandReceiptInput,
    StorageMetadata,
    StoredQuarantineEntry,
    StoredSignificantFact,
    StoredTelemetrySample,
} from './room-storage';
import { migrateSqliteDatabase, roomStorageMigrations } from './sqlite-migrations';
import { classifySqliteError, StorageInvariantError, StorageSchemaError } from './storage-errors';

export interface SqliteRoomStorageConfig {
    databasePath: string;
    generateHistoryGenerationId?: () => string;
}

export function createSqliteRoomStorage({
    databasePath,
    generateHistoryGenerationId = randomUUID,
}: SqliteRoomStorageConfig): RoomStorage {
    const database = openDatabase(databasePath);
    let closed = false;

    try {
        migrateSqliteDatabase(database, generateHistoryGenerationId());
        validateExpectedSchema(database);
    } catch (error) {
        database.close();

        throw classifySqliteError(error);
    }

    return {
        getMetadata() {
            return run(() => readMetadata(database));
        },
        appendSignificantFact(input) {
            return run(() =>
                inTransaction(database, () => {
                    const storageSequence = allocateStorageSequence(database);
                    database
                        .prepare(
                            `INSERT INTO significant_facts (
                                storage_sequence, record_id, event_id, event_type, device_id, command_id,
                                source, occurred_at, payload_json
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        )
                        .run(
                            storageSequence,
                            input.recordId,
                            input.eventId ?? null,
                            input.eventType,
                            input.deviceId ?? null,
                            input.commandId ?? null,
                            input.source ?? null,
                            input.occurredAt,
                            stringifyJson(input.payload),
                        );

                    return { ...input, storageSequence } satisfies StoredSignificantFact;
                }),
            );
        },
        listSignificantFacts() {
            return run(() =>
                database
                    .prepare(
                        `SELECT storage_sequence, record_id, event_id, event_type, device_id, command_id,
                                source, occurred_at, payload_json
                         FROM significant_facts
                         ORDER BY storage_sequence ASC`,
                    )
                    .all()
                    .map(toStoredSignificantFact),
            );
        },
        appendTelemetrySample(input) {
            return run(() =>
                inTransaction(database, () => {
                    const storageSequence = allocateStorageSequence(database);
                    database
                        .prepare(
                            `INSERT INTO telemetry_samples (
                                storage_sequence, record_id, event_id, device_id, metric, value, unit,
                                occurred_at, payload_json
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        )
                        .run(
                            storageSequence,
                            input.recordId,
                            input.eventId ?? null,
                            input.deviceId,
                            input.metric,
                            input.value,
                            input.unit,
                            input.occurredAt,
                            stringifyJson(input.payload),
                        );

                    return { ...input, storageSequence } satisfies StoredTelemetrySample;
                }),
            );
        },
        listTelemetrySamples(query) {
            return run(() => {
                const clauses = ['device_id = ?', 'metric = ?'];
                const parameters: string[] = [query.deviceId, query.metric];

                if (query.from !== undefined) {
                    clauses.push('occurred_at >= ?');
                    parameters.push(query.from);
                }

                if (query.to !== undefined) {
                    clauses.push('occurred_at < ?');
                    parameters.push(query.to);
                }

                return database
                    .prepare(
                        `SELECT storage_sequence, record_id, event_id, device_id, metric, value, unit,
                                occurred_at, payload_json
                         FROM telemetry_samples
                         WHERE ${clauses.join(' AND ')}
                         ORDER BY occurred_at ASC, storage_sequence ASC`,
                    )
                    .all(...parameters)
                    .map(toStoredTelemetrySample);
            });
        },
        appendQuarantineEntry(input) {
            return run(() => {
                const result = database
                    .prepare(
                        `INSERT INTO quarantine_entries (event_id, reason, recorded_at, raw_event_json)
                         VALUES (?, ?, ?, ?)`,
                    )
                    .run(input.eventId ?? null, input.reason, input.recordedAt, stringifyJson(input.rawEvent));
                const internalSequence = lastInsertRowId(result);

                return { ...input, internalSequence } satisfies StoredQuarantineEntry;
            });
        },
        listQuarantineEntries() {
            return run(() =>
                database
                    .prepare(
                        `SELECT internal_sequence, event_id, reason, recorded_at, raw_event_json
                         FROM quarantine_entries
                         ORDER BY internal_sequence ASC`,
                    )
                    .all()
                    .map(toStoredQuarantineEntry),
            );
        },
        upsertSimulatorCommandReceipt(input) {
            run(() => {
                database
                    .prepare(
                        `INSERT INTO simulator_command_receipts (
                            source, command_id, updated_at, receipt_json
                        ) VALUES (?, ?, ?, ?)
                        ON CONFLICT(source, command_id) DO UPDATE SET
                            updated_at = excluded.updated_at,
                            receipt_json = excluded.receipt_json`,
                    )
                    .run(input.source, input.commandId, input.updatedAt, stringifyJson(input.receipt));
            });
        },
        getSimulatorCommandReceipt(source, commandId) {
            return run(() => {
                const row = database
                    .prepare(
                        `SELECT source, command_id, updated_at, receipt_json
                         FROM simulator_command_receipts
                         WHERE source = ? AND command_id = ?`,
                    )
                    .get(source, commandId);

                return row ? toSimulatorCommandReceipt(row) : undefined;
            });
        },
        saveLatestRoomProjection(input) {
            run(() => {
                database
                    .prepare(
                        `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                         VALUES (1, ?, ?)
                         ON CONFLICT(id) DO UPDATE SET
                            updated_at = excluded.updated_at,
                            projection_json = excluded.projection_json`,
                    )
                    .run(input.updatedAt, stringifyJson(input.projection));
            });
        },
        getLatestRoomProjection() {
            return run(() => {
                const row = database
                    .prepare('SELECT updated_at, projection_json FROM latest_room_projection WHERE id = 1')
                    .get();

                return row ? toLatestRoomProjection(row) : undefined;
            });
        },
        close() {
            if (!closed) {
                database.close();
                closed = true;
            }
        },
    };

    function run<Value>(operation: () => Value): Value {
        if (closed) {
            throw new StorageInvariantError('Room storage is closed.', undefined);
        }

        try {
            return operation();
        } catch (error) {
            throw classifySqliteError(error);
        }
    }
}

function openDatabase(databasePath: string): DatabaseSync {
    let database: DatabaseSync | undefined;

    try {
        database = new DatabaseSync(databasePath, {
            allowExtension: false,
            enableForeignKeyConstraints: true,
        });
        database.enableDefensive(true);
        database.enableLoadExtension(false);
        database.exec('PRAGMA journal_mode = WAL');
        database.exec('PRAGMA synchronous = FULL');
        database.exec('PRAGMA busy_timeout = 0');

        return database;
    } catch (error) {
        try {
            database?.close();
        } catch {
            // Preserve the original failure classification when cleanup cannot be observed.
        }

        throw classifySqliteError(error);
    }
}

function validateExpectedSchema(database: DatabaseSync): void {
    for (const [tableName, expectedColumns] of Object.entries(expectedTableColumns)) {
        const table = database
            .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?`)
            .get(tableName);

        if (!table || typeof table !== 'object' || typeof table.sql !== 'string') {
            throw new StorageSchemaError(`Database table ${tableName} is missing.`, table);
        }

        if (!table.sql.includes('STRICT')) {
            throw new StorageSchemaError(`Database table ${tableName} is not strict.`, table);
        }

        const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
        const actualColumns = new Set(
            columns
                .filter(isRecord)
                .map((column) => column.name)
                .filter((column): column is string => typeof column === 'string'),
        );

        for (const column of expectedColumns) {
            if (!actualColumns.has(column)) {
                throw new StorageSchemaError(
                    `Database table ${tableName} is missing column ${column}.`,
                    columns,
                );
            }
        }
    }

    for (const [indexName, expectedColumns] of Object.entries(expectedIndexes)) {
        const index = database
            .prepare(`SELECT 1 AS present FROM sqlite_schema WHERE type = 'index' AND name = ?`)
            .get(indexName);

        if (!index) {
            throw new StorageSchemaError(`Database index ${indexName} is missing.`, index);
        }

        const actualColumns = database
            .prepare(`PRAGMA index_info(${indexName})`)
            .all()
            .filter(isRecord)
            .map((column) => column.name)
            .filter((column): column is string => typeof column === 'string');

        if (
            actualColumns.length !== expectedColumns.length ||
            actualColumns.some((column, indexPosition) => column !== expectedColumns[indexPosition])
        ) {
            throw new StorageSchemaError(`Database index ${indexName} has unexpected columns.`, actualColumns);
        }
    }

    const schemaVersion = readSchemaVersion(database);

    if (schemaVersion !== roomStorageMigrations.length) {
        throw new StorageSchemaError('Database schema version does not match the migration manifest.', {
            schemaVersion,
        });
    }
}

function readMetadata(database: DatabaseSync): StorageMetadata {
    const row = database
        .prepare(
            `SELECT history_generation_id, last_storage_sequence
             FROM storage_metadata
             WHERE id = 1`,
        )
        .get();

    if (!row || typeof row !== 'object') {
        throw new StorageSchemaError('Database has no storage metadata row.', row);
    }

    const metadata = row as Record<string, unknown>;
    const historyGenerationId = metadata.history_generation_id;
    const lastStorageSequence = metadata.last_storage_sequence;

    if (
        typeof historyGenerationId !== 'string' ||
        historyGenerationId.length === 0 ||
        typeof lastStorageSequence !== 'number' ||
        !Number.isSafeInteger(lastStorageSequence) ||
        lastStorageSequence < 0
    ) {
        throw new StorageSchemaError('Database storage metadata is invalid.', row);
    }

    return {
        historyGenerationId,
        schemaVersion: readSchemaVersion(database),
        lastStorageSequence,
    };
}

function readSchemaVersion(database: DatabaseSync): number {
    const row = database.prepare('SELECT MAX(version) AS schema_version FROM schema_migrations').get();

    if (!isRecord(row) || typeof row.schema_version !== 'number' || !Number.isSafeInteger(row.schema_version)) {
        throw new StorageSchemaError('Database schema version is invalid.', row);
    }

    return row.schema_version;
}

function inTransaction<Value>(database: DatabaseSync, operation: () => Value): Value {
    database.exec('BEGIN IMMEDIATE');

    try {
        const result = operation();
        database.exec('COMMIT');

        return result;
    } catch (error) {
        try {
            database.exec('ROLLBACK');
        } catch {
            throw new StorageInvariantError('SQLite transaction rollback could not be confirmed.', error);
        }

        throw error;
    }
}

function allocateStorageSequence(database: DatabaseSync): number {
    const row = database
        .prepare(
            `UPDATE storage_metadata
             SET last_storage_sequence = last_storage_sequence + 1
             WHERE id = 1
             RETURNING last_storage_sequence`,
        )
        .get();

    if (!row || typeof row !== 'object' || !('last_storage_sequence' in row)) {
        throw new StorageInvariantError('Storage sequence allocation returned no value.', row);
    }

    const storageSequence = row.last_storage_sequence;

    if (
        typeof storageSequence !== 'number' ||
        !Number.isSafeInteger(storageSequence) ||
        storageSequence < 1
    ) {
        throw new StorageInvariantError('Storage sequence allocation returned an invalid value.', row);
    }

    return storageSequence;
}

function stringifyJson(value: unknown): string {
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
        throw new StorageInvariantError('Storage payload must be JSON serializable.', value);
    }

    return serialized;
}

function lastInsertRowId(result: ReturnType<StatementSync['run']>): number {
    const value = result.lastInsertRowid;

    if (typeof value === 'bigint') {
        const asNumber = Number(value);

        if (!Number.isSafeInteger(asNumber)) {
            throw new StorageInvariantError('Quarantine sequence exceeds the safe integer range.', value);
        }

        return asNumber;
    }

    if (!Number.isSafeInteger(value)) {
        throw new StorageInvariantError('Quarantine sequence is invalid.', value);
    }

    return value;
}

function toStoredTelemetrySample(row: unknown): StoredTelemetrySample {
    const value = record(row, 'telemetry sample');

    return {
        storageSequence: numberField(value, 'storage_sequence'),
        recordId: stringField(value, 'record_id'),
        eventId: optionalStringField(value, 'event_id'),
        deviceId: stringField(value, 'device_id'),
        metric: stringField(value, 'metric'),
        value: numberField(value, 'value'),
        unit: stringField(value, 'unit'),
        occurredAt: stringField(value, 'occurred_at'),
        payload: parseJson(stringField(value, 'payload_json')),
    };
}

function toStoredSignificantFact(row: unknown): StoredSignificantFact {
    const value = record(row, 'significant fact');

    return {
        storageSequence: numberField(value, 'storage_sequence'),
        recordId: stringField(value, 'record_id'),
        eventId: optionalStringField(value, 'event_id'),
        eventType: stringField(value, 'event_type'),
        deviceId: optionalStringField(value, 'device_id'),
        commandId: optionalStringField(value, 'command_id'),
        source: optionalStringField(value, 'source'),
        occurredAt: stringField(value, 'occurred_at'),
        payload: parseJson(stringField(value, 'payload_json')),
    };
}

function toStoredQuarantineEntry(row: unknown): StoredQuarantineEntry {
    const value = record(row, 'quarantine entry');

    return {
        internalSequence: numberField(value, 'internal_sequence'),
        eventId: optionalStringField(value, 'event_id'),
        reason: stringField(value, 'reason'),
        recordedAt: stringField(value, 'recorded_at'),
        rawEvent: parseJson(stringField(value, 'raw_event_json')),
    };
}

function toSimulatorCommandReceipt(row: unknown): SimulatorCommandReceiptInput {
    const value = record(row, 'simulator receipt');

    return {
        source: stringField(value, 'source'),
        commandId: stringField(value, 'command_id'),
        updatedAt: stringField(value, 'updated_at'),
        receipt: parseJson(stringField(value, 'receipt_json')),
    };
}

function toLatestRoomProjection(row: unknown): LatestRoomProjectionInput {
    const value = record(row, 'room projection');

    return {
        updatedAt: stringField(value, 'updated_at'),
        projection: parseJson(stringField(value, 'projection_json')),
    };
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new StorageSchemaError('Stored JSON is invalid.', error);
    }
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new StorageSchemaError(`Stored ${label} has an invalid shape.`, value);
    }

    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

const expectedTableColumns = {
    schema_migrations: ['version', 'name', 'checksum'],
    storage_metadata: ['id', 'history_generation_id', 'last_storage_sequence'],
    significant_facts: [
        'storage_sequence',
        'record_id',
        'event_id',
        'event_type',
        'device_id',
        'command_id',
        'source',
        'occurred_at',
        'payload_json',
    ],
    telemetry_samples: [
        'storage_sequence',
        'record_id',
        'event_id',
        'device_id',
        'metric',
        'value',
        'unit',
        'occurred_at',
        'payload_json',
    ],
    quarantine_entries: ['internal_sequence', 'event_id', 'reason', 'recorded_at', 'raw_event_json'],
    simulator_command_receipts: ['source', 'command_id', 'updated_at', 'receipt_json'],
    latest_room_projection: ['id', 'updated_at', 'projection_json'],
} as const satisfies Record<string, readonly string[]>;

const expectedIndexes = {
    telemetry_samples_by_device_metric_time: ['device_id', 'metric', 'occurred_at', 'storage_sequence'],
    significant_facts_by_device_time: ['device_id', 'occurred_at', 'storage_sequence'],
} as const satisfies Record<string, readonly string[]>;

function stringField(value: Record<string, unknown>, field: string): string {
    const fieldValue = value[field];

    if (typeof fieldValue !== 'string') {
        throw new StorageSchemaError(`Stored field ${field} must be a string.`, value);
    }

    return fieldValue;
}

function optionalStringField(value: Record<string, unknown>, field: string): string | undefined {
    const fieldValue = value[field];

    if (fieldValue === null || fieldValue === undefined) {
        return undefined;
    }

    if (typeof fieldValue !== 'string') {
        throw new StorageSchemaError(`Stored field ${field} must be a string or null.`, value);
    }

    return fieldValue;
}

function numberField(value: Record<string, unknown>, field: string): number {
    const fieldValue = value[field];

    if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
        throw new StorageSchemaError(`Stored field ${field} must be a finite number.`, value);
    }

    return fieldValue;
}
