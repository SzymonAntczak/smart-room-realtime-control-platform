import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { LedCommandReceiptV1 } from '@smart-room/simulator';
import { afterEach, describe, expect, it } from 'vitest';

import type { RoomStorage, RoomStorageTransaction } from '../../../platform/storage/room-storage';
import { createSqliteRoomStorage } from '../../../platform/storage/sqlite-room-storage';

import { createSqliteLedCommandReceiptPort } from './sqlite-led-command-receipt-port';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

describe('SQLite LED command receipt port', () => {
    it('atomically stores, reuses and marks a durable receipt', () => {
        const storage = createSqliteRoomStorage({ databasePath: temporaryDatabasePath() });
        const port = createSqliteLedCommandReceiptPort({
            storage,
            clock: { now: () => '2026-08-05T10:00:00.000Z' },
        });
        const receipt = plannedReceipt();

        expect(port.accept(receipt)).toEqual({
            status: 'committed',
            value: { receipt, inserted: true },
        });
        expect(port.accept({ ...receipt, fingerprint: 'fp:v1:sha256:other' })).toEqual({
            status: 'committed',
            value: { receipt, inserted: false },
        });

        const terminal = { ...receipt, terminalAt: '2026-08-05T10:00:01.000Z' };
        expect(port.markTerminal(terminal)).toEqual({ status: 'committed', value: undefined });
        expect(port.list()).toEqual({ status: 'committed', value: [terminal] });
        storage.close();
    });

    it('classifies an unreadable possible prior acceptance as uncertain inspection', () => {
        const port = createSqliteLedCommandReceiptPort({
            storage: failingStorage('inspect'),
            clock: { now: () => '2026-08-05T10:00:00.000Z' },
        });

        expect(port.accept(plannedReceipt())).toMatchObject({
            status: 'inspection_unavailable',
        });
    });

    it('classifies a failed current receipt commit as definite no-handoff', () => {
        const port = createSqliteLedCommandReceiptPort({
            storage: failingStorage('commit'),
            clock: { now: () => '2026-08-05T10:00:00.000Z' },
        });

        expect(port.accept(plannedReceipt())).toMatchObject({ status: 'confirmed_rolled_back' });
    });

    it('preserves an indeterminate current receipt commit as fatal uncertainty', () => {
        const port = createSqliteLedCommandReceiptPort({
            storage: failingStorage('commit', 'indeterminate'),
            clock: { now: () => '2026-08-05T10:00:00.000Z' },
        });

        expect(port.accept(plannedReceipt())).toMatchObject({ status: 'indeterminate' });
    });
});

function failingStorage(
    failureAt: 'inspect' | 'commit',
    status: 'confirmed_rolled_back' | 'indeterminate' = 'confirmed_rolled_back',
): RoomStorage {
    return {
        transact(callback) {
            const transaction = {
                getSimulatorCommandReceipt() {
                    if (failureAt === 'inspect') {
                        throw new Error('storage unavailable');
                    }

                    return undefined;
                },
                insertSimulatorCommandReceipt() {
                    throw new Error('storage unavailable');
                },
            } as unknown as RoomStorageTransaction;

            try {
                callback(transaction);
            } catch (error) {
                return { status, error };
            }

            return { status: 'committed', value: undefined };
        },
    } as RoomStorage;
}

function plannedReceipt(): LedCommandReceiptV1 {
    return {
        version: 1,
        source: 'simulator-led',
        commandId: 'cmd-1',
        fingerprint: 'fp:v1:sha256:expected',
        command: {
            messageType: 'led.command.set_power',
            commandId: 'cmd-1',
            deviceId: 'led-main-native',
            commandType: 'set.power',
            requestedState: { power: 'on' },
        },
        scenario: 'confirm_immediately',
        acceptedAt: '2026-08-05T10:00:00.000Z',
        outcomes: [
            {
                kind: 'state_report',
                dueAt: '2026-08-05T10:00:00.000Z',
                message: {
                    messageId: 'simulator-led:led-main-native:cmd-1:state_report',
                    messageType: 'led.state.reported',
                    deviceId: 'led-main-native',
                    sequence: 1,
                    reportedState: { power: 'on' },
                    reportedAt: '2026-08-05T10:00:00.000Z',
                },
            },
        ],
    };
}

function temporaryDatabasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'smart-room-led-receipt-'));
    temporaryDirectories.push(directory);

    return join(directory, 'room.sqlite');
}
