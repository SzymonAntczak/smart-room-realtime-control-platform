import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
    RoomStorageLifecycle,
    StorageCutoverInput,
    StorageCutoverOutcome,
    StorageMetadata,
    StorageProbeResult,
} from './room-storage';
import { migrateSqliteDatabase } from './sqlite-migrations';
import {
    createRetentionContext,
    createSqliteRoomStorage,
    createSqliteRoomStorageTransaction,
    openExistingSqliteRoomStorage,
    openSqliteDatabase,
    probeExistingSqliteRoomStorage,
    readSqliteStorageMetadata,
    retireExpiredRecords,
    toStorageRetentionResult,
    validateExpectedSqliteSchema,
} from './sqlite-room-storage';
import {
    classifySqliteError,
    StorageInvariantError,
    StorageManualInterventionError,
    StorageSchemaError,
} from './storage-errors';

export function createSqliteRoomStorageLifecycle({
    databasePath,
    ensureDirectory,
    generateHistoryGenerationId = randomUUID,
    operationalLog = () => {},
}: {
    databasePath: string;
    ensureDirectory: (databasePath: string) => void;
    generateHistoryGenerationId?: () => string;
    operationalLog?: (entry: Record<string, unknown>) => void;
}): RoomStorageLifecycle {
    return {
        openAtStartup() {
            try {
                ensureDirectory(databasePath);
                // Startup may apply the deterministic migration chain. Recovery
                // probes deliberately use the stricter exact-schema branch below.
                inspectSqliteRoomStorageTarget(databasePath, { validateExpectedSchema: false });
                const storage = createSqliteRoomStorage({
                    databasePath,
                    generateHistoryGenerationId,
                });
                const metadata = storage.getMetadata();

                operationalLog({
                    event: 'storage_migration_check_completed',
                    source: 'sqlite-storage',
                    schemaVersion: metadata.schemaVersion,
                });

                return { kind: 'available', storage, metadata };
            } catch (error) {
                const classified = classifySqliteError(error);

                if (classified.kind === 'fatal') {
                    throw classified;
                }

                return { kind: 'degraded', error: classified };
            }
        },
        probe(context): StorageProbeResult {
            try {
                ensureDirectory(databasePath);
                const target = inspectSqliteRoomStorageTarget(databasePath);

                if (target.kind === 'existing') {
                    if (
                        context.verifiedHistoryGenerationId !== undefined &&
                        context.verifiedHistoryGenerationId !== target.metadata.historyGenerationId
                    ) {
                        throw new StorageManualInterventionError(
                            'SQLite history generation changed while recovery was pending.',
                            target.metadata,
                        );
                    }

                    probeExistingSqliteRoomStorage(databasePath);
                    const storage = openExistingSqliteRoomStorage(databasePath);
                    const metadata = storage.getMetadata();
                    const expectedHistoryGenerationId =
                        context.verifiedHistoryGenerationId ?? target.metadata.historyGenerationId;

                    if (metadata.historyGenerationId !== expectedHistoryGenerationId) {
                        storage.close();

                        throw new StorageManualInterventionError(
                            'SQLite history generation changed while recovery probe reopened it.',
                            {
                                expectedHistoryGenerationId,
                                actualHistoryGenerationId: metadata.historyGenerationId,
                            },
                        );
                    }

                    return {
                        kind: 'existing_generation',
                        storage,
                        metadata,
                    };
                }

                if (context.verifiedHistoryGenerationId !== undefined) {
                    throw new StorageManualInterventionError(
                        'A previously verified SQLite generation disappeared during recovery.',
                        { historyGenerationId: context.verifiedHistoryGenerationId },
                    );
                }

                probeFirstInitialization(databasePath, generateHistoryGenerationId);

                return { kind: 'first_initialization' };
            } catch (error) {
                throw classifySqliteError(error);
            }
        },
        cutover<Value>(input: StorageCutoverInput<Value>): StorageCutoverOutcome<Value> {
            return input.probe.kind === 'existing_generation'
                ? cutoverExistingGeneration(databasePath, input)
                : cutoverFirstInitialization(databasePath, generateHistoryGenerationId, input);
        },
    };
}

function cutoverExistingGeneration<Value>(
    databasePath: string,
    input: StorageCutoverInput<Value>,
): StorageCutoverOutcome<Value> {
    const probe = input.probe;

    if (probe.kind !== 'existing_generation') {
        throw new StorageInvariantError(
            'Existing cutover received a first-initialization probe.',
            probe,
        );
    }

    try {
        const target = inspectSqliteRoomStorageTarget(databasePath);

        if (
            target.kind !== 'existing' ||
            target.metadata.historyGenerationId !== probe.metadata.historyGenerationId
        ) {
            return { status: 'aborted' };
        }

        probeExistingSqliteRoomStorage(databasePath);
        const storage = openExistingSqliteRoomStorage(databasePath);
        let abortedBeforeCommit = false;
        const outcome = storage.transact(
            (transaction) => {
                const metadata = transaction.getMetadata();

                if (metadata.historyGenerationId !== probe.metadata.historyGenerationId) {
                    throw new StorageManualInterventionError(
                        'SQLite history generation changed during recovery cutover.',
                        {
                            expectedHistoryGenerationId: probe.metadata.historyGenerationId,
                            actualHistoryGenerationId: metadata.historyGenerationId,
                        },
                    );
                }

                return input.operation(transaction);
            },
            {
                retentionAsOf: input.retentionAsOf,
                beforeCommit: () => {
                    abortedBeforeCommit = input.shouldAbort();

                    return !abortedBeforeCommit;
                },
            },
        );

        if (outcome.status === 'committed') {
            try {
                return {
                    status: 'committed',
                    value: outcome.value,
                    retention: outcome.retention,
                    storage,
                    metadata: storage.getMetadata(),
                };
            } catch (error) {
                storage.close();

                return {
                    status: 'indeterminate',
                    error: new StorageInvariantError(
                        'SQLite cutover committed before its metadata could be reread.',
                        error,
                    ),
                };
            }
        }

        storage.close();

        return outcome.status === 'indeterminate'
            ? outcome
            : abortedBeforeCommit
              ? { status: 'aborted' }
              : outcome;
    } catch (error) {
        return { status: 'confirmed_rolled_back', error: classifySqliteError(error) };
    }
}

function cutoverFirstInitialization<Value>(
    databasePath: string,
    generateHistoryGenerationId: () => string,
    input: StorageCutoverInput<Value>,
): StorageCutoverOutcome<Value> {
    let database: ReturnType<typeof openSqliteDatabase> | undefined;
    let committed = false;
    let commitAttempted = false;

    try {
        database = openSqliteDatabase(databasePath);
        database.exec('BEGIN EXCLUSIVE');
        const target = classifyTargetInOpenDatabase(database, databasePath);

        if (target.kind === 'existing') {
            database.exec('ROLLBACK');
            database.close();

            return { status: 'aborted' };
        }

        migrateSqliteDatabase(database, generateHistoryGenerationId(), undefined, {
            transaction: 'caller',
        });
        validateExpectedSqliteSchema(database);
        const retention = createRetentionContext(database, input.retentionAsOf);
        const value = input.operation(createSqliteRoomStorageTransaction(database, retention));
        retireExpiredRecords(database, retention);

        if (input.shouldAbort()) {
            database.exec('ROLLBACK');
            database.close();

            return { status: 'aborted' };
        }

        commitAttempted = true;
        database.exec('COMMIT');
        committed = true;
        database.close();
        const storage = openExistingSqliteRoomStorage(databasePath);

        return {
            status: 'committed',
            value,
            retention: toStorageRetentionResult(retention),
            storage,
            metadata: storage.getMetadata(),
        };
    } catch (error) {
        if (committed) {
            return {
                status: 'indeterminate',
                error: new StorageInvariantError(
                    'SQLite cutover committed before its durable result could be reopened.',
                    error,
                ),
            };
        }

        return rollbackCutover(database, error, commitAttempted);
    } finally {
        try {
            database?.close();
        } catch {
            // The transaction result above remains authoritative.
        }
    }
}

function rollbackCutover(
    database: ReturnType<typeof openSqliteDatabase> | undefined,
    error: unknown,
    commitAttempted = false,
):
    | { status: 'confirmed_rolled_back'; error: unknown }
    | { status: 'indeterminate'; error: unknown } {
    if (commitAttempted && (!database || !database.isTransaction)) {
        return {
            status: 'indeterminate',
            error: new StorageInvariantError(
                'SQLite cutover COMMIT threw after its transaction was no longer active.',
                error,
            ),
        };
    }

    if (!database || !database.isTransaction) {
        return { status: 'confirmed_rolled_back', error: classifySqliteError(error) };
    }

    try {
        database.exec('ROLLBACK');
    } catch (rollbackError) {
        return { status: 'indeterminate', error: classifySqliteError(rollbackError) };
    }

    return database.isTransaction
        ? {
              status: 'indeterminate',
              error: new StorageInvariantError(
                  'SQLite cutover transaction remained active after rollback.',
                  error,
              ),
          }
        : { status: 'confirmed_rolled_back', error: classifySqliteError(error) };
}

function probeFirstInitialization(
    databasePath: string,
    generateHistoryGenerationId: () => string,
): void {
    const probePath = join(
        dirname(databasePath),
        `.${basename(databasePath)}.recovery-probe-${process.pid}-${Date.now()}-${randomUUID()}.sqlite`,
    );

    try {
        const descriptor = openSync(probePath, 'wx');
        closeSync(descriptor);
        const database = openSqliteDatabase(probePath);

        try {
            database.exec('BEGIN EXCLUSIVE');
            migrateSqliteDatabase(database, generateHistoryGenerationId(), undefined, {
                transaction: 'caller',
            });
            validateExpectedSqliteSchema(database);
            database
                .prepare(
                    'UPDATE storage_metadata SET last_storage_sequence = last_storage_sequence',
                )
                .run();
            database.exec('ROLLBACK');
        } finally {
            database.close();
        }
    } catch (error) {
        throw classifySqliteError(error);
    } finally {
        removeProbeArtifacts(probePath);
    }
}

type TargetClassification = { kind: 'pristine' } | { kind: 'existing'; metadata: StorageMetadata };

export function inspectSqliteRoomStorageTarget(
    databasePath: string,
    {
        validateExpectedSchema = true,
        readOnly = false,
    }: { validateExpectedSchema?: boolean; readOnly?: boolean } = {},
): TargetClassification {
    if (!existsSync(databasePath) || statSync(databasePath).size === 0) {
        return { kind: 'pristine' };
    }

    const database = readOnly
        ? openReadOnlySqliteDatabase(databasePath)
        : openSqliteDatabase(databasePath);

    try {
        return classifyTargetInOpenDatabase(database, databasePath, validateExpectedSchema);
    } finally {
        database.close();
    }
}

function openReadOnlySqliteDatabase(databasePath: string): DatabaseSync {
    let database: DatabaseSync | undefined;

    try {
        database = new DatabaseSync(databasePath, {
            allowExtension: false,
            readOnly: true,
        });
        database.enableDefensive(true);
        database.enableLoadExtension(false);

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

function classifyTargetInOpenDatabase(
    database: ReturnType<typeof openSqliteDatabase>,
    databasePath: string,
    validateExpectedSchema = true,
): TargetClassification {
    const history = database
        .prepare(
            "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'",
        )
        .get();

    if (history) {
        if (validateExpectedSchema) {
            validateExpectedSqliteSchema(database);
        }

        return { kind: 'existing', metadata: readSqliteStorageMetadata(database) };
    }

    const userTables = database
        .prepare(
            "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
        )
        .all()
        .flatMap((row) =>
            typeof row === 'object' && row !== null && 'name' in row && typeof row.name === 'string'
                ? [row.name]
                : [],
        );

    if (userTables.length === 0) {
        return { kind: 'pristine' };
    }

    const applicationTables = new Set([
        'storage_metadata',
        'significant_facts',
        'telemetry_samples',
        'quarantine_entries',
        'simulator_command_receipts',
        'latest_room_projection',
        'accepted_input_identities',
        'command_dispatch_outbox',
        'runtime_sessions',
    ]);

    if (userTables.some((table) => applicationTables.has(table))) {
        throw new StorageSchemaError('SQLite target has a partial application schema.', {
            databasePath,
            userTables,
        });
    }

    throw new StorageManualInterventionError('SQLite target contains foreign user tables.', {
        databasePath,
        userTables,
    });
}

function removeProbeArtifacts(probePath: string): void {
    for (const artifact of [probePath, `${probePath}-wal`, `${probePath}-shm`]) {
        try {
            if (existsSync(artifact)) {
                unlinkSync(artifact);
            }
        } catch {
            // A failed cleanup does not change the target classification.
        }
    }
}
