import {
    createLedSimulator,
    type LedCommandListener,
    type LedCommandRejectionListener,
    type LedSetPowerCommand,
    type LedSimulator,
    type LedSimulatorConfig,
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
}

export interface LedScenarioConfig<TimerHandle = unknown> extends LedSimulatorConfig {
    readonly scenario: LedScenarioName;
    readonly clock: LedScenarioClock;
    readonly scheduler: LedScenarioScheduler<TimerHandle>;
}

export interface LedScenario extends Pick<LedSimulator, 'getObservedPower'> {
    onCommand(listener: LedCommandListener): () => void;
    onStateReport(listener: LedStateReportListener): () => void;
    onCommandRejection(listener: LedCommandRejectionListener): () => void;
    receive(command: LedSetPowerCommand): void;
}

export function createLedScenario<TimerHandle = unknown>({
    scenario,
    clock,
    scheduler,
    ...simulatorConfig
}: LedScenarioConfig<TimerHandle>): LedScenario {
    assertScenario(scenario);
    const simulator = createLedSimulator(simulatorConfig);

    simulator.onCommand((command) => {
        switch (scenario) {
            case 'confirm_immediately':
                simulator.reportState(command.requestedState.power, clock.now());
                return;
            case 'confirm_delayed':
                scheduleReport(command, 2_000);
                return;
            case 'reject_command':
                simulator.rejectCommand(command, clock.now());
                return;
            case 'omit_confirmation':
                return;
            case 'report_after_timeout':
                scheduleReport(command, 6_000);
                return;
        }
    });

    return simulator;

    function scheduleReport(command: LedSetPowerCommand, delayMs: number): void {
        scheduler.setTimeout(() => {
            simulator.reportState(command.requestedState.power, clock.now());
        }, delayMs);
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
