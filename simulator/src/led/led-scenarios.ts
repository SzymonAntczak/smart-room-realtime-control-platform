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

export interface LedScenarioConfig<TimerHandle = unknown> extends LedSimulatorConfig {
    readonly scenario: LedScenarioName;
    readonly clock: LedScenarioClock;
    readonly scheduler: LedScenarioScheduler<TimerHandle>;
}

export interface LedScenario extends Pick<LedSimulator, 'getObservedPower'> {
    onCommand(listener: LedCommandListener): () => void;
    onStateReport(listener: LedStateReportListener): () => void;
    onCommandRejection(listener: LedCommandRejectionListener): () => void;
    onAvailability(listener: LedAvailabilityListener): () => void;
    onHealth(listener: LedHealthListener): () => void;
    receive(command: LedSetPowerCommand): void;
    reportAvailability(
        availability: 'online' | 'offline',
        reportedAt: string,
    ): LedAvailabilityReport;
    reportHealth(
        health: 'healthy' | 'degraded',
        reason: string,
        reportedAt: string,
    ): LedHealthReport;
    setNextCommandScenario(scenario: LedScenarioName): void;
    stop(): void;
}

export function createLedScenario<TimerHandle = unknown>({
    scenario: defaultScenario,
    clock,
    scheduler,
    ...simulatorConfig
}: LedScenarioConfig<TimerHandle>): LedScenario {
    assertScenario(defaultScenario);
    const simulator = createLedSimulator(simulatorConfig);
    let nextScenario = defaultScenario;

    const scheduledTimers = new Set<TimerHandle>();
    const unsubscribeFromCommands = simulator.onCommand((command) => {
        const scenario = nextScenario;
        nextScenario = defaultScenario;
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

    return {
        ...simulator,
        setNextCommandScenario(scenario) {
            assertScenario(scenario);
            nextScenario = scenario;
        },
        stop() {
            unsubscribeFromCommands();
            for (const timerHandle of scheduledTimers) {
                scheduler.clearTimeout(timerHandle);
            }
            scheduledTimers.clear();
        },
    };

    function scheduleReport(command: LedSetPowerCommand, delayMs: number): void {
        const timerHandle = scheduler.setTimeout(() => {
            scheduledTimers.delete(timerHandle);
            simulator.reportState(command.requestedState.power, clock.now());
        }, delayMs);
        scheduledTimers.add(timerHandle);
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
