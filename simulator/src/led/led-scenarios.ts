import {
    fingerprintLedSetPowerCommand,
    type LedCommandReceiptPort,
    type LedCommandReceiptV1,
    type LedPlannedOutcome,
    type LedReceiptFailureOperation,
    ledReceiptSource,
} from './led-command-receipts';
import {
    createLedSimulator,
    type LedAvailabilityListener,
    type LedAvailabilityReport,
    type LedCommandListener,
    type LedCommandRejectionListener,
    type LedHealthListener,
    type LedHealthReport,
    type LedSetPowerCommand,
    type LedSimulator,
    type LedSimulatorConfig,
    type LedStateReport,
    type LedStateReportListener,
} from './led-simulator';

export type LedScenarioName =
    | 'confirm_immediately'
    | 'confirm_delayed'
    | 'reject_command'
    | 'omit_confirmation'
    | 'report_after_timeout';

export interface LedScenarioClock {
    now(): string;
}

export interface LedScenarioScheduler<TimerHandle = unknown> {
    setTimeout(callback: () => void, delayMs: number): TimerHandle;
    clearTimeout(timerHandle: TimerHandle): void;
}

export type LedDeliveryKind = 'durable_outbox' | 'volatile';

export interface LedReceiveContext {
    readonly deliveryKind: LedDeliveryKind;
    readonly attemptedAt: string;
}

export type LedCommandReceiveResult =
    | { readonly status: 'accepted'; readonly acceptedAt: string }
    | {
          readonly status: 'not_accepted';
          readonly reason: 'source_command_identity_conflict' | 'receipt_not_accepted';
      }
    | { readonly status: 'uncertain'; readonly reason: 'receipt_prior_acceptance_unknown' };

export interface LedReceiptFailure {
    readonly operation: LedReceiptFailureOperation;
    readonly commandId: string;
    readonly error: unknown;
    readonly outcome: 'confirmed_rolled_back' | 'inspection_unavailable' | 'indeterminate';
}

export interface LedScenarioConfig<TimerHandle = unknown> extends LedSimulatorConfig {
    readonly scenario: LedScenarioName;
    readonly clock: LedScenarioClock;
    readonly scheduler: LedScenarioScheduler<TimerHandle>;
    readonly receiptPort?: LedCommandReceiptPort;
    readonly onReceiptFailure?: (failure: LedReceiptFailure) => void;
}

export interface LedScenario extends Pick<LedSimulator, 'getObservedPower'> {
    onCommand(listener: LedCommandListener): () => void;
    onStateReport(listener: LedStateReportListener): () => void;
    onCommandRejection(listener: LedCommandRejectionListener): () => void;
    onAvailability(listener: LedAvailabilityListener): () => void;
    onHealth(listener: LedHealthListener): () => void;
    receive(command: LedSetPowerCommand, context?: LedReceiveContext): LedCommandReceiveResult;
    reportAvailability(
        availability: 'online' | 'offline',
        reportedAt: string,
    ): LedAvailabilityReport;
    reportHealth(
        health: 'healthy' | 'degraded',
        reason: string,
        reportedAt: string,
    ): LedHealthReport;
    reportCurrentState(reportedAt: string): LedStateReport;
    setNextCommandScenario(scenario: LedScenarioName): void;
    restoreDurablePlans(): void;
    resumeAfterStorageRecovery(): void;
    stop(): void;
}

export function createLedScenario<TimerHandle = unknown>({
    scenario: defaultScenario,
    clock,
    scheduler,
    receiptPort,
    onReceiptFailure,
    ...simulatorConfig
}: LedScenarioConfig<TimerHandle>): LedScenario {
    assertScenario(defaultScenario);
    const simulator = createLedSimulator(simulatorConfig);
    let nextScenario = defaultScenario;
    let nextPlannedSequence = 0;
    const scheduledTimers = new Map<string, TimerHandle>();
    const emittedOutcomeIds = new Set<string>();
    const durableReceipts = new Map<string, LedCommandReceiptV1>();
    const volatileReceipts = new Map<string, LedCommandReceiptV1>();
    const pendingTerminalMarkers = new Map<string, LedCommandReceiptV1>();

    return {
        ...simulator,
        receive(command, context = { deliveryKind: 'volatile', attemptedAt: clock.now() }) {
            const fingerprint = fingerprintLedSetPowerCommand(command);

            if (context.deliveryKind === 'volatile') {
                const existing = volatileReceipts.get(command.commandId);

                if (existing) {
                    return resumeExisting(existing, fingerprint, false);
                }

                const receipt = createReceipt(
                    command,
                    fingerprint,
                    nextScenario,
                    context.attemptedAt,
                );
                volatileReceipts.set(command.commandId, receipt);
                advancePlannedSequence(receipt);
                nextScenario = defaultScenario;
                scheduleReceipt(receipt, false);

                return { status: 'accepted', acceptedAt: receipt.acceptedAt };
            }

            if (!receiptPort) {
                throw new Error('Durable LED command delivery requires a receipt port.');
            }

            const candidate = createReceipt(
                command,
                fingerprint,
                nextScenario,
                context.attemptedAt,
            );
            const accepted = receiptPort.accept(candidate);

            if (accepted.status === 'committed') {
                const receipt = accepted.value.receipt;

                if (receipt.fingerprint !== fingerprint) {
                    return { status: 'not_accepted', reason: 'source_command_identity_conflict' };
                }

                durableReceipts.set(receipt.commandId, receipt);
                advancePlannedSequence(receipt);

                if (accepted.value.inserted) {
                    nextScenario = defaultScenario;
                }

                scheduleReceipt(receipt, true);

                return { status: 'accepted', acceptedAt: receipt.acceptedAt };
            }

            reportReceiptFailure('accept', command.commandId, accepted);

            if (accepted.status === 'confirmed_rolled_back') {
                return { status: 'not_accepted', reason: 'receipt_not_accepted' };
            }

            if (accepted.status === 'inspection_unavailable') {
                return { status: 'uncertain', reason: 'receipt_prior_acceptance_unknown' };
            }

            throw new Error('LED receipt commit outcome is unknown.', { cause: accepted.error });
        },
        reportCurrentState(reportedAt) {
            return simulator.reportState(simulator.getObservedPower(), reportedAt);
        },
        setNextCommandScenario(scenario) {
            assertScenario(scenario);
            nextScenario = scenario;
        },
        restoreDurablePlans() {
            if (!receiptPort) {
                return;
            }

            const listed = receiptPort.list();

            if (listed.status !== 'committed') {
                reportReceiptFailure('restore', 'unknown', listed);

                if (listed.status === 'indeterminate') {
                    throw new Error('LED receipt restore outcome is unknown.', {
                        cause: listed.error,
                    });
                }

                return;
            }

            for (const receipt of listed.value) {
                durableReceipts.set(receipt.commandId, receipt);
                advancePlannedSequence(receipt);

                scheduleReceipt(receipt, true, true);
            }
        },
        resumeAfterStorageRecovery() {
            if (!receiptPort) {
                return;
            }

            for (const receipt of pendingTerminalMarkers.values()) {
                const outcome = receiptPort.markTerminal(receipt);

                if (outcome.status === 'committed') {
                    durableReceipts.set(receipt.commandId, receipt);
                    pendingTerminalMarkers.delete(receipt.commandId);
                    continue;
                }

                reportReceiptFailure('mark_terminal', receipt.commandId, outcome);

                if (outcome.status === 'indeterminate') {
                    throw new Error('LED receipt terminal outcome is unknown.', {
                        cause: outcome.error,
                    });
                }
            }
        },
        stop() {
            for (const timerHandle of scheduledTimers.values()) {
                scheduler.clearTimeout(timerHandle);
            }

            scheduledTimers.clear();
        },
    };

    function resumeExisting(
        receipt: LedCommandReceiptV1,
        fingerprint: ReturnType<typeof fingerprintLedSetPowerCommand>,
        durable: boolean,
    ): LedCommandReceiveResult {
        if (receipt.fingerprint !== fingerprint) {
            return { status: 'not_accepted', reason: 'source_command_identity_conflict' };
        }

        scheduleReceipt(receipt, durable);

        return { status: 'accepted', acceptedAt: receipt.acceptedAt };
    }

    function createReceipt(
        command: LedSetPowerCommand,
        fingerprint: ReturnType<typeof fingerprintLedSetPowerCommand>,
        scenario: LedScenarioName,
        acceptedAt: string,
    ): LedCommandReceiptV1 {
        const outcome = plannedOutcome(command, scenario, acceptedAt, nextPlannedSequence + 1);

        return {
            version: 1,
            source: ledReceiptSource,
            commandId: command.commandId,
            fingerprint,
            command: structuredClone(command),
            scenario,
            acceptedAt,
            outcomes: outcome ? [outcome] : [],
            ...(outcome ? {} : { terminalAt: acceptedAt }),
        };
    }

    function plannedOutcome(
        command: LedSetPowerCommand,
        scenario: LedScenarioName,
        acceptedAt: string,
        sequence: number,
    ): LedPlannedOutcome | undefined {
        switch (scenario) {
            case 'confirm_immediately':
                return plannedStateOutcome(command, acceptedAt, 0, sequence);
            case 'confirm_delayed':
                return plannedStateOutcome(command, acceptedAt, 2_000, sequence);
            case 'report_after_timeout':
                return plannedStateOutcome(command, acceptedAt, 6_000, sequence);

            case 'reject_command':
                return {
                    kind: 'command_rejection',
                    dueAt: acceptedAt,
                    message: {
                        messageId: `${ledReceiptSource}:${command.deviceId}:${command.commandId}:command_rejection`,
                        messageType: 'led.command.rejected',
                        commandId: command.commandId,
                        deviceId: command.deviceId,
                        reason: 'command_rejected',
                        rejectedAt: acceptedAt,
                    },
                };
            case 'omit_confirmation':
                return undefined;
        }
    }

    function plannedStateOutcome(
        command: LedSetPowerCommand,
        acceptedAt: string,
        delayMs: number,
        sequence: number,
    ): LedPlannedOutcome {
        const dueAt = new Date(Date.parse(acceptedAt) + delayMs).toISOString();

        return {
            kind: 'state_report',
            dueAt,
            message: {
                messageId: `${ledReceiptSource}:${command.deviceId}:${command.commandId}:state_report`,
                messageType: 'led.state.reported',
                deviceId: command.deviceId,
                sequence,
                reportedState: { power: command.requestedState.power },
                reportedAt: dueAt,
            },
        };
    }

    function scheduleReceipt(
        receipt: LedCommandReceiptV1,
        durable: boolean,
        restoring = false,
    ): void {
        if (receipt.terminalAt && !restoring) {
            return;
        }

        for (const outcome of receipt.outcomes) {
            const timerKey = `${receipt.commandId}:${outcome.message.messageId}`;

            if (scheduledTimers.has(timerKey) || emittedOutcomeIds.has(outcome.message.messageId)) {
                continue;
            }

            const delayMs = Math.max(0, Date.parse(outcome.dueAt) - Date.parse(clock.now()));

            if (delayMs === 0) {
                deliverOutcome(receipt, outcome, durable);
                continue;
            }

            const timerHandle = scheduler.setTimeout(() => {
                scheduledTimers.delete(timerKey);
                deliverOutcome(receipt, outcome, durable);
            }, delayMs);
            scheduledTimers.set(timerKey, timerHandle);
        }
    }

    function deliverOutcome(
        receipt: LedCommandReceiptV1,
        outcome: LedPlannedOutcome,
        durable: boolean,
    ): void {
        if (emittedOutcomeIds.has(outcome.message.messageId)) {
            return;
        }

        if (durable && !receipt.terminalAt) {
            if (!receiptPort) {
                throw new Error('Durable LED outcome requires a receipt port.');
            }

            const terminalReceipt = { ...receipt, terminalAt: clock.now() };
            const marked = receiptPort.markTerminal(terminalReceipt);

            if (marked.status === 'committed') {
                durableReceipts.set(receipt.commandId, terminalReceipt);
                emitOutcome(outcome);

                return;
            }

            reportReceiptFailure('mark_terminal', receipt.commandId, marked);

            if (marked.status === 'confirmed_rolled_back') {
                pendingTerminalMarkers.set(receipt.commandId, terminalReceipt);
                emitOutcome(outcome);

                return;
            }

            throw new Error('LED receipt terminal outcome is unknown.', { cause: marked.error });
        }

        emitOutcome(outcome);
    }

    function emitOutcome(outcome: LedPlannedOutcome): void {
        if (emittedOutcomeIds.has(outcome.message.messageId)) {
            return;
        }

        emittedOutcomeIds.add(outcome.message.messageId);

        if (outcome.kind === 'state_report') {
            simulator.emitStateReport(outcome.message);
        } else {
            simulator.emitCommandRejection(outcome.message);
        }
    }

    function advancePlannedSequence(receipt: LedCommandReceiptV1): void {
        for (const outcome of receipt.outcomes) {
            if (outcome.kind === 'state_report') {
                nextPlannedSequence = Math.max(nextPlannedSequence, outcome.message.sequence);
            }
        }
    }

    function reportReceiptFailure(
        operation: LedReceiptFailureOperation,
        commandId: string,
        outcome: Exclude<ReturnType<LedCommandReceiptPort['accept']>, { status: 'committed' }>,
    ): void {
        onReceiptFailure?.({
            operation,
            commandId,
            error: outcome.error,
            outcome: outcome.status,
        });
    }
}

function assertScenario(scenario: LedScenarioName): void {
    if (
        scenario !== 'confirm_immediately' &&
        scenario !== 'confirm_delayed' &&
        scenario !== 'reject_command' &&
        scenario !== 'omit_confirmation' &&
        scenario !== 'report_after_timeout'
    ) {
        throw new TypeError('LED scenario must be a supported scenario name.');
    }
}
