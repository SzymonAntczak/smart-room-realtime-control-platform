import { randomUUID } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    renameSync,
    rmSync,
    statSync,
    unlinkSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { StorageMetadata } from './room-storage';
import { createSqliteRoomStorage, readSqliteStorageMetadata } from './sqlite-room-storage';
import { inspectSqliteRoomStorageTarget } from './sqlite-room-storage-lifecycle';
import { classifySqliteError, StorageInvariantError } from './storage-errors';

export interface StorageHistoryReplacement {
    replacedAt: string;
    databasePath: string;
    preservedStoragePath: string;
    newHistoryGenerationId: string;
    previousHistoryGenerationId?: string;
}

/**
 * Performs the explicit, operator-authorized replacement path. Normal startup
 * must continue through the lifecycle and must never call this function.
 */
export function replaceCorruptSqliteStorageAtStartup({
    databasePath,
    ensureDirectory,
    generateHistoryGenerationId = randomUUID,
    generateArchiveId = randomUUID,
    now = () => new Date().toISOString(),
    inspectTarget = inspectSqliteRoomStorageTarget,
    readPreviousHistoryGeneration = readPreviousHistoryGenerationId,
}: {
    databasePath: string;
    ensureDirectory: (databasePath: string) => void;
    generateHistoryGenerationId?: () => string;
    generateArchiveId?: () => string;
    now?: () => string;
    inspectTarget?: typeof inspectSqliteRoomStorageTarget;
    readPreviousHistoryGeneration?: (databasePath: string) => string | undefined;
}): StorageHistoryReplacement {
    ensureDirectory(databasePath);
    requireExistingNonPristineTarget(databasePath);
    const replacedAt = now();
    const preservedStoragePath = join(
        dirname(databasePath),
        `${basename(databasePath)}.replaced-${safePathTimestamp(replacedAt)}-${generateArchiveId()}`,
    );
    const archiveStagingPath = join(
        dirname(databasePath),
        `.${basename(databasePath)}.replacement-staging-${generateArchiveId()}`,
    );

    mkdirSync(archiveStagingPath);

    let storage: ReturnType<typeof createSqliteRoomStorage> | undefined;

    try {
        preserveSidecarCopies(databasePath, archiveStagingPath);
        const previousHistoryGenerationId = readPreviousHistoryGeneration(databasePath);
        requireManualInterventionTarget(databasePath, inspectTarget);
        renameSync(archiveStagingPath, preservedStoragePath);
        renameSync(databasePath, join(preservedStoragePath, basename(databasePath)));
        removeRemainingSidecars(databasePath);

        storage = createSqliteRoomStorage({ databasePath, generateHistoryGenerationId });
        const metadata = storage.getMetadata();

        return replacementResult({
            replacedAt,
            databasePath,
            preservedStoragePath,
            metadata,
            previousHistoryGenerationId,
        });
    } finally {
        storage?.close();

        if (existsSync(archiveStagingPath)) {
            rmSync(archiveStagingPath, { force: true, recursive: true });
        }
    }
}

function requireManualInterventionTarget(
    databasePath: string,
    inspectTarget: typeof inspectSqliteRoomStorageTarget,
): void {
    try {
        inspectTarget(databasePath, { readOnly: true });
    } catch (error) {
        const classified = classifySqliteError(error);

        if (classified.kind === 'manual_intervention') {
            return;
        }

        throw classified;
    }

    throw new StorageInvariantError(
        'Corrupt-storage replacement refuses a target that passed storage inspection.',
        { databasePath },
    );
}

function requireExistingNonPristineTarget(databasePath: string): void {
    if (!existsSync(databasePath) || statSync(databasePath).size === 0) {
        throw new StorageInvariantError(
            'Corrupt-storage replacement requires an existing non-pristine database target.',
            { databasePath },
        );
    }
}

function readPreviousHistoryGenerationId(databasePath: string): string | undefined {
    let database: DatabaseSync | undefined;

    try {
        database = new DatabaseSync(databasePath, { allowExtension: false, readOnly: true });
        database.enableDefensive(true);
        database.enableLoadExtension(false);

        return readSqliteStorageMetadata(database).historyGenerationId;
    } catch {
        return undefined;
    } finally {
        database?.close();
    }
}

function preserveSidecarCopies(databasePath: string, archiveStagingPath: string): void {
    for (const sourcePath of [`${databasePath}-wal`, `${databasePath}-shm`]) {
        if (existsSync(sourcePath)) {
            copyFileSync(sourcePath, join(archiveStagingPath, basename(sourcePath)));
        }
    }
}

function removeRemainingSidecars(databasePath: string): void {
    for (const sourcePath of [`${databasePath}-wal`, `${databasePath}-shm`]) {
        if (existsSync(sourcePath)) {
            unlinkSync(sourcePath);
        }
    }
}

function replacementResult({
    replacedAt,
    databasePath,
    preservedStoragePath,
    metadata,
    previousHistoryGenerationId,
}: {
    replacedAt: string;
    databasePath: string;
    preservedStoragePath: string;
    metadata: StorageMetadata;
    previousHistoryGenerationId: string | undefined;
}): StorageHistoryReplacement {
    return {
        replacedAt,
        databasePath,
        preservedStoragePath,
        newHistoryGenerationId: metadata.historyGenerationId,
        ...(previousHistoryGenerationId ? { previousHistoryGenerationId } : {}),
    };
}

function safePathTimestamp(value: string): string {
    return value.replace(/[:.]/g, '-');
}
