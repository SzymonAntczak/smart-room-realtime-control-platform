import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteRoomStorage } from '../platform/storage/sqlite-room-storage';
import {
    replaceCorruptSqliteStorageAtStartup,
    type StorageHistoryReplacement,
} from '../platform/storage/sqlite-room-storage-replacement';
import { StorageManualInterventionError } from '../platform/storage/storage-errors';

import {
    resolveStorageRuntimeComposition,
    storageHistoryReplacedLog,
} from './storage-runtime-composition';
import { createTemperatureRoomRuntime } from './temperature-room-runtime';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

describe('storage runtime composition', () => {
    it('logs every replacement field when the prior generation remains readable', () => {
        const replacement: StorageHistoryReplacement = {
            replacedAt: '2026-09-09T12:00:00.000Z',
            databasePath: 'C:/storage/room.sqlite',
            preservedStoragePath: 'C:/storage/room.sqlite.replaced-archive',
            newHistoryGenerationId: 'new-generation',
            previousHistoryGenerationId: 'prior-generation',
        };

        expect(storageHistoryReplacedLog(replacement)).toEqual({
            event: 'storage_history_replaced',
            source: 'storage-composition',
            reason: 'operator_authorized_corrupt_storage_replacement',
            replacedAt: '2026-09-09T12:00:00.000Z',
            databasePath: 'C:/storage/room.sqlite',
            preservedStoragePath: 'C:/storage/room.sqlite.replaced-archive',
            newHistoryGenerationId: 'new-generation',
            previousHistoryGenerationId: 'prior-generation',
        });
    });

    it('keeps an invalid target degraded when replacement is not authorized', () => {
        const databasePath = join(temporaryDirectory(), 'room.sqlite');
        writeFileSync(databasePath, 'not a SQLite database');
        const logs: Record<string, unknown>[] = [];
        const composition = resolveStorageRuntimeComposition({
            environment: { SMART_ROOM_STORAGE_PATH: databasePath },
            argv: [],
            operationalLog(entry) {
                logs.push(entry);
            },
        });
        const startup = composition.storageLifecycle.openAtStartup();

        expect(startup).toEqual({
            kind: 'degraded',
            error: expect.objectContaining({ kind: 'manual_intervention' }),
        });
        expect(readFileSync(databasePath, 'utf8')).toBe('not a SQLite database');
        expect(logs).toEqual([]);
    });

    it('keeps missing storage as first initialization without a replacement log', () => {
        const databasePath = join(temporaryDirectory(), 'room.sqlite');
        const logs: Record<string, unknown>[] = [];
        const composition = resolveStorageRuntimeComposition({
            environment: { SMART_ROOM_STORAGE_PATH: databasePath },
            argv: [],
            operationalLog(entry) {
                logs.push(entry);
            },
        });
        const startup = composition.storageLifecycle.openAtStartup();

        try {
            expect(startup.kind).toBe('available');
            expect(logs).toEqual([
                {
                    event: 'storage_migration_check_completed',
                    source: 'sqlite-storage',
                    schemaVersion: 6,
                },
            ]);
            expect(existsSync(databasePath)).toBe(true);

            if (startup.kind === 'available') {
                expect(startup.storage.listSignificantFacts()).toEqual([]);
            }
        } finally {
            if (startup.kind === 'available') {
                startup.storage.close();
            }
        }
    });

    it('replaces an explicitly authorized invalid target and emits its operational log', () => {
        const databasePath = join(temporaryDirectory(), 'room.sqlite');
        writeFileSync(databasePath, 'not a SQLite database');
        const logs: Record<string, unknown>[] = [];
        const composition = resolveStorageRuntimeComposition({
            environment: { SMART_ROOM_STORAGE_PATH: databasePath },
            argv: ['--replace-corrupt-storage'],
            operationalLog(entry) {
                logs.push(entry);
            },
        });
        const startup = composition.storageLifecycle.openAtStartup();

        try {
            expect(startup.kind).toBe('available');
            expect(logs).toEqual([
                expect.objectContaining({
                    event: 'storage_history_replaced',
                    source: 'storage-composition',
                    reason: 'operator_authorized_corrupt_storage_replacement',
                    replacedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
                    databasePath,
                    newHistoryGenerationId: expect.any(String),
                    preservedStoragePath: expect.any(String),
                }),
                {
                    event: 'storage_migration_check_completed',
                    source: 'sqlite-storage',
                    schemaVersion: 6,
                },
            ]);

            if (startup.kind === 'available') {
                expect(startup.storage.listCommandDispatchOutboxIntents()).toEqual([]);
                expect(startup.storage.listSimulatorCommandReceipts('simulator-led')).toEqual([]);
                expect(startup.storage.listSignificantFacts()).toEqual([]);
            }
        } finally {
            if (startup.kind === 'available') {
                startup.storage.close();
            }
        }
    });

    it('does not redispatch archived outbox work when the replacement runtime starts', () => {
        const databasePath = join(temporaryDirectory(), 'room.sqlite');
        const oldStorage = createSqliteRoomStorage({ databasePath });
        const oldMetadata = oldStorage.getMetadata();
        oldStorage.transact((transaction) => {
            transaction.upsertCommandDispatchOutboxIntent({
                commandId: 'cmd-archived',
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
            commandId: 'cmd-archived',
            updatedAt: '2026-09-09T10:00:00.000Z',
            receipt: { version: 1, state: 'pending' },
        });
        oldStorage.close();

        const replacement = replaceCorruptSqliteStorageAtStartup({
            databasePath,
            ensureDirectory() {},
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
        const freshStorage = createSqliteRoomStorage({ databasePath });
        let scheduledOutcomes = 0;
        const runtime = createTemperatureRoomRuntime({
            storage: freshStorage,
            ledScenario: 'confirm_delayed',
            ledScenarioScheduler: {
                setTimeout() {
                    scheduledOutcomes += 1;

                    return scheduledOutcomes;
                },
                clearTimeout() {},
            },
        });

        try {
            runtime.start();

            expect(scheduledOutcomes).toBe(0);
            expect(runtime.getRoomSnapshot().activeCommands).toEqual([]);
            expect(runtime.getRoomSnapshot().recentCommands).toEqual([]);
        } finally {
            runtime.stop();
        }

        const archivedStorage = createSqliteRoomStorage({
            databasePath: join(replacement.preservedStoragePath, 'room.sqlite'),
        });

        try {
            expect(archivedStorage.listCommandDispatchOutboxIntents()).toEqual([
                expect.objectContaining({ commandId: 'cmd-archived' }),
            ]);
            expect(archivedStorage.listSimulatorCommandReceipts('simulator-led')).toEqual([
                expect.objectContaining({ commandId: 'cmd-archived' }),
            ]);
        } finally {
            archivedStorage.close();
        }
    });
});

function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-storage-composition-'));
    temporaryDirectories.push(directory);

    return directory;
}
