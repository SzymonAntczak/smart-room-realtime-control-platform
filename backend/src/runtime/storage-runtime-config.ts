import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    StorageAvailabilityError,
    StorageInvariantError,
} from '../platform/storage/storage-errors';

export interface StorageRuntimeConfig {
    databasePath: string;
}

export const defaultStorageDatabasePath = fileURLToPath(
    new URL('../../../data/smart-room.sqlite', import.meta.url),
);

export function readStorageRuntimeConfig(environment: NodeJS.ProcessEnv): StorageRuntimeConfig {
    const configuredPath = environment.SMART_ROOM_STORAGE_PATH?.trim();

    return {
        databasePath: configuredPath || defaultStorageDatabasePath,
    };
}

export function ensureStorageDirectory(
    databasePath: string,
    makeDirectory: (path: string, options: { recursive: true }) => string | undefined = mkdirSync,
): void {
    try {
        makeDirectory(dirname(databasePath), { recursive: true });
    } catch (error) {
        if (isAvailabilityFilesystemError(error)) {
            throw new StorageAvailabilityError('Storage directory is unavailable.', error);
        }

        throw new StorageInvariantError('Storage directory initialization failed.', error);
    }
}

function isAvailabilityFilesystemError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }

    return (
        typeof error.code === 'string' &&
        ['EACCES', 'EBUSY', 'ENOENT', 'ENOSPC', 'ENOTDIR', 'EROFS'].includes(error.code)
    );
}
