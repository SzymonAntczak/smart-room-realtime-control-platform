import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteRoomStorage } from './sqlite-room-storage';
import { replaceCorruptSqliteStorageAtStartup } from './sqlite-room-storage-replacement';
import {
    StorageInvariantError,
    StorageManualInterventionError,
    StorageSchemaError,
} from './storage-errors';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

describe('explicit corrupt SQLite storage replacement', () => {
    it('preserves an invalid target and starts a clean history generation', () => {
        const directory = temporaryDirectory();
        const databasePath = join(directory, 'room.sqlite');
        writeFileSync(databasePath, 'not a SQLite database');
        writeFileSync(`${databasePath}-wal`, 'invalid wal');
        writeFileSync(`${databasePath}-shm`, 'invalid shm');

        const replacement = replaceCorruptSqliteStorageAtStartup({
            databasePath,
            ensureDirectory() {},
            generateHistoryGenerationId: () => '22222222-2222-4222-8222-222222222222',
            generateArchiveId: () => 'archive-id',
            now: () => '2026-09-09T10:00:00.000Z',
        });
        const storage = createSqliteRoomStorage({ databasePath });

        try {
            expect(replacement).toEqual({
                replacedAt: '2026-09-09T10:00:00.000Z',
                databasePath,
                preservedStoragePath: join(
                    directory,
                    'room.sqlite.replaced-2026-09-09T10-00-00-000Z-archive-id',
                ),
                newHistoryGenerationId: '22222222-2222-4222-8222-222222222222',
            });
            expect(
                readFileSync(join(replacement.preservedStoragePath, 'room.sqlite'), 'utf8'),
            ).toBe('not a SQLite database');
            expect(existsSync(join(replacement.preservedStoragePath, 'room.sqlite-wal'))).toBe(
                true,
            );
            expect(existsSync(join(replacement.preservedStoragePath, 'room.sqlite-shm'))).toBe(
                true,
            );
            expect(storage.getMetadata().historyGenerationId).toBe(
                '22222222-2222-4222-8222-222222222222',
            );
            expect(storage.getLatestRoomProjection()).toBeUndefined();
            expect(storage.listCommandDispatchOutboxIntents()).toEqual([]);
            expect(storage.listSimulatorCommandReceipts('simulator-led')).toEqual([]);
            expect(storage.listSignificantFacts()).toEqual([]);
        } finally {
            storage.close();
        }
    });

    it('refuses missing and healthy targets without changing them', () => {
        const directory = temporaryDirectory();
        const missingPath = join(directory, 'missing.sqlite');

        expect(() =>
            replaceCorruptSqliteStorageAtStartup({
                databasePath: missingPath,
                ensureDirectory() {},
            }),
        ).toThrow(StorageInvariantError);
        expect(existsSync(missingPath)).toBe(false);

        const healthyPath = join(directory, 'healthy.sqlite');
        const storage = createSqliteRoomStorage({ databasePath: healthyPath });
        const metadata = storage.getMetadata();
        storage.close();

        expect(() =>
            replaceCorruptSqliteStorageAtStartup({
                databasePath: healthyPath,
                ensureDirectory() {},
            }),
        ).toThrow(StorageInvariantError);

        const reopened = createSqliteRoomStorage({ databasePath: healthyPath });

        try {
            expect(reopened.getMetadata()).toEqual(metadata);
        } finally {
            reopened.close();
        }
    });

    it('retains a readable prior generation ID and old outbox state only in the archive', () => {
        const directory = temporaryDirectory();
        const databasePath = join(directory, 'room.sqlite');
        const oldStorage = createSqliteRoomStorage({ databasePath });
        const oldMetadata = oldStorage.getMetadata();
        oldStorage.transact((transaction) => {
            transaction.upsertCommandDispatchOutboxIntent({
                commandId: 'cmd-old',
                deviceId: 'led-main',
                commandType: 'set.power',
                requestedPower: 'on',
                target: 'simulator-adapter',
                state: 'ready',
                createdAt: '2026-09-09T10:00:00.000Z',
            });
        });
        oldStorage.upsertSimulatorCommandReceipt({
            source: 'simulator-led',
            commandId: 'cmd-old',
            updatedAt: '2026-09-09T10:00:00.000Z',
            receipt: { version: 1, state: 'pending' },
        });
        oldStorage.close();

        const replacement = replaceCorruptSqliteStorageAtStartup({
            databasePath,
            ensureDirectory() {},
            generateHistoryGenerationId: () => '33333333-3333-4333-8333-333333333333',
            generateArchiveId: () => 'readable-prior',
            now: () => '2026-09-09T10:01:00.000Z',
            inspectTarget() {
                throw new StorageManualInterventionError(
                    'operator-authorized test target',
                    undefined,
                );
            },
            readPreviousHistoryGeneration() {
                return oldMetadata.historyGenerationId;
            },
        });
        const archivedStorage = createSqliteRoomStorage({
            databasePath: join(replacement.preservedStoragePath, 'room.sqlite'),
        });
        const freshStorage = createSqliteRoomStorage({ databasePath });

        try {
            expect(replacement.previousHistoryGenerationId).toBe(oldMetadata.historyGenerationId);
            expect(archivedStorage.listCommandDispatchOutboxIntents()).toEqual([
                expect.objectContaining({ commandId: 'cmd-old' }),
            ]);
            expect(archivedStorage.listSimulatorCommandReceipts('simulator-led')).toEqual([
                expect.objectContaining({ commandId: 'cmd-old' }),
            ]);
            expect(freshStorage.getMetadata().historyGenerationId).toBe(
                '33333333-3333-4333-8333-333333333333',
            );
            expect(freshStorage.listCommandDispatchOutboxIntents()).toEqual([]);
            expect(freshStorage.listSimulatorCommandReceipts('simulator-led')).toEqual([]);
        } finally {
            archivedStorage.close();
            freshStorage.close();
        }
    });

    it('refuses pristine and fatal-schema targets without replacing them', () => {
        const directory = temporaryDirectory();
        const pristinePath = join(directory, 'pristine.sqlite');
        writeFileSync(pristinePath, '');

        expect(() =>
            replaceCorruptSqliteStorageAtStartup({
                databasePath: pristinePath,
                ensureDirectory() {},
            }),
        ).toThrow(StorageInvariantError);
        expect(readFileSync(pristinePath, 'utf8')).toBe('');

        const partialPath = join(directory, 'partial.sqlite');
        const partial = new DatabaseSync(partialPath);
        partial.exec('CREATE TABLE storage_metadata (history_generation_id TEXT NOT NULL) STRICT;');
        partial.close();

        expect(() =>
            replaceCorruptSqliteStorageAtStartup({
                databasePath: partialPath,
                ensureDirectory() {},
            }),
        ).toThrow(StorageSchemaError);
        const after = new DatabaseSync(partialPath, { readOnly: true });

        try {
            expect(
                after
                    .prepare("SELECT name FROM sqlite_schema WHERE name = 'storage_metadata'")
                    .get(),
            ).toBeDefined();
        } finally {
            after.close();
        }
    });
});

function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-storage-replacement-'));
    temporaryDirectories.push(directory);

    return directory;
}
