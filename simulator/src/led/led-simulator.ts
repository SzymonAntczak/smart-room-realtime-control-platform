import { randomUUID } from 'node:crypto';

import { assertValidDeviceNativeTimestamp } from '../device-native-timestamp';

export type LedPower = 'on' | 'off';

export interface LedSetPowerCommand {
    readonly messageType: 'led.command.set_power';
    readonly commandId: string;
    readonly deviceId: string;
    readonly commandType: 'set.power';
    readonly requestedState: {
        readonly power: LedPower;
    };
}

export interface LedStateReport {
    readonly messageId: string;
    readonly messageType: 'led.state.reported';
    readonly deviceId: string;
    readonly sequence: number;
    readonly reportedState: {
        readonly power: LedPower;
    };
    readonly reportedAt: string;
}

export interface LedCommandRejection {
    readonly messageId: string;
    readonly messageType: 'led.command.rejected';
    readonly commandId: string;
    readonly deviceId: string;
    readonly reason: 'command_rejected';
    readonly rejectedAt: string;
}
export interface LedAvailabilityReport {
    readonly messageId: string;
    readonly messageType: 'led.availability.changed';
    readonly deviceId: string;
    readonly availability: 'online' | 'offline';
    readonly previousAvailability: 'online' | 'offline' | 'unknown';
    readonly reportedAt: string;
}
export interface LedHealthReport {
    readonly messageId: string;
    readonly messageType: 'led.health.changed';
    readonly deviceId: string;
    readonly health: 'healthy' | 'degraded';
    readonly previousHealth: 'healthy' | 'degraded' | 'unknown';
    readonly reason: string;
    readonly reportedAt: string;
}

export interface LedSimulatorConfig {
    readonly deviceId: string;
    readonly initialPower: LedPower;
    readonly generateMessageId?: () => string;
}

export type LedCommandListener = (command: LedSetPowerCommand) => void;
export type LedStateReportListener = (report: LedStateReport) => void;
export type LedCommandRejectionListener = (rejection: LedCommandRejection) => void;
export type LedAvailabilityListener = (report: LedAvailabilityReport) => void;
export type LedHealthListener = (report: LedHealthReport) => void;

export interface LedSimulator {
    onCommand(listener: LedCommandListener): () => void;
    onStateReport(listener: LedStateReportListener): () => void;
    onCommandRejection(listener: LedCommandRejectionListener): () => void;
    onAvailability(listener: LedAvailabilityListener): () => void;
    onHealth(listener: LedHealthListener): () => void;
    receive(command: LedSetPowerCommand): void;
    reportState(power: LedPower, reportedAt: string): LedStateReport;
    emitStateReport(report: LedStateReport): LedStateReport;
    rejectCommand(command: LedSetPowerCommand, rejectedAt: string): LedCommandRejection;
    emitCommandRejection(rejection: LedCommandRejection): LedCommandRejection;
    reportAvailability(
        availability: 'online' | 'offline',
        reportedAt: string,
    ): LedAvailabilityReport;
    reportHealth(
        health: 'healthy' | 'degraded',
        reason: string,
        reportedAt: string,
    ): LedHealthReport;
    getObservedPower(): LedPower;
}

export function createLedSimulator(config: LedSimulatorConfig): LedSimulator {
    assertNonEmpty(config.deviceId, 'LED deviceId');
    assertLedPower(config.initialPower);

    const commandListeners = new Set<LedCommandListener>();
    const reportListeners = new Set<LedStateReportListener>();
    const rejectionListeners = new Set<LedCommandRejectionListener>();
    const availabilityListeners = new Set<LedAvailabilityListener>();
    const healthListeners = new Set<LedHealthListener>();
    let observedPower = config.initialPower;
    let stateReportSequence = 0;
    const generateMessageId = config.generateMessageId ?? randomUUID;
    let observedAvailability: LedAvailabilityReport['previousAvailability'] = 'unknown';
    let observedHealth: LedHealthReport['previousHealth'] = 'unknown';

    return {
        onCommand(listener) {
            commandListeners.add(listener);

            return () => commandListeners.delete(listener);
        },
        onStateReport(listener) {
            reportListeners.add(listener);

            return () => reportListeners.delete(listener);
        },
        onCommandRejection(listener) {
            rejectionListeners.add(listener);

            return () => rejectionListeners.delete(listener);
        },
        onAvailability(listener) {
            availabilityListeners.add(listener);

            return () => availabilityListeners.delete(listener);
        },
        onHealth(listener) {
            healthListeners.add(listener);

            return () => healthListeners.delete(listener);
        },
        receive(command) {
            assertCommand(command, config.deviceId);
            emit(commandListeners, command);
        },
        reportState(power, reportedAt) {
            assertLedPower(power);
            assertTimestamp(reportedAt, 'LED state report reportedAt');
            const report: LedStateReport = {
                messageId: generateMessageId(),
                messageType: 'led.state.reported',
                deviceId: config.deviceId,
                sequence: ++stateReportSequence,
                reportedState: { power },
                reportedAt,
            };
            observedPower = report.reportedState.power;
            emit(reportListeners, report);

            return report;
        },
        emitStateReport(report) {
            assertStateReport(report, config.deviceId);
            observedPower = report.reportedState.power;
            stateReportSequence = Math.max(stateReportSequence, report.sequence);
            emit(reportListeners, report);

            return report;
        },
        rejectCommand(command, rejectedAt) {
            assertCommand(command, config.deviceId);
            assertTimestamp(rejectedAt, 'LED command rejection rejectedAt');
            const rejection: LedCommandRejection = {
                messageId: generateMessageId(),
                messageType: 'led.command.rejected',
                commandId: command.commandId,
                deviceId: config.deviceId,
                reason: 'command_rejected',
                rejectedAt,
            };
            emit(rejectionListeners, rejection);

            return rejection;
        },
        emitCommandRejection(rejection) {
            assertCommandRejection(rejection, config.deviceId);
            emit(rejectionListeners, rejection);

            return rejection;
        },
        reportAvailability(availability, reportedAt) {
            assertTimestamp(reportedAt, 'LED availability reportedAt');
            const report: LedAvailabilityReport = {
                messageId: generateMessageId(),
                messageType: 'led.availability.changed',
                deviceId: config.deviceId,
                availability,
                previousAvailability: observedAvailability,
                reportedAt,
            };
            observedAvailability = report.availability;
            emit(availabilityListeners, report);

            return report;
        },
        reportHealth(health, reason, reportedAt) {
            assertNonEmpty(reason, 'LED health reason');
            assertTimestamp(reportedAt, 'LED health reportedAt');
            const report: LedHealthReport = {
                messageId: generateMessageId(),
                messageType: 'led.health.changed',
                deviceId: config.deviceId,
                health,
                previousHealth: observedHealth,
                reason,
                reportedAt,
            };
            observedHealth = report.health;
            emit(healthListeners, report);

            return report;
        },
        getObservedPower() {
            return observedPower;
        },
    };
}

function assertStateReport(report: LedStateReport, expectedDeviceId: string): void {
    assertNonEmpty(report.messageId, 'LED state report messageId');

    if (report.messageType !== 'led.state.reported') {
        throw new TypeError('LED state report messageType must be led.state.reported.');
    }

    if (report.deviceId !== expectedDeviceId) {
        throw new RangeError(`LED state report deviceId must be ${expectedDeviceId}.`);
    }

    if (!Number.isSafeInteger(report.sequence) || report.sequence < 1) {
        throw new TypeError('LED state report sequence must be a positive safe integer.');
    }

    assertLedPower(report.reportedState.power);
    assertTimestamp(report.reportedAt, 'LED state report reportedAt');
}

function assertCommandRejection(rejection: LedCommandRejection, expectedDeviceId: string): void {
    assertNonEmpty(rejection.messageId, 'LED command rejection messageId');

    if (rejection.messageType !== 'led.command.rejected') {
        throw new TypeError('LED command rejection messageType must be led.command.rejected.');
    }

    assertNonEmpty(rejection.commandId, 'LED command rejection commandId');

    if (rejection.deviceId !== expectedDeviceId) {
        throw new RangeError(`LED command rejection deviceId must be ${expectedDeviceId}.`);
    }

    if (rejection.reason !== 'command_rejected') {
        throw new TypeError('LED command rejection reason must be command_rejected.');
    }

    assertTimestamp(rejection.rejectedAt, 'LED command rejection rejectedAt');
}

function assertCommand(command: LedSetPowerCommand, expectedDeviceId: string): void {
    if (command.messageType !== 'led.command.set_power') {
        throw new TypeError('LED command messageType must be led.command.set_power.');
    }

    assertNonEmpty(command.commandId, 'LED commandId');

    if (command.deviceId !== expectedDeviceId) {
        throw new RangeError(`LED command deviceId must be ${expectedDeviceId}.`);
    }

    if (command.commandType !== 'set.power') {
        throw new TypeError('LED commandType must be set.power.');
    }

    assertLedPower(command.requestedState.power);
}

function assertLedPower(power: LedPower): void {
    if (power !== 'on' && power !== 'off') {
        throw new TypeError('LED power must be on or off.');
    }
}

function assertNonEmpty(value: string, label: string): void {
    if (value.trim().length === 0) {
        throw new TypeError(`${label} must be a non-empty string.`);
    }
}

function assertTimestamp(timestamp: string, label: string): void {
    assertValidDeviceNativeTimestamp(timestamp, label);
}

function emit<Message>(listeners: ReadonlySet<(message: Message) => void>, message: Message): void {
    for (const listener of listeners) {
        listener(structuredClone(message));
    }
}
