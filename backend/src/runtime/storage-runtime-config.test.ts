import { describe, expect, it } from 'vitest';

import {
    StorageAvailabilityError,
    StorageInvariantError,
} from '../platform/storage/storage-errors';

import {
    defaultStorageDatabasePath,
    ensureStorageDirectory,
    readStorageRuntimeConfig,
} from './storage-runtime-config';

describe('readStorageRuntimeConfig', () => {
    it('uses the gitignored local database path by default', () => {
        expect(readStorageRuntimeConfig({})).toEqual({
            databasePath: defaultStorageDatabasePath,
            recoveryProbeIntervalMs: 5_000,
            recoveryQueueLimit: 1_000,
        });
    });

    it('uses an explicitly configured database path', () => {
        expect(
            readStorageRuntimeConfig({ SMART_ROOM_STORAGE_PATH: 'C:/state/smart-room.sqlite' }),
        ).toEqual({
            databasePath: 'C:/state/smart-room.sqlite',
            recoveryProbeIntervalMs: 5_000,
            recoveryQueueLimit: 1_000,
        });
    });

    it('reads positive recovery probe and cutover queue limits', () => {
        expect(
            readStorageRuntimeConfig({
                SMART_ROOM_STORAGE_RECOVERY_PROBE_INTERVAL_MS: '250',
                SMART_ROOM_STORAGE_RECOVERY_QUEUE_LIMIT: '4',
            }),
        ).toMatchObject({ recoveryProbeIntervalMs: 250, recoveryQueueLimit: 4 });
    });

    it('classifies an unavailable database directory as an availability failure', () => {
        const unavailableDirectory = () => {
            throw Object.assign(new Error('read-only volume'), { code: 'EROFS' });
        };

        expect(() =>
            ensureStorageDirectory('C:/state/smart-room.sqlite', unavailableDirectory),
        ).toThrow(StorageAvailabilityError);
    });

    it('keeps unexpected directory initialization errors fatal', () => {
        const unexpectedDirectoryFailure = () => {
            throw new TypeError('invalid directory input');
        };

        expect(() =>
            ensureStorageDirectory('C:/state/smart-room.sqlite', unexpectedDirectoryFailure),
        ).toThrow(StorageInvariantError);
    });
});
