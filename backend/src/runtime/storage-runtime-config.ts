import { fileURLToPath } from 'node:url';

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
