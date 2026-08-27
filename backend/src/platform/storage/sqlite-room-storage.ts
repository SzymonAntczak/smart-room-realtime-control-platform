import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type {
    AcceptedInputIdentity,
    LatestRoomProjectionInput,
    QuarantineEntryInput,
    RoomStorage,
    RoomStorageTransaction,
    SignificantFactInput,
    SimulatorCommandReceiptInput,
    StorageMetadata,
    StorageTransactionOutcome,
    StoredQuarantineEntry,
    StoredSignificantFact,
    StoredTelemetrySample,
    TelemetrySampleInput,
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
        transact(operation) {
            return run(() => executeStorageTransaction(database, operation));
        },
        listAcceptedInputIdentities() {
            return run(() =>
                database
                    .prepare(
                        `SELECT event_id, fingerprint, durability, accepted_at
                         FROM accepted_input_identities
                         ORDER BY accepted_at ASC, event_id ASC`,
                    )
                    .all()
                    .map(toAcceptedInputIdentity),
            );
        },
        isAcceptedInputIdentityActive(eventId, asOf) {
            return run(() => isAcceptedInputIdentityActive(database, eventId, asOf));
        },
        listSignificantFacts() {
            return run(() =>
                database
                    .prepare(
                        `SELECT storage_sequence, record_id, event_id, event_type, device_id, command_id,
                                source, occurred_at, payload_json
                         FROM significant_facts
                         WHERE retired_at IS NULL
                         ORDER BY storage_sequence ASC`,
                    )
                    .all()
                    .map(toStoredSignificantFact),
            );
        },
        listTelemetrySamples(query) {
            return run(() => {
                const clauses = ['device_id = ?', 'metric = ?'];
                const parameters: string[] = [query.deviceId, query.metric];

                if (query.from !== undefined) {
                    clauses.push('occurred_at >= ?');
                    parameters.push(canonicalStorageTimestamp(query.from));
                }

                if (query.to !== undefined) {
                    clauses.push('occurred_at < ?');
                    parameters.push(canonicalStorageTimestamp(query.to));
                }

                return database
                    .prepare(
                        `SELECT storage_sequence, record_id, event_id, device_id, metric, value, unit,
                                occurred_at, payload_json
                         FROM telemetry_samples
                         WHERE retired_at IS NULL AND ${clauses.join(' AND ')}
                         ORDER BY occurred_at ASC, storage_sequence ASC`,
                    )
                    .all(...parameters)
                    .map(toStoredTelemetrySample);
            });
        },
        listQuarantineEntries() {
            return run(() =>
                database
                    .prepare(
                        `SELECT internal_sequence, event_id, reason, recorded_at, raw_event_json
                         FROM quarantine_entries
                         WHERE retired_at IS NULL
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
                    .run(
                        input.source,
                        input.commandId,
                        input.updatedAt,
                        stringifyJson(input.receipt),
                    );
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
        getLatestRoomProjection() {
            return run(() => {
                const row = database
                    .prepare(
                        'SELECT updated_at, projection_json FROM latest_room_projection WHERE id = 1',
                    )
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

        const normalizedTableSql = normalizeSchemaSql(table.sql);

        if (!normalizedTableSql.includes('strict')) {
            throw new StorageSchemaError(`Database table ${tableName} is not strict.`, table);
        }

        assertSchemaSqlIncludes(
            `Database table ${tableName} has unexpected constraints.`,
            normalizedTableSql,
            expectedTableSqlFragments[tableName as keyof typeof expectedTableSqlFragments],
            table,
        );

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
            .prepare(`SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?`)
            .get(indexName);

        if (!index || !isRecord(index) || typeof index.sql !== 'string') {
            throw new StorageSchemaError(`Database index ${indexName} is missing.`, index);
        }

        assertSchemaSqlIncludes(
            `Database index ${indexName} has an unexpected definition.`,
            normalizeSchemaSql(index.sql),
            expectedIndexSqlFragments[indexName as keyof typeof expectedIndexSqlFragments],
            index,
        );

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
            throw new StorageSchemaError(
                `Database index ${indexName} has unexpected columns.`,
                actualColumns,
            );
        }
    }

    const schemaVersion = readSchemaVersion(database);

    if (schemaVersion !== roomStorageMigrations.length) {
        throw new StorageSchemaError(
            'Database schema version does not match the migration manifest.',
            {
                schemaVersion,
            },
        );
    }
}

function assertSchemaSqlIncludes(
    message: string,
    actualSql: string,
    expectedFragments: readonly string[],
    schema: unknown,
): void {
    if (!expectedFragments.every((fragment) => actualSql.includes(fragment))) {
        throw new StorageSchemaError(message, schema);
    }
}

function normalizeSchemaSql(sql: string): string {
    return sql.replaceAll(/\s+/g, ' ').trim().toLowerCase();
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
    const row = database
        .prepare('SELECT MAX(version) AS schema_version FROM schema_migrations')
        .get();

    if (
        !isRecord(row) ||
        typeof row.schema_version !== 'number' ||
        !Number.isSafeInteger(row.schema_version)
    ) {
        throw new StorageSchemaError('Database schema version is invalid.', row);
    }

    return row.schema_version;
}

export function executeStorageTransaction<Value>(
    database: DatabaseSync,
    operation: (transaction: RoomStorageTransaction) => Value,
): StorageTransactionOutcome<Value> {
    try {
        database.exec('BEGIN IMMEDIATE');
    } catch (error) {
        if (database.isTransaction) {
            try {
                database.exec('ROLLBACK');
            } catch (rollbackError) {
                return { status: 'indeterminate', error: classifySqliteError(rollbackError) };
            }

            if (database.isTransaction) {
                return {
                    status: 'indeterminate',
                    error: new StorageInvariantError(
                        'SQLite transaction remained active after BEGIN failure rollback.',
                        error,
                    ),
                };
            }
        }

        return { status: 'confirmed_rolled_back', error: classifySqliteError(error) };
    }

    let value: Value;

    try {
        value = operation({
            appendSignificantFact(input) {
                return insertSignificantFact(database, input);
            },
            appendTelemetrySample(input) {
                return insertTelemetrySample(database, input);
            },
            appendQuarantineEntry(input) {
                return insertQuarantineEntry(database, input);
            },
            upsertAcceptedInputIdentity(input) {
                database
                    .prepare(
                        `INSERT INTO accepted_input_identities (event_id, fingerprint, durability, accepted_at)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(event_id) DO UPDATE SET
                             fingerprint = excluded.fingerprint,
                             durability = excluded.durability,
                             accepted_at = excluded.accepted_at`,
                    )
                    .run(input.eventId, input.fingerprint, input.durability, input.acceptedAt);
            },
            retireExpiredRecords(input) {
                return retireExpiredRecords(database, input.asOf);
            },
            saveLatestRoomProjection(input) {
                database
                    .prepare(
                        `INSERT INTO latest_room_projection (id, updated_at, projection_json)
                         VALUES (1, ?, ?)
                         ON CONFLICT(id) DO UPDATE SET
                            updated_at = excluded.updated_at,
                            projection_json = excluded.projection_json`,
                    )
                    .run(input.updatedAt, stringifyJson(toStoredCheckpoint(input)));
            },
        });
    } catch (error) {
        if (!database.isTransaction) {
            return { status: 'indeterminate', error: classifySqliteError(error) };
        }

        try {
            database.exec('ROLLBACK');
        } catch (rollbackError) {
            return { status: 'indeterminate', error: classifySqliteError(rollbackError) };
        }

        if (database.isTransaction) {
            return {
                status: 'indeterminate',
                error: new StorageInvariantError(
                    'SQLite transaction remained active after rollback.',
                    error,
                ),
            };
        }

        return { status: 'confirmed_rolled_back', error: classifySqliteError(error) };
    }

    try {
        database.exec('COMMIT');

        return { status: 'committed', value };
    } catch (error) {
        try {
            if (database.isTransaction) {
                database.exec('ROLLBACK');
            }
        } catch {
            // A COMMIT failure is indeterminate even when cleanup also fails.
        }

        return { status: 'indeterminate', error: classifySqliteError(error) };
    }
}

function retireExpiredRecords(database: DatabaseSync, asOf: string): string[] {
    const asOfEpoch = Date.parse(asOf);

    if (!Number.isFinite(asOfEpoch)) {
        throw new StorageInvariantError('Retention requires an ISO timestamp.', asOf);
    }

    const retiredAt = asOf;
    const cutoff = new Date(asOfEpoch - 30 * 24 * 60 * 60 * 1_000).toISOString();

    database
        .prepare(
            `UPDATE significant_facts SET retired_at = ?
             WHERE retired_at IS NULL AND occurred_at < ?`,
        )
        .run(retiredAt, cutoff);
    database
        .prepare(
            `UPDATE telemetry_samples SET retired_at = ?
             WHERE retired_at IS NULL AND occurred_at < ?`,
        )
        .run(retiredAt, cutoff);
    database
        .prepare(
            `UPDATE quarantine_entries SET retired_at = ?
             WHERE retired_at IS NULL AND recorded_at < ?`,
        )
        .run(retiredAt, cutoff);

    database
        .prepare(
            `UPDATE significant_facts SET retired_at = ?
             WHERE retired_at IS NULL AND storage_sequence IN (
                 SELECT storage_sequence FROM significant_facts
                 WHERE retired_at IS NULL
                 ORDER BY occurred_at DESC, storage_sequence DESC
                 LIMIT -1 OFFSET 5000
             )`,
        )
        .run(retiredAt);
    database
        .prepare(
            `UPDATE telemetry_samples SET retired_at = ?
             WHERE retired_at IS NULL AND storage_sequence IN (
                 SELECT storage_sequence FROM (
                     SELECT storage_sequence,
                            ROW_NUMBER() OVER (
                                PARTITION BY device_id
                                ORDER BY occurred_at DESC, storage_sequence DESC
                            ) AS row_number
                     FROM telemetry_samples
                     WHERE retired_at IS NULL
                 ) WHERE row_number > 10000
             )`,
        )
        .run(retiredAt);
    database
        .prepare(
            `UPDATE quarantine_entries SET retired_at = ?
             WHERE retired_at IS NULL AND internal_sequence IN (
                 SELECT internal_sequence FROM quarantine_entries
                 WHERE retired_at IS NULL
                 ORDER BY recorded_at DESC, internal_sequence DESC
                 LIMIT -1 OFFSET 1000
             )`,
        )
        .run(retiredAt);

    const retiredIdentityEventIds = database
        .prepare(
            `SELECT event_id
             FROM accepted_input_identities
             WHERE durability = 'durable'
               AND NOT EXISTS (
                   SELECT 1 FROM significant_facts
                   WHERE significant_facts.event_id = accepted_input_identities.event_id
                     AND significant_facts.retired_at IS NULL
               )
               AND NOT EXISTS (
                   SELECT 1 FROM telemetry_samples
                   WHERE telemetry_samples.event_id = accepted_input_identities.event_id
                     AND telemetry_samples.retired_at IS NULL
               )`,
        )
        .all()
        .map((row) => stringField(record(row, 'retired accepted identity'), 'event_id'));

    database.exec(
        `DELETE FROM accepted_input_identities
         WHERE durability = 'durable'
           AND NOT EXISTS (
               SELECT 1 FROM significant_facts
               WHERE significant_facts.event_id = accepted_input_identities.event_id
                 AND significant_facts.retired_at IS NULL
           )
           AND NOT EXISTS (
               SELECT 1 FROM telemetry_samples
               WHERE telemetry_samples.event_id = accepted_input_identities.event_id
                 AND telemetry_samples.retired_at IS NULL
           )`,
    );

    return retiredIdentityEventIds;
}

function isAcceptedInputIdentityActive(
    database: DatabaseSync,
    eventId: string,
    asOf: string,
): boolean {
    const asOfEpoch = Date.parse(asOf);

    if (!Number.isFinite(asOfEpoch)) {
        throw new StorageInvariantError('Identity lookup requires an ISO timestamp.', asOf);
    }

    const cutoff = new Date(asOfEpoch - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const active = database
        .prepare(
            `SELECT 1 AS present
             FROM accepted_input_identities
             WHERE event_id = ?
               AND durability = 'durable'
               AND (
                   EXISTS (
                       SELECT 1 FROM significant_facts
                       WHERE event_id = accepted_input_identities.event_id
                         AND retired_at IS NULL
                         AND occurred_at >= ?
                   )
                   OR EXISTS (
                       SELECT 1 FROM telemetry_samples
                       WHERE event_id = accepted_input_identities.event_id
                         AND retired_at IS NULL
                         AND occurred_at >= ?
                   )
               )`,
        )
        .get(eventId, cutoff, cutoff);

    return active !== undefined;
}

function insertSignificantFact(
    database: DatabaseSync,
    input: SignificantFactInput,
): StoredSignificantFact {
    const occurredAt = canonicalStorageTimestamp(input.occurredAt);
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
            occurredAt,
            stringifyJson(input.payload),
        );

    return { ...input, occurredAt, storageSequence };
}

function insertTelemetrySample(
    database: DatabaseSync,
    input: TelemetrySampleInput,
): StoredTelemetrySample {
    const occurredAt = canonicalStorageTimestamp(input.occurredAt);
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
            occurredAt,
            stringifyJson(input.payload),
        );

    return { ...input, occurredAt, storageSequence };
}

function insertQuarantineEntry(
    database: DatabaseSync,
    input: QuarantineEntryInput,
): StoredQuarantineEntry {
    const recordedAt = canonicalStorageTimestamp(input.recordedAt);
    const result = database
        .prepare(
            `INSERT INTO quarantine_entries (event_id, reason, recorded_at, raw_event_json)
             VALUES (?, ?, ?, ?)`,
        )
        .run(input.eventId ?? null, input.reason, recordedAt, stringifyJson(input.rawEvent));

    return { ...input, recordedAt, internalSequence: lastInsertRowId(result) };
}

function canonicalStorageTimestamp(value: string): string {
    const timestamp = Date.parse(value);

    if (!Number.isFinite(timestamp)) {
        throw new StorageInvariantError('Storage timestamps must be valid ISO timestamps.', value);
    }

    return new Date(timestamp).toISOString();
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
        throw new StorageInvariantError(
            'Storage sequence allocation returned an invalid value.',
            row,
        );
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
            throw new StorageInvariantError(
                'Quarantine sequence exceeds the safe integer range.',
                value,
            );
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
    const projection = parseJson(stringField(value, 'projection_json'));

    return {
        updatedAt: stringField(value, 'updated_at'),
        ...fromStoredCheckpoint(projection),
    };
}

function toStoredCheckpoint(
    input: LatestRoomProjectionInput,
): Pick<LatestRoomProjectionInput, 'projection' | 'projectionEvidence' | 'volatileGuards'> {
    return {
        projection: input.projection,
        projectionEvidence: input.projectionEvidence,
        volatileGuards: input.volatileGuards,
    };
}

function fromStoredCheckpoint(
    value: unknown,
): Pick<LatestRoomProjectionInput, 'projection' | 'projectionEvidence' | 'volatileGuards'> {
    if (
        !isRecord(value) ||
        !('projection' in value) ||
        !isProjectionEvidence(value.projectionEvidence) ||
        !Array.isArray(value.volatileGuards)
    ) {
        throw new StorageSchemaError(
            'Stored room projection checkpoint has an invalid shape.',
            value,
        );
    }

    return {
        projection: value.projection,
        projectionEvidence: value.projectionEvidence,
        volatileGuards: value.volatileGuards.map(toCheckpointIdentity),
    };
}

function isProjectionEvidence(
    value: unknown,
): value is LatestRoomProjectionInput['projectionEvidence'] {
    return (
        isRecord(value) &&
        Array.isArray(value.availabilityDeviceIds) &&
        value.availabilityDeviceIds.every((deviceId) => typeof deviceId === 'string') &&
        Array.isArray(value.healthDeviceIds) &&
        value.healthDeviceIds.every((deviceId) => typeof deviceId === 'string') &&
        (value.commandConfirmationSources === undefined ||
            (Array.isArray(value.commandConfirmationSources) &&
                value.commandConfirmationSources.every(
                    (source) =>
                        isRecord(source) &&
                        typeof source.commandId === 'string' &&
                        typeof source.eventId === 'string',
                )))
    );
}

function toCheckpointIdentity(value: unknown): AcceptedInputIdentity {
    const identity = record(value, 'checkpoint volatile guard');
    const durability = stringField(identity, 'durability');

    if (durability !== 'volatile') {
        throw new StorageSchemaError('Checkpoint identity must be volatile.', value);
    }

    return {
        eventId: stringField(identity, 'eventId'),
        fingerprint: stringField(identity, 'fingerprint'),
        durability,
        acceptedAt: stringField(identity, 'acceptedAt'),
    };
}

function toAcceptedInputIdentity(row: unknown): AcceptedInputIdentity {
    const value = record(row, 'accepted input identity');
    const durability = stringField(value, 'durability');

    if (durability !== 'durable' && durability !== 'volatile') {
        throw new StorageSchemaError('Accepted input identity has invalid durability.', row);
    }

    return {
        eventId: stringField(value, 'event_id'),
        fingerprint: stringField(value, 'fingerprint'),
        durability,
        acceptedAt: stringField(value, 'accepted_at'),
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
        'retired_at',
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
        'retired_at',
    ],
    quarantine_entries: [
        'internal_sequence',
        'event_id',
        'reason',
        'recorded_at',
        'raw_event_json',
        'retired_at',
    ],
    accepted_input_identities: ['event_id', 'fingerprint', 'durability', 'accepted_at'],
    simulator_command_receipts: ['source', 'command_id', 'updated_at', 'receipt_json'],
    latest_room_projection: ['id', 'updated_at', 'projection_json'],
} as const satisfies Record<string, readonly string[]>;

const expectedTableSqlFragments = {
    schema_migrations: [
        'version integer primary key',
        'name text not null',
        'checksum text not null',
    ],
    storage_metadata: [
        'id integer primary key check (id = 1)',
        'history_generation_id text not null',
        'last_storage_sequence integer not null default 0 check (last_storage_sequence >= 0)',
    ],
    significant_facts: [
        'storage_sequence integer primary key',
        'record_id text not null',
        'event_id text',
        'event_type text not null',
        'device_id text',
        'command_id text',
        'source text',
        'occurred_at text not null',
        'payload_json text not null',
        'retired_at text',
    ],
    telemetry_samples: [
        'storage_sequence integer primary key',
        'record_id text not null',
        'event_id text',
        'device_id text not null',
        'metric text not null',
        'value real not null',
        'unit text not null',
        'occurred_at text not null',
        'payload_json text not null',
        'retired_at text',
    ],
    quarantine_entries: [
        'internal_sequence integer primary key autoincrement',
        'event_id text',
        'reason text not null',
        'recorded_at text not null',
        'raw_event_json text not null',
        'retired_at text',
    ],
    accepted_input_identities: [
        'event_id text primary key',
        'fingerprint text not null',
        "durability text not null check (durability in ('durable', 'volatile'))",
        'accepted_at text not null',
    ],
    simulator_command_receipts: [
        'source text not null',
        'command_id text not null',
        'updated_at text not null',
        'receipt_json text not null',
        'primary key (source, command_id)',
    ],
    latest_room_projection: [
        'id integer primary key check (id = 1)',
        'updated_at text not null',
        'projection_json text not null',
    ],
} as const satisfies Record<keyof typeof expectedTableColumns, readonly string[]>;

const expectedIndexes = {
    telemetry_samples_by_device_metric_time: [
        'device_id',
        'metric',
        'occurred_at',
        'storage_sequence',
    ],
    significant_facts_by_device_time: ['device_id', 'occurred_at', 'storage_sequence'],
    significant_facts_active_by_time: ['occurred_at', 'storage_sequence'],
    telemetry_samples_active_by_device_time: ['device_id', 'occurred_at', 'storage_sequence'],
    quarantine_entries_active_by_time: ['recorded_at', 'internal_sequence'],
    significant_facts_active_by_event_id: ['event_id'],
    telemetry_samples_active_by_event_id: ['event_id'],
    accepted_input_identities_by_accepted_at: ['accepted_at', 'event_id'],
} as const satisfies Record<string, readonly string[]>;

const expectedIndexSqlFragments = {
    telemetry_samples_by_device_metric_time: [
        'on telemetry_samples (device_id, metric, occurred_at, storage_sequence)',
    ],
    significant_facts_by_device_time: [
        'on significant_facts (device_id, occurred_at, storage_sequence)',
    ],
    significant_facts_active_by_time: [
        'on significant_facts (occurred_at desc, storage_sequence desc) where retired_at is null',
    ],
    telemetry_samples_active_by_device_time: [
        'on telemetry_samples (device_id, occurred_at desc, storage_sequence desc) where retired_at is null',
    ],
    quarantine_entries_active_by_time: [
        'on quarantine_entries (recorded_at desc, internal_sequence desc) where retired_at is null',
    ],
    significant_facts_active_by_event_id: [
        'on significant_facts (event_id) where retired_at is null',
    ],
    telemetry_samples_active_by_event_id: [
        'on telemetry_samples (event_id) where retired_at is null',
    ],
    accepted_input_identities_by_accepted_at: [
        'on accepted_input_identities (accepted_at, event_id)',
    ],
} as const satisfies Record<keyof typeof expectedIndexes, readonly string[]>;

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
