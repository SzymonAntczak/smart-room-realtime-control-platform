import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Logger } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { createSqliteRoomStorage } from '../platform/storage/sqlite-room-storage';

import { type BackendInstance, createBackendLogger, runBackend } from './backend-bootstrap';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

describe('backend bootstrap logging', () => {
    it('writes JSON startup, migration and Fastify request records at info', async () => {
        const capture = createLogCapture('info');
        const backend = await runBackend({
            environment: { SMART_ROOM_STORAGE_PATH: join(temporaryDirectory(), 'room.sqlite') },
            logger: capture.logger,
            port: 0,
            onStartupFailure(error) {
                throw error;
            },
        });

        try {
            expect(backend).toBeDefined();

            if (!backend) {
                return;
            }

            const response = await backend.server.inject({ method: 'GET', url: '/room' });

            expect(response.statusCode).toBe(200);
            expect(capture.records()).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        event: 'storage_migration_check_completed',
                        source: 'sqlite-storage',
                        schemaVersion: 4,
                    }),
                    expect.objectContaining({
                        event: 'backend_started',
                        source: 'backend',
                        port: expect.any(Number),
                    }),
                    expect.objectContaining({ req: expect.objectContaining({ method: 'GET' }) }),
                    expect.objectContaining({ res: expect.objectContaining({ statusCode: 200 }) }),
                ]),
            );
        } finally {
            await stopBackend(backend);
        }
    });

    it('suppresses info startup, migration and request records at warn', async () => {
        const capture = createLogCapture('warn');
        const backend = await runBackend({
            environment: {
                LOG_LEVEL: 'warn',
                SMART_ROOM_STORAGE_PATH: join(temporaryDirectory(), 'room.sqlite'),
            },
            logger: capture.logger,
            port: 0,
            onStartupFailure(error) {
                throw error;
            },
        });

        try {
            expect(backend).toBeDefined();

            if (!backend) {
                return;
            }

            await backend.server.inject({ method: 'GET', url: '/room' });

            expect(capture.records()).toEqual([]);
        } finally {
            await stopBackend(backend);
        }
    });

    it('logs a fatal JSON record and no migration success record for a fatal migration error', async () => {
        const databasePath = join(temporaryDirectory(), 'room.sqlite');
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        database
            .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
            .run('changed');
        database.close();
        const capture = createLogCapture('info');
        const failures: unknown[] = [];

        const backend = await runBackend({
            environment: { SMART_ROOM_STORAGE_PATH: databasePath },
            logger: capture.logger,
            onStartupFailure(error) {
                failures.push(error);
            },
        });

        expect(backend).toBeUndefined();
        expect(failures).toHaveLength(1);
        expect(capture.records()).toEqual([
            expect.objectContaining({
                event: 'backend_startup_failed',
                source: 'backend',
                level: 60,
            }),
        ]);
        expect(capture.records()).not.toContainEqual(
            expect.objectContaining({ event: 'storage_migration_check_completed' }),
        );
    });

    it('suppresses a fatal startup record when LOG_LEVEL is silent', async () => {
        const databasePath = join(temporaryDirectory(), 'room.sqlite');
        const storage = createSqliteRoomStorage({ databasePath });
        storage.close();
        const database = new DatabaseSync(databasePath);
        database
            .prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1')
            .run('changed');
        database.close();
        const capture = createLogCapture('silent');

        const backend = await runBackend({
            environment: { LOG_LEVEL: 'silent', SMART_ROOM_STORAGE_PATH: databasePath },
            logger: capture.logger,
            onStartupFailure() {},
        });

        expect(backend).toBeUndefined();
        expect(capture.records()).toEqual([]);
    });

    it('logs a fatal JSON configuration error before runtime initialization', async () => {
        const directory = temporaryDirectory();
        const capture = createLogCapture('info');
        const failures: unknown[] = [];

        const backend = await runBackend({
            environment: {
                LOG_LEVEL: 'INFO',
                SMART_ROOM_STORAGE_PATH: join(directory, 'room.sqlite'),
            },
            logger: capture.logger,
            onStartupFailure(error) {
                failures.push(error);
            },
        });

        expect(backend).toBeUndefined();
        expect(failures).toHaveLength(1);
        expect(capture.records()).toEqual([
            expect.objectContaining({
                event: 'backend_startup_failed',
                source: 'backend',
                level: 60,
            }),
        ]);
    });
});

function createLogCapture(logLevel: 'info' | 'warn' | 'silent'): {
    logger: Logger;
    records(): unknown[];
} {
    const lines: string[] = [];

    return {
        logger: createBackendLogger(logLevel, {
            write(line) {
                lines.push(line);
            },
        }),
        records() {
            return lines.map((line) => JSON.parse(line) as unknown);
        },
    };
}

async function stopBackend(backend: BackendInstance | undefined): Promise<void> {
    if (!backend) {
        return;
    }

    await backend.server.close();
    backend.runtime.stop();
}

function temporaryDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-backend-logging-'));
    temporaryDirectories.push(directory);

    return directory;
}
