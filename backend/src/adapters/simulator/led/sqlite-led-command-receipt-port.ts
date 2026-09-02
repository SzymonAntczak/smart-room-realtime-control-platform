import {
    isLedCommandReceiptV1,
    type LedCommandReceiptPort,
    type LedCommandReceiptV1,
    type LedReceiptOperationOutcome,
} from '@smart-room/simulator';

import type {
    RoomStorage,
    SimulatorCommandReceiptInput,
    StorageTransactionOutcome,
} from '../../../platform/storage/room-storage';
import { StorageInvariantError } from '../../../platform/storage/storage-errors';

export interface SqliteLedCommandReceiptPortConfig {
    readonly storage: RoomStorage;
    readonly clock: { now(): string };
}

export function createSqliteLedCommandReceiptPort({
    storage,
    clock,
}: SqliteLedCommandReceiptPortConfig): LedCommandReceiptPort {
    return {
        accept(candidate) {
            let phase: 'inspect' | 'commit' = 'inspect';
            const outcome = storage.transact((transaction) => {
                const existing = transaction.getSimulatorCommandReceipt(
                    candidate.source,
                    candidate.commandId,
                );

                if (existing) {
                    return { receipt: readReceipt(existing), inserted: false };
                }

                phase = 'commit';
                const inserted = transaction.insertSimulatorCommandReceipt(
                    toStorageInput(candidate),
                );

                if (!inserted) {
                    const raced = transaction.getSimulatorCommandReceipt(
                        candidate.source,
                        candidate.commandId,
                    );

                    if (!raced) {
                        throw new StorageInvariantError(
                            'Simulator receipt insert lost without an existing receipt.',
                            candidate,
                        );
                    }

                    return { receipt: readReceipt(raced), inserted: false };
                }

                transaction.retireTerminalSimulatorCommandReceipts({
                    source: candidate.source,
                    asOf: candidate.acceptedAt,
                });

                return { receipt: candidate, inserted: true };
            });

            return acceptTransactionOutcome(outcome, phase);
        },
        markTerminal(receipt) {
            const outcome = storage.transact((transaction) => {
                const existing = transaction.getSimulatorCommandReceipt(
                    receipt.source,
                    receipt.commandId,
                );

                if (!existing) {
                    throw new StorageInvariantError(
                        'Cannot mark a missing simulator receipt terminal.',
                        receipt,
                    );
                }

                const stored = readReceipt(existing);

                if (stored.fingerprint !== receipt.fingerprint) {
                    throw new StorageInvariantError(
                        'Simulator receipt fingerprint changed before terminal marker write.',
                        { stored, receipt },
                    );
                }

                transaction.updateSimulatorCommandReceipt(toStorageInput(receipt));
                transaction.retireTerminalSimulatorCommandReceipts({
                    source: receipt.source,
                    asOf: receipt.terminalAt ?? receipt.acceptedAt,
                });
            });

            return transactionOutcome(outcome);
        },
        list() {
            try {
                const retention = storage.transact((transaction) => {
                    transaction.retireTerminalSimulatorCommandReceipts({
                        source: 'simulator-led',
                        asOf: clock.now(),
                    });
                });

                if (retention.status !== 'committed') {
                    return transactionOutcome(retention);
                }

                return {
                    status: 'committed',
                    value: storage.listSimulatorCommandReceipts('simulator-led').map(readReceipt),
                };
            } catch (error) {
                return { status: 'inspection_unavailable', error };
            }
        },
    };
}

function toStorageInput(receipt: LedCommandReceiptV1): SimulatorCommandReceiptInput {
    return {
        source: receipt.source,
        commandId: receipt.commandId,
        updatedAt: receipt.terminalAt ?? receipt.acceptedAt,
        ...(receipt.terminalAt ? { terminalAt: receipt.terminalAt } : {}),
        receipt,
    };
}

function readReceipt(input: SimulatorCommandReceiptInput): LedCommandReceiptV1 {
    if (!isLedCommandReceiptV1(input.receipt)) {
        throw new StorageInvariantError('Stored simulator receipt has an invalid shape.', input);
    }

    return input.receipt;
}

function transactionOutcome<Value>(
    outcome: StorageTransactionOutcome<Value>,
): LedReceiptOperationOutcome<Value> {
    if (outcome.status === 'committed') {
        return outcome;
    }

    return outcome;
}

function acceptTransactionOutcome<Value>(
    outcome: StorageTransactionOutcome<Value>,
    phase: 'inspect' | 'commit',
): LedReceiptOperationOutcome<Value> {
    if (outcome.status !== 'confirmed_rolled_back' || phase !== 'inspect') {
        return transactionOutcome(outcome);
    }

    if (outcome.error instanceof StorageInvariantError) {
        return { status: 'indeterminate', error: outcome.error };
    }

    return { status: 'inspection_unavailable', error: outcome.error };
}
