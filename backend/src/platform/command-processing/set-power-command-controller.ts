import { randomUUID } from 'node:crypto';

import type {
    AcceptedCommandResponse,
    RejectedCommandResponse,
    SetPowerCommandRequest,
} from '@smart-room/contracts/commands';
import type {
    CommandFailedEvent,
    PlatformEvent,
    PlatformEventSource,
} from '@smart-room/contracts/events';
import type { RoomSnapshotProjection } from '@smart-room/contracts/projections';

import type { EventProcessingResult } from '../event-processing/event-processor';
import type { SetPowerCommandDispatcher } from '../ports/set-power-command-dispatcher';

const setPowerTimeoutMs = 5_000;

export interface CommandTimer {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(timerHandle: unknown): void;
}

export interface CommandDispatchScope {
    run<T>(operation: () => T): T;
    flush(): void;
}

export interface SetPowerCommandRoute {
    deviceId: string;
    target: PlatformEventSource;
    dispatcher: SetPowerCommandDispatcher;
}

export interface SetPowerCommandControllerConfig {
    routes: readonly SetPowerCommandRoute[];
    emitEvent(event: PlatformEvent): EventProcessingResult;
    createDispatchScope(): CommandDispatchScope;
    getRoomSnapshot(): RoomSnapshotProjection;
    clock: { now(): string };
    commandTimer: CommandTimer;
    generateCommandId?: () => string;
    generateEventId?: () => string;
}

export interface SetPowerCommandController {
    requestCommand(
        request: SetPowerCommandRequest,
    ): AcceptedCommandResponse | RejectedCommandResponse;
    reschedulePendingCommands(): void;
    stop(): void;
    onEventProcessed(
        activeCommandIdBeforeEvent: string | undefined,
        event: PlatformEvent,
        result: EventProcessingResult,
    ): void;
}

export function createSetPowerCommandController({
    routes,
    emitEvent,
    createDispatchScope,
    getRoomSnapshot,
    clock,
    commandTimer,
    generateCommandId = randomUUID,
    generateEventId = randomUUID,
}: SetPowerCommandControllerConfig): SetPowerCommandController {
    const timeoutHandles = new Map<string, unknown>();
    const routesByDeviceId = new Map<string, SetPowerCommandRoute>();

    for (const route of routes) {
        if (routesByDeviceId.has(route.deviceId)) {
            throw new RangeError(`Duplicate set.power command route for ${route.deviceId}.`);
        }

        routesByDeviceId.set(route.deviceId, route);
    }

    return {
        requestCommand(request) {
            const commandId = generateCommandId();
            const snapshot = getRoomSnapshot();
            const device = snapshot.devices.find(
                (candidate) => candidate.deviceId === request.deviceId,
            );

            if (!device) {
                return rejected(
                    commandId,
                    'unsupported_command',
                    'Device does not support this command.',
                );
            }

            if (device.commandAvailability.policy === 'block') {
                return rejected(
                    commandId,
                    device.commandAvailability.reason ?? 'command_unavailable',
                    'Commands are not available for this device.',
                );
            }

            if (snapshot.activeCommands.some((command) => command.deviceId === request.deviceId)) {
                const occurredAt = clock.now();
                emitEvent(rejectedCommandEvent(commandId, request, occurredAt, generateEventId));

                return rejected(
                    commandId,
                    'command_already_active',
                    'Device already has an active command.',
                );
            }

            const route = routesByDeviceId.get(request.deviceId);

            if (!route) {
                return rejected(
                    commandId,
                    'unsupported_command',
                    'Device does not support this command.',
                );
            }

            const requestedAt = clock.now();
            const requested = emitEvent({
                eventId: generateEventId(),
                eventType: 'command.requested',
                occurredAt: requestedAt,
                source: 'backend',
                deviceId: request.deviceId,
                commandId,
                payload: { ...request, requestedBy: 'user' },
            });

            if (requested.status !== 'accepted') {
                return rejected(
                    commandId,
                    'command_lifecycle_rejected',
                    'The command could not be accepted by the room state.',
                );
            }

            const dispatchScope = createDispatchScope();
            const dispatchedAt = clock.now();

            try {
                dispatchScope.run(() => route.dispatcher.dispatch({ ...request, commandId }));
            } catch {
                emitEvent({
                    eventId: generateEventId(),
                    eventType: 'command.failed',
                    occurredAt: clock.now(),
                    source: 'backend',
                    deviceId: request.deviceId,
                    commandId,
                    payload: {
                        reason: 'dispatch_failed',
                        message: 'The command could not be dispatched to the device adapter.',
                    },
                });
                dispatchScope.flush();

                return { commandId, status: 'accepted' };
            }

            const dispatched = emitEvent({
                eventId: generateEventId(),
                eventType: 'command.dispatched',
                occurredAt: dispatchedAt,
                source: 'backend',
                deviceId: request.deviceId,
                commandId,
                payload: { commandType: request.commandType, target: route.target },
            });

            if (dispatched.status !== 'accepted') {
                emitEvent({
                    eventId: generateEventId(),
                    eventType: 'command.failed',
                    occurredAt: clock.now(),
                    source: 'backend',
                    deviceId: request.deviceId,
                    commandId,
                    payload: {
                        reason: 'command_lifecycle_rejected',
                        message: 'The command lifecycle could not record adapter dispatch.',
                    },
                });
                dispatchScope.flush();

                return { commandId, status: 'accepted' };
            }

            dispatchScope.flush();
            scheduleTimeout(commandId, request.deviceId);

            return { commandId, status: 'accepted' };
        },
        reschedulePendingCommands() {
            for (const command of getRoomSnapshot().activeCommands) {
                if (command.status === 'pending') {
                    scheduleTimeout(command.commandId, command.deviceId);
                }
            }
        },
        stop() {
            for (const handle of timeoutHandles.values()) {
                commandTimer.clearTimeout(handle);
            }

            timeoutHandles.clear();
        },
        onEventProcessed(activeCommandIdBeforeEvent, event, result) {
            if (result.status !== 'accepted') {
                return;
            }

            clearCompletedTimeout(event.commandId, result.state.activeCommands);
            clearCompletedTimeout(activeCommandIdBeforeEvent, result.state.activeCommands);
        },
    };

    function scheduleTimeout(commandId: string, deviceId: string): void {
        const active = getRoomSnapshot().activeCommands.find(
            (command) => command.commandId === commandId && command.status === 'pending',
        );

        if (!active || active.status !== 'pending' || timeoutHandles.has(commandId)) {
            return;
        }

        const remainingMs = Math.max(
            0,
            setPowerTimeoutMs - (Date.parse(clock.now()) - Date.parse(active.dispatchedAt)),
        );
        timeoutHandles.set(
            commandId,
            commandTimer.setTimeout(() => {
                timeoutHandles.delete(commandId);
                emitEvent({
                    eventId: generateEventId(),
                    eventType: 'command.timed_out',
                    occurredAt: clock.now(),
                    source: 'backend',
                    deviceId,
                    commandId,
                    payload: { timeoutMs: setPowerTimeoutMs, reason: 'confirmation_not_received' },
                });
            }, remainingMs),
        );
    }

    function clearCompletedTimeout(
        commandId: string | undefined,
        activeCommands: RoomSnapshotProjection['activeCommands'],
    ): void {
        if (!commandId || activeCommands.some((command) => command.commandId === commandId)) {
            return;
        }

        const handle = timeoutHandles.get(commandId);

        if (handle !== undefined) {
            commandTimer.clearTimeout(handle);
        }

        timeoutHandles.delete(commandId);
    }
}

function rejected(commandId: string, reason: string, message: string): RejectedCommandResponse {
    return { commandId, status: 'rejected', reason, message };
}

function rejectedCommandEvent(
    commandId: string,
    request: SetPowerCommandRequest,
    occurredAt: string,
    generateEventId: () => string,
): CommandFailedEvent {
    return {
        eventId: generateEventId(),
        eventType: 'command.failed',
        occurredAt,
        source: 'backend',
        deviceId: request.deviceId,
        commandId,
        payload: {
            reason: 'command_already_active',
            message: 'Device already has an active command.',
            commandType: request.commandType,
            requestedState: request.requestedState,
            requestedAt: occurredAt,
        },
    };
}
