import { createHash } from 'node:crypto';

import type { LedScenarioName } from './led-scenarios';
import type { LedCommandRejection, LedSetPowerCommand, LedStateReport } from './led-simulator';

export const ledReceiptSource = 'simulator-led' as const;

export type LedCommandPayloadFingerprint = `fp:v1:sha256:${string}`;

export interface LedPlannedStateOutcome {
    readonly kind: 'state_report';
    readonly dueAt: string;
    readonly message: LedStateReport;
}

export interface LedPlannedRejectionOutcome {
    readonly kind: 'command_rejection';
    readonly dueAt: string;
    readonly message: LedCommandRejection;
}

export type LedPlannedOutcome = LedPlannedStateOutcome | LedPlannedRejectionOutcome;

export interface LedCommandReceiptV1 {
    readonly version: 1;
    readonly source: typeof ledReceiptSource;
    readonly commandId: string;
    readonly fingerprint: LedCommandPayloadFingerprint;
    readonly command: LedSetPowerCommand;
    readonly scenario: LedScenarioName;
    readonly acceptedAt: string;
    readonly outcomes: readonly LedPlannedOutcome[];
    readonly terminalAt?: string;
}

export type LedReceiptFailureOperation = 'inspect' | 'accept' | 'mark_terminal' | 'restore';

export type LedReceiptOperationOutcome<Value> =
    | { readonly status: 'committed'; readonly value: Value }
    | { readonly status: 'confirmed_rolled_back'; readonly error: unknown }
    | { readonly status: 'inspection_unavailable'; readonly error: unknown }
    | { readonly status: 'indeterminate'; readonly error: unknown };

export interface LedCommandReceiptPort {
    accept(receipt: LedCommandReceiptV1): LedReceiptOperationOutcome<{
        readonly receipt: LedCommandReceiptV1;
        readonly inserted: boolean;
    }>;
    markTerminal(receipt: LedCommandReceiptV1): LedReceiptOperationOutcome<void>;
    list(): LedReceiptOperationOutcome<readonly LedCommandReceiptV1[]>;
}

export function fingerprintLedSetPowerCommand(
    command: LedSetPowerCommand,
): LedCommandPayloadFingerprint {
    return `fp:v1:sha256:${sha256(
        JSON.stringify({
            commandType: command.commandType,
            deviceId: command.deviceId,
            messageType: command.messageType,
            requestedState: { power: command.requestedState.power },
        }),
    )}`;
}

export function isLedCommandReceiptV1(value: unknown): value is LedCommandReceiptV1 {
    if (!isRecord(value) || value.version !== 1 || value.source !== ledReceiptSource) {
        return false;
    }

    if (
        typeof value.commandId !== 'string' ||
        typeof value.fingerprint !== 'string' ||
        typeof value.acceptedAt !== 'string' ||
        typeof value.scenario !== 'string' ||
        !isLedSetPowerCommand(value.command) ||
        !Array.isArray(value.outcomes)
    ) {
        return false;
    }

    return (
        (value.terminalAt === undefined || typeof value.terminalAt === 'string') &&
        value.outcomes.every(isLedPlannedOutcome)
    );
}

function isLedPlannedOutcome(value: unknown): value is LedPlannedOutcome {
    if (!isRecord(value) || typeof value.dueAt !== 'string') {
        return false;
    }

    if (value.kind === 'state_report') {
        return isLedStateReport(value.message);
    }

    return value.kind === 'command_rejection' && isLedCommandRejection(value.message);
}

function isLedSetPowerCommand(value: unknown): value is LedSetPowerCommand {
    return (
        isRecord(value) &&
        value.messageType === 'led.command.set_power' &&
        typeof value.commandId === 'string' &&
        typeof value.deviceId === 'string' &&
        value.commandType === 'set.power' &&
        isRecord(value.requestedState) &&
        (value.requestedState.power === 'on' || value.requestedState.power === 'off')
    );
}

function isLedStateReport(value: unknown): value is LedStateReport {
    return (
        isRecord(value) &&
        typeof value.messageId === 'string' &&
        value.messageType === 'led.state.reported' &&
        typeof value.deviceId === 'string' &&
        typeof value.sequence === 'number' &&
        isRecord(value.reportedState) &&
        (value.reportedState.power === 'on' || value.reportedState.power === 'off') &&
        typeof value.reportedAt === 'string'
    );
}

function isLedCommandRejection(value: unknown): value is LedCommandRejection {
    return (
        isRecord(value) &&
        typeof value.messageId === 'string' &&
        value.messageType === 'led.command.rejected' &&
        typeof value.commandId === 'string' &&
        typeof value.deviceId === 'string' &&
        value.reason === 'command_rejected' &&
        typeof value.rejectedAt === 'string'
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
