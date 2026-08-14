import { describe, expect, it } from 'vitest';

import { defaultStorageDatabasePath, readStorageRuntimeConfig } from './storage-runtime-config';

describe('readStorageRuntimeConfig', () => {
    it('uses the gitignored local database path by default', () => {
        expect(readStorageRuntimeConfig({})).toEqual({ databasePath: defaultStorageDatabasePath });
    });

    it('uses an explicitly configured database path', () => {
        expect(
            readStorageRuntimeConfig({ SMART_ROOM_STORAGE_PATH: 'C:/state/smart-room.sqlite' }),
        ).toEqual({ databasePath: 'C:/state/smart-room.sqlite' });
    });
});
