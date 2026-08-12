import type { SetPowerCommandRequest } from '@smart-room/contracts/commands';
import type {
    CommandFailedEvent,
    DeviceAvailabilityChangedEvent,
    DeviceHealthChangedEvent,
    DeviceStateReportedEvent,
} from '@smart-room/contracts/events';
import type {
    LedAvailabilityListener,
    LedCommandRejectionListener,
    LedHealthListener,
    LedSetPowerCommand,
    LedStateReportListener,
} from '@smart-room/simulator';

import type { PlatformEventSink } from '../../../platform/ports/event-sink';

export type PlatformSetPowerCommand = SetPowerCommandRequest & {
    commandId: string;
};

export interface LedCommandTransport {
    onStateReport(listener: LedStateReportListener): () => void;
    onCommandRejection(listener: LedCommandRejectionListener): () => void;
    onAvailability(listener: LedAvailabilityListener): () => void;
    onHealth(listener: LedHealthListener): () => void;
    receive(command: LedSetPowerCommand): void;
}

export interface SimulatorLedAdapterConfig {
    led: LedCommandTransport;
    nativeLedId: string;
    platformDeviceId: string;
    emitEvent: PlatformEventSink<
        | DeviceStateReportedEvent
        | CommandFailedEvent
        | DeviceAvailabilityChangedEvent
        | DeviceHealthChangedEvent
    >;
}

export interface SimulatorLedAdapter {
    dispatch(command: PlatformSetPowerCommand): void;
    stop(): void;
}

export function createSimulatorLedAdapter({
    led,
    nativeLedId,
    platformDeviceId,
    emitEvent,
}: SimulatorLedAdapterConfig): SimulatorLedAdapter {
    let hasStopped = false;
    const unsubscribeFromStateReports = led.onStateReport((report) => {
        if (report.deviceId !== nativeLedId) {
            return;
        }

        const event: DeviceStateReportedEvent = {
            eventId: toPlatformEventId(nativeLedId, report.messageId),
            eventType: 'device.state.reported',
            occurredAt: report.reportedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            payload: {
                reportedState: { power: report.reportedState.power },
                reportedAt: report.reportedAt,
            },
        };
        emitEvent(event);
    });
    const unsubscribeFromCommandRejections = led.onCommandRejection((rejection) => {
        if (rejection.deviceId !== nativeLedId) {
            return;
        }

        emitEvent({
            eventId: toPlatformEventId(nativeLedId, rejection.messageId),
            eventType: 'command.failed',
            occurredAt: rejection.rejectedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            commandId: rejection.commandId,
            payload: {
                reason: rejection.reason,
                message: 'The simulated LED rejected the command.',
            },
        });
    });
    const unsubscribeFromAvailability = led.onAvailability((report) => {
        if (report.deviceId !== nativeLedId) {
            return;
        }

        emitEvent({
            eventId: toPlatformEventId(nativeLedId, report.messageId),
            eventType: 'device.availability.changed',
            occurredAt: report.reportedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            payload: {
                previousAvailability: report.previousAvailability,
                availability: report.availability,
                reason: 'simulator_reported',
            },
        });
    });
    const unsubscribeFromHealth = led.onHealth((report) => {
        if (report.deviceId !== nativeLedId) {
            return;
        }

        emitEvent({
            eventId: toPlatformEventId(nativeLedId, report.messageId),
            eventType: 'device.health.changed',
            occurredAt: report.reportedAt,
            source: 'simulator-adapter',
            deviceId: platformDeviceId,
            payload: {
                previousHealth: report.previousHealth,
                health: report.health,
                reason: report.reason,
            },
        });
    });

    return {
        dispatch(command) {
            if (hasStopped) {
                throw new Error('Simulator LED adapter has been stopped.');
            }

            if (command.deviceId !== platformDeviceId) {
                throw new RangeError(`LED command deviceId must be ${platformDeviceId}.`);
            }

            led.receive({
                messageType: 'led.command.set_power',
                commandId: command.commandId,
                deviceId: nativeLedId,
                commandType: 'set.power',
                requestedState: { power: command.requestedState.power },
            });
        },
        stop() {
            hasStopped = true;
            unsubscribeFromStateReports();
            unsubscribeFromCommandRejections();
            unsubscribeFromAvailability();
            unsubscribeFromHealth();
        },
    };
}

function toPlatformEventId(nativeDeviceId: string, messageId: string): string {
    return `simulator-adapter:${nativeDeviceId}:${messageId}`;
}
