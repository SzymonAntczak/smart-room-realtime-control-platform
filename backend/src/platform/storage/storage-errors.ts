export type StorageFailureKind = 'availability' | 'manual_intervention' | 'fatal';

export class StorageError extends Error {
    readonly kind: StorageFailureKind;
    readonly cause: unknown;

    constructor(message: string, kind: StorageFailureKind, cause: unknown) {
        super(message);
        this.name = 'StorageError';
        this.kind = kind;
        this.cause = cause;
    }
}

export class StorageAvailabilityError extends StorageError {
    constructor(message: string, cause: unknown) {
        super(message, 'availability', cause);
        this.name = 'StorageAvailabilityError';
    }
}

export class StorageManualInterventionError extends StorageError {
    constructor(message: string, cause: unknown) {
        super(message, 'manual_intervention', cause);
        this.name = 'StorageManualInterventionError';
    }
}

export class StorageFatalError extends StorageError {
    readonly category: 'migration' | 'schema' | 'invariant';

    constructor(message: string, category: StorageFatalError['category'], cause: unknown) {
        super(message, 'fatal', cause);
        this.name = 'StorageFatalError';
        this.category = category;
    }
}

export class StorageMigrationError extends StorageFatalError {
    constructor(message: string, cause: unknown) {
        super(message, 'migration', cause);
        this.name = 'StorageMigrationError';
    }
}

export class StorageSchemaError extends StorageFatalError {
    constructor(message: string, cause: unknown) {
        super(message, 'schema', cause);
        this.name = 'StorageSchemaError';
    }
}

export class StorageInvariantError extends StorageFatalError {
    constructor(message: string, cause: unknown) {
        super(message, 'invariant', cause);
        this.name = 'StorageInvariantError';
    }
}

const sqliteAvailabilityCodes = new Set([5, 6, 8, 10, 13, 14]);
const sqliteManualInterventionCodes = new Set([11, 26]);

export function classifySqliteError(error: unknown): StorageError {
    if (error instanceof StorageError) {
        return error;
    }

    const sqliteCode = sqlitePrimaryCode(error);

    if (sqliteCode !== undefined && sqliteAvailabilityCodes.has(sqliteCode)) {
        return new StorageAvailabilityError(`SQLite availability failure: ${sqliteCode}.`, error);
    }

    if (sqliteCode !== undefined && sqliteManualInterventionCodes.has(sqliteCode)) {
        return new StorageManualInterventionError(
            `SQLite requires manual intervention: ${sqliteCode}.`,
            error,
        );
    }

    return new StorageInvariantError('Unexpected SQLite failure.', error);
}

function sqlitePrimaryCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('errcode' in error)) {
        return undefined;
    }

    const errcode = error.errcode;

    if (typeof errcode !== 'number' || !Number.isInteger(errcode) || errcode < 0) {
        return undefined;
    }

    return errcode & 0xff;
}
