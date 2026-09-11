import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
    selectRecentCommands,
    type TerminalCommandProjection,
} from '@smart-room/contracts/commands';
import { isRoomSnapshotProjection } from '@smart-room/contracts/realtime';

import { StorageMigrationError } from './storage-errors';

const latestCheckpointVersion = 4;

/** Migrates the JSON document stored in the singleton room-projection row. */
export function migrateLatestRoomProjectionCheckpoint(database: DatabaseSync): void {
    const row = database
        .prepare('SELECT projection_json FROM latest_room_projection WHERE id = 1')
        .get();

    if (row === undefined) {
        return;
    }

    const storedRow = record(row, 'latest room projection row');
    const serializedCheckpoint = stringField(storedRow, 'projection_json');
    const checkpoint = parseCheckpoint(serializedCheckpoint);

    const migratedBeforeRecordIdentity =
        checkpoint.checkpointVersion === latestCheckpointVersion
            ? checkpoint
            : checkpoint.checkpointVersion === 3
              ? migrateVersionThreeCheckpoint(checkpoint)
              : checkpoint.checkpointVersion === 2
                ? migrateVersionTwoCheckpoint(checkpoint)
                : checkpoint.checkpointVersion === 1
                  ? migrateVersionOneCheckpoint(checkpoint)
                  : 'checkpointVersion' in checkpoint
                    ? unsupportedCheckpointVersion(checkpoint.checkpointVersion)
                    : migrateVersionZeroCheckpoint(checkpoint);
    const migrated = rewriteLegacyRecentEventRecordIds(migratedBeforeRecordIdentity);

    assertMigratedCheckpointIsValid(migrated);

    if (JSON.stringify(migrated) === serializedCheckpoint) {
        return;
    }

    try {
        database.exec('BEGIN IMMEDIATE');
        database
            .prepare('UPDATE latest_room_projection SET projection_json = ? WHERE id = 1')
            .run(JSON.stringify(migrated));
        database.exec('COMMIT');
    } catch (error) {
        rollbackMigration(database, error);
    }
}

function rewriteLegacyRecentEventRecordIds(
    checkpoint: Record<string, unknown>,
): Record<string, unknown> {
    const recentEvents = array(checkpoint.recentEvents, 'checkpoint recent events');

    return {
        ...checkpoint,
        recentEvents: recentEvents.map((event) => {
            const storedEvent = record(event, 'checkpoint recent event');
            const recordId = nonEmptyStringField(storedEvent, 'recordId');

            if (!recordId.startsWith('platform:storage-gap:')) {
                return storedEvent;
            }

            const operationKey = recordId.slice('platform:storage-gap:'.length);

            if (operationKey.length === 0) {
                throw new StorageMigrationError(
                    'Legacy storage-gap checkpoint record has no operation key.',
                    storedEvent,
                );
            }

            return { ...storedEvent, recordId: platformRecordId(operationKey) };
        }),
    };
}

function platformRecordId(operationKey: string): string {
    const canonicalIdentity = JSON.stringify({
        family: 'platform',
        operationKey,
        recordKind: 'storage.gap.recorded',
    });

    return `rec:v1:sha256:${createHash('sha256').update(canonicalIdentity).digest('hex')}`;
}

function migrateVersionZeroCheckpoint(
    checkpoint: Record<string, unknown>,
): Record<string, unknown> {
    const projection = record(checkpoint.projection, 'version 0 checkpoint projection');
    const activeCommands = array(projection.activeCommands, 'version 0 active commands');
    const recentCommands = array(projection.recentCommands, 'version 0 recent commands');
    const devices = array(projection.devices, 'version 0 devices');

    const migratedActiveCommands = activeCommands.map((command) => migrateCommand(command));

    return {
        ...normalizeRecentCommands(
            normalizeActiveCommandIds({
                ...checkpoint,
                checkpointVersion: latestCheckpointVersion,
                projection: {
                    ...projection,
                    activeCommands: migratedActiveCommands,
                    recentCommands: recentCommands.map((command) => migrateCommand(command)),
                    devices,
                },
            }),
        ),
        recentEvents: [],
    };
}

function migrateVersionOneCheckpoint(checkpoint: Record<string, unknown>): Record<string, unknown> {
    return {
        ...normalizeRecentCommands(
            normalizeActiveCommandIds({
                ...checkpoint,
                checkpointVersion: latestCheckpointVersion,
            }),
        ),
        recentEvents: [],
    };
}

function migrateVersionTwoCheckpoint(checkpoint: Record<string, unknown>): Record<string, unknown> {
    return {
        ...normalizeRecentCommands({ ...checkpoint, checkpointVersion: latestCheckpointVersion }),
        recentEvents: [],
    };
}

function migrateVersionThreeCheckpoint(
    checkpoint: Record<string, unknown>,
): Record<string, unknown> {
    return normalizeRecentCommands({ ...checkpoint, checkpointVersion: latestCheckpointVersion });
}

function unsupportedCheckpointVersion(checkpointVersion: unknown): never {
    throw new StorageMigrationError('Stored room projection checkpoint version is unsupported.', {
        checkpointVersion,
    });
}

function normalizeActiveCommandIds(checkpoint: Record<string, unknown>): Record<string, unknown> {
    const projection = record(checkpoint.projection, 'checkpoint projection');
    const activeCommands = array(projection.activeCommands, 'checkpoint active commands');
    const devices = array(projection.devices, 'checkpoint devices');
    const activeCommandIdsByDevice = new Map<string, string>();

    for (const activeCommand of activeCommands) {
        const command = record(activeCommand, 'checkpoint active command');
        const deviceId = nonEmptyStringField(command, 'deviceId');
        const commandId = nonEmptyStringField(command, 'commandId');

        if (activeCommandIdsByDevice.has(deviceId)) {
            throw new StorageMigrationError(
                'Checkpoint has multiple active commands for one device.',
                command,
            );
        }

        activeCommandIdsByDevice.set(deviceId, commandId);
    }

    return {
        ...checkpoint,
        projection: {
            ...projection,
            devices: devices.map((device) => {
                const storedDevice = record(device, 'checkpoint device');
                const deviceId = nonEmptyStringField(storedDevice, 'deviceId');
                const activeCommandId = activeCommandIdsByDevice.get(deviceId);
                const deviceWithoutActiveCommand = { ...storedDevice };

                delete deviceWithoutActiveCommand.activeCommandId;

                return {
                    ...deviceWithoutActiveCommand,
                    ...(activeCommandId === undefined ? {} : { activeCommandId }),
                };
            }),
        },
    };
}

function normalizeRecentCommands(checkpoint: Record<string, unknown>): Record<string, unknown> {
    const projection = record(checkpoint.projection, 'checkpoint projection');
    const recentCommands = array(projection.recentCommands, 'checkpoint recent commands').map(
        toTerminalCommandProjection,
    );

    return {
        ...checkpoint,
        projection: {
            ...projection,
            recentCommands: selectRecentCommands(recentCommands),
        },
    };
}

function toTerminalCommandProjection(value: unknown): TerminalCommandProjection {
    const command = record(value, 'checkpoint terminal command');
    const status = nonEmptyStringField(command, 'status');
    nonEmptyStringField(command, 'commandId');

    switch (status) {
        case 'confirmed':
            stringField(command, 'confirmedAt');
            break;
        case 'failed':
            stringField(command, 'failedAt');
            break;
        case 'timed_out':
            stringField(command, 'timedOutAt');
            break;
        default:
            throw new StorageMigrationError(
                'Checkpoint recent command has an unsupported terminal status.',
                command,
            );
    }

    return command as unknown as TerminalCommandProjection;
}

function migrateCommand(value: unknown): Record<string, unknown> {
    const command = record(value, 'version 0 command');
    const status = nonEmptyStringField(command, 'status');
    const hasDelivery = 'delivery' in command;
    const hasDispatchedAt = 'dispatchedAt' in command;
    const hasDeadlineAt = 'deadlineAt' in command;

    if (!['accepted', 'pending', 'confirmed', 'failed', 'timed_out'].includes(status)) {
        throw new StorageMigrationError('Version 0 command has an unsupported status.', command);
    }

    if (hasDelivery && (hasDispatchedAt || hasDeadlineAt)) {
        throw new StorageMigrationError(
            'Version 0 command has conflicting delivery representations.',
            command,
        );
    }

    if (hasDelivery) {
        return command;
    }

    const requiresDelivery = ['pending', 'confirmed', 'timed_out'].includes(status);

    if (!hasDispatchedAt && !hasDeadlineAt) {
        if (requiresDelivery) {
            throw new StorageMigrationError(
                'Version 0 command is missing delivery evidence.',
                command,
            );
        }

        return command;
    }

    if (!hasDispatchedAt || !hasDeadlineAt) {
        throw new StorageMigrationError(
            'Version 0 command has incomplete delivery evidence.',
            command,
        );
    }

    const { dispatchedAt, deadlineAt, ...commandWithoutLegacyDelivery } = command;

    if (typeof dispatchedAt !== 'string' || typeof deadlineAt !== 'string') {
        throw new StorageMigrationError(
            'Version 0 command has invalid delivery evidence.',
            command,
        );
    }

    return {
        ...commandWithoutLegacyDelivery,
        delivery: { status: 'handed_off', dispatchedAt, deadlineAt },
    };
}

function assertMigratedCheckpointIsValid(checkpoint: Record<string, unknown>): void {
    const projection = record(checkpoint.projection, 'migrated checkpoint projection');

    if (!isProjectionEvidence(checkpoint.projectionEvidence)) {
        throw new StorageMigrationError(
            'Migrated room projection checkpoint has invalid evidence.',
            checkpoint.projectionEvidence,
        );
    }

    if (!isVolatileGuards(checkpoint.volatileGuards)) {
        throw new StorageMigrationError(
            'Migrated room projection checkpoint has invalid volatile guards.',
            checkpoint.volatileGuards,
        );
    }

    if (
        !isRoomSnapshotProjection({
            roomName: 'Checkpoint migration validation',
            updatedAt: projection.updatedAt,
            devices: projection.devices,
            activeCommands: projection.activeCommands,
            recentCommands: projection.recentCommands,
            recentEvents: checkpoint.recentEvents,
            platform: {
                storage: {
                    status: 'available',
                    changedAt: projection.updatedAt,
                    historyGenerationId: 'checkpoint-migration-validation',
                    storedThroughSequence: 0,
                },
            },
        })
    ) {
        throw new StorageMigrationError(
            'Migrated room projection checkpoint has invalid projection semantics.',
            projection,
        );
    }
}

function isProjectionEvidence(value: unknown): boolean {
    return (
        isRecord(value) &&
        Array.isArray(value.availabilityDeviceIds) &&
        value.availabilityDeviceIds.every((deviceId) => typeof deviceId === 'string') &&
        Array.isArray(value.healthDeviceIds) &&
        value.healthDeviceIds.every((deviceId) => typeof deviceId === 'string') &&
        (value.commandConfirmationSources === undefined ||
            (Array.isArray(value.commandConfirmationSources) &&
                value.commandConfirmationSources.every(
                    (source) =>
                        isRecord(source) &&
                        typeof source.commandId === 'string' &&
                        typeof source.eventId === 'string',
                )))
    );
}

function isVolatileGuards(value: unknown): boolean {
    return (
        Array.isArray(value) &&
        value.every(
            (guard) =>
                isRecord(guard) &&
                typeof guard.eventId === 'string' &&
                typeof guard.fingerprint === 'string' &&
                guard.durability === 'volatile' &&
                typeof guard.acceptedAt === 'string',
        )
    );
}

function rollbackMigration(database: DatabaseSync, error: unknown): never {
    if (database.isTransaction) {
        try {
            database.exec('ROLLBACK');
        } catch (rollbackError) {
            throw new StorageMigrationError(
                'Room projection checkpoint migration rollback failed.',
                rollbackError,
            );
        }
    }

    throw new StorageMigrationError('Room projection checkpoint migration failed.', error);
}

function parseCheckpoint(value: string): Record<string, unknown> {
    try {
        return record(JSON.parse(value), 'room projection checkpoint');
    } catch (error) {
        throw new StorageMigrationError(
            'Stored room projection checkpoint JSON is invalid.',
            error,
        );
    }
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new StorageMigrationError(`Stored ${label} has an invalid shape.`, value);
    }

    return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new StorageMigrationError(`Stored ${label} has an invalid shape.`, value);
    }

    return value;
}

function stringField(value: Record<string, unknown>, field: string): string {
    const fieldValue = value[field];

    if (typeof fieldValue !== 'string') {
        throw new StorageMigrationError(`Stored value has an invalid ${field} field.`, value);
    }

    return fieldValue;
}

function nonEmptyStringField(value: Record<string, unknown>, field: string): string {
    const fieldValue = stringField(value, field);

    if (fieldValue.length === 0) {
        throw new StorageMigrationError(`Stored value has an empty ${field} field.`, value);
    }

    return fieldValue;
}
