import { createSqliteRoomStorageLifecycle } from '../platform/storage/sqlite-room-storage-lifecycle';
import {
    replaceCorruptSqliteStorageAtStartup,
    type StorageHistoryReplacement,
} from '../platform/storage/sqlite-room-storage-replacement';

import {
    ensureStorageDirectory,
    readStorageRuntimeConfig,
    readStorageStartupAction,
} from './storage-runtime-config';

export function resolveStorageRuntimeComposition({
    environment,
    argv,
    operationalLog,
}: {
    environment: NodeJS.ProcessEnv;
    argv: readonly string[];
    operationalLog: (entry: Record<string, unknown>) => void;
}) {
    const { databasePath, recoveryProbeIntervalMs, recoveryQueueLimit } =
        readStorageRuntimeConfig(environment);
    const startupAction = readStorageStartupAction(argv);

    if (startupAction === 'replace_corrupt_storage') {
        const replacement = replaceCorruptSqliteStorageAtStartup({
            databasePath,
            ensureDirectory: ensureStorageDirectory,
        });

        operationalLog(storageHistoryReplacedLog(replacement));
    }

    return {
        storageRecoveryProbeIntervalMs: recoveryProbeIntervalMs,
        storageRecoveryQueueLimit: recoveryQueueLimit,
        storageLifecycle: createSqliteRoomStorageLifecycle({
            databasePath,
            ensureDirectory: ensureStorageDirectory,
        }),
    };
}

export function storageHistoryReplacedLog(
    replacement: StorageHistoryReplacement,
): Record<string, unknown> {
    return {
        event: 'storage_history_replaced',
        source: 'storage-composition',
        reason: 'operator_authorized_corrupt_storage_replacement',
        replacedAt: replacement.replacedAt,
        databasePath: replacement.databasePath,
        preservedStoragePath: replacement.preservedStoragePath,
        newHistoryGenerationId: replacement.newHistoryGenerationId,
        ...(replacement.previousHistoryGenerationId
            ? { previousHistoryGenerationId: replacement.previousHistoryGenerationId }
            : {}),
    };
}
