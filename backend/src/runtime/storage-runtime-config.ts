import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    StorageAvailabilityError,
    StorageInvariantError,
} from '../platform/storage/storage-errors';

export interface StorageRuntimeConfig {
    databasePath: string;
    recoveryProbeIntervalMs: number;
    recoveryQueueLimit: number;
}

export const defaultStorageDatabasePath = fileURLToPath(
    new URL('../../../data/smart-room.sqlite', import.meta.url),
);

export function readStorageRuntimeConfig(environment: NodeJS.ProcessEnv): StorageRuntimeConfig {
    const configuredPath = environment.SMART_ROOM_STORAGE_PATH?.trim();

    return {
        databasePath: configuredPath || defaultStorageDatabasePath,
        recoveryProbeIntervalMs: readPositiveInteger(
            environment.SMART_ROOM_STORAGE_RECOVERY_PROBE_INTERVAL_MS,
            5_000,
            'SMART_ROOM_STORAGE_RECOVERY_PROBE_INTERVAL_MS',
        ),
        recoveryQueueLimit: readPositiveInteger(
            environment.SMART_ROOM_STORAGE_RECOVERY_QUEUE_LIMIT,
            1_000,
            'SMART_ROOM_STORAGE_RECOVERY_QUEUE_LIMIT',
        ),
    };
}

function readPositiveInteger(
    configuredValue: string | undefined,
    fallback: number,
    name: string,
): number {
    if (configuredValue === undefined || configuredValue.trim() === '') {
        return fallback;
    }

    const parsed = Number(configuredValue);

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new RangeError(`${name} must be a positive integer.`);
    }

    return parsed;
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
