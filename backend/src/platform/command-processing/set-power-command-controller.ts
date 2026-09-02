import { randomUUID } from 'node:crypto';

import type {
    AcceptedCommandResponse,
    PreAdmissionCommandErrorResponse,
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
import type {
    CommandDispatchResult,
    SetPowerCommandDispatcher,
} from '../ports/set-power-command-dispatcher';
import type {
    CommandDispatchOutboxIntent,
    CommandDispatchOutboxState,
} from '../storage/room-storage';

const setPowerTimeoutMs = 5_000;
const retryIntervalMs = 500;

export interface CommandTimer {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(timerHandle: unknown): void;
}

export interface CommandDispatchScope {
    run<T>(operation: () => T): T;
    flush(): void;
}

export type CommandOutboxMutation =
    | { kind: 'upsert'; intent: CommandDispatchOutboxIntent }
    | { kind: 'close'; commandId: string; closedAt: string };

export interface SetPowerCommandRoute {
    deviceId: string;
    target: PlatformEventSource;
    dispatcher: SetPowerCommandDispatcher;
    automaticRetry?: 'durable_source_receipt' | 'disabled';
}

export interface SetPowerCommandControllerConfig {
    routes: readonly SetPowerCommandRoute[];
    emitEvent(
        event: PlatformEvent,
        outboxMutation?: CommandOutboxMutation,
    ): EventProcessingResult | undefined;
    commitOutboxMutation?(mutation: CommandOutboxMutation): void;
    listDurableOutboxIntents?(): readonly CommandDispatchOutboxIntent[];
    createDispatchScope(): CommandDispatchScope;
    getRoomSnapshot(): RoomSnapshotProjection;
    scheduleImmediate?(callback: () => void): void;
    clock: { now(): string };
    commandTimer: CommandTimer;
    generateCommandId?: () => string;
    generateEventId?: () => string;
}

export interface SetPowerCommandController {
    requestCommand(
        request: SetPowerCommandRequest,
    ): AcceptedCommandResponse | RejectedCommandResponse | PreAdmissionCommandErrorResponse;
    reschedulePendingCommands(): void;
    reconcileOutboxAfterRecovery(): void;
    stop(): void;
    onEventProcessed(
        activeCommandIdBeforeEvent: string | undefined,
        event: PlatformEvent,
        result: EventProcessingResult,
    ): void;
}

interface DispatchWork {
    commandId: string;
    request: SetPowerCommandRequest;
    route: SetPowerCommandRoute;
    durability: 'durable' | 'volatile';
    lifecycleDurability: 'durable' | 'volatile';
    requestedAt: string;
    delivery?: Extract<
        RoomSnapshotProjection['activeCommands'][number],
        { status: 'pending' }
    >['delivery'];
}

export function createSetPowerCommandController({
    routes,
    emitEvent,
    commitOutboxMutation,
    listDurableOutboxIntents = () => [],
    createDispatchScope,
    getRoomSnapshot,
    scheduleImmediate = (callback) => callback(),
    clock,
    commandTimer,
    generateCommandId = randomUUID,
    generateEventId = randomUUID,
}: SetPowerCommandControllerConfig): SetPowerCommandController {
    const timeoutHandles = new Map<string, unknown>();
    const retryHandles = new Map<string, unknown>();
    const workByCommandId = new Map<string, DispatchWork>();
    const routesByDeviceId = new Map<string, SetPowerCommandRoute>();

    for (const route of routes) {
        if (routesByDeviceId.has(route.deviceId)) {
            throw new RangeError(`Duplicate set.power command route for ${route.deviceId}.`);
        }

        routesByDeviceId.set(route.deviceId, route);
    }

    return {
        requestCommand(request) {
            const snapshot = getRoomSnapshot();

            if (snapshot.platform.storage.status === 'recovering') {
                return {
                    error: 'platform_recovering',
                    message:
                        'Command admission is temporarily unavailable during storage recovery.',
                    retryable: true,
                };
            }

            const device = snapshot.devices.find(
                (candidate) => candidate.deviceId === request.deviceId,
            );

            if (!device) {
                return { error: 'unknown_device', message: 'Device was not found.' };
            }

            const commandId = generateCommandId();
            const requestedAt = clock.now();
            const route = routesByDeviceId.get(request.deviceId);
            const rejection = rejectionFor(
                device.commandAvailability,
                snapshot,
                request.deviceId,
                route,
            );

            if (rejection) {
                emitEvent(
                    rejectedCommandEvent(
                        commandId,
                        request,
                        requestedAt,
                        rejection.reason,
                        rejection.message,
                        generateEventId,
                    ),
                );

                return admittedRejection(commandId, rejection, getRoomSnapshot());
            }

            if (!route) {
                throw new Error('Command route was missing after admission validation.');
            }

            const durableAdmission = snapshot.platform.storage.status === 'available';
            const admission = emitEvent(
                {
                    eventId: generateEventId(),
                    eventType: 'command.requested',
                    occurredAt: requestedAt,
                    source: 'backend',
                    deviceId: request.deviceId,
                    commandId,
                    payload: { ...request, requestedBy: 'user' },
                },
                durableAdmission
                    ? {
                          kind: 'upsert',
                          intent: outboxIntent(commandId, request, route, requestedAt, 'ready'),
                      }
                    : undefined,
            );

            if (!admission || admission.status !== 'accepted') {
                return {
                    commandId,
                    status: 'rejected',
                    reason: 'command_lifecycle_rejected',
                    message: 'The command could not be accepted by the room state.',
                    durability: durableAdmission ? 'durable' : 'volatile',
                    lifecycleDurability: durableAdmission ? 'durable' : 'volatile',
                };
            }

            const active = admission.state.activeCommands.find(
                (command) => command.commandId === commandId,
            );

            workByCommandId.set(commandId, {
                commandId,
                request,
                route,
                durability: active?.durability ?? (durableAdmission ? 'durable' : 'volatile'),
                lifecycleDurability:
                    active?.lifecycleDurability ?? (durableAdmission ? 'durable' : 'volatile'),
                requestedAt,
            });
            scheduleImmediate(() => attemptDispatch(commandId));

            return {
                commandId,
                status: 'accepted',
                durability: active?.durability ?? (durableAdmission ? 'durable' : 'volatile'),
                lifecycleDurability:
                    active?.lifecycleDurability ?? (durableAdmission ? 'durable' : 'volatile'),
            };
        },
        reschedulePendingCommands() {
            for (const command of getRoomSnapshot().activeCommands) {
                if (command.status === 'pending') {
                    scheduleTimeout(command.commandId, command.deviceId);
                }
            }
        },
        reconcileOutboxAfterRecovery() {
            const snapshot = getRoomSnapshot();
            const candidates = new Map<
                string,
                { work: DispatchWork; requiresRetryCapability: boolean }
            >();

            for (const intent of listDurableOutboxIntents()) {
                if (intent.state === 'closed') {
                    continue;
                }

                const active = snapshot.activeCommands.find(
                    (command) => command.commandId === intent.commandId,
                );

                if (!active) {
                    const conflictingVolatile = snapshot.activeCommands.some(
                        (command) =>
                            command.deviceId === intent.deviceId &&
                            command.commandId !== intent.commandId &&
                            command.lifecycleDurability === 'volatile',
                    );

                    if (conflictingVolatile) {
                        workByCommandId.delete(intent.commandId);
                        continue;
                    }

                    workByCommandId.delete(intent.commandId);
                    commitOutboxMutation?.({
                        kind: 'close',
                        commandId: intent.commandId,
                        closedAt: clock.now(),
                    });
                    continue;
                }

                if (
                    active.status === 'pending' &&
                    Date.parse(active.delivery.deadlineAt) <= Date.parse(clock.now())
                ) {
                    emitTimeout(active.commandId, active.deviceId, active.delivery.deadlineAt);
                    continue;
                }

                if (intent.state === 'delivered') {
                    workByCommandId.delete(intent.commandId);

                    if (active.status === 'pending') {
                        scheduleTimeout(active.commandId, active.deviceId);
                    }

                    continue;
                }

                const route = routesByDeviceId.get(intent.deviceId);

                if (!route || route.target !== intent.target) {
                    workByCommandId.delete(intent.commandId);
                    commitOutboxMutation?.({
                        kind: 'close',
                        commandId: intent.commandId,
                        closedAt: clock.now(),
                    });
                    continue;
                }

                const work = {
                    commandId: intent.commandId,
                    request: {
                        deviceId: intent.deviceId,
                        commandType: intent.commandType,
                        requestedState: { power: intent.requestedPower },
                    },
                    route,
                    durability: 'durable',
                    lifecycleDurability: active.lifecycleDurability,
                    requestedAt: active.requestedAt,
                    delivery: active.status === 'pending' ? active.delivery : undefined,
                } satisfies DispatchWork;
                workByCommandId.set(intent.commandId, work);
                candidates.set(intent.commandId, {
                    work,
                    requiresRetryCapability:
                        intent.state === 'uncertain' || active.status === 'pending',
                });
            }

            for (const { work, requiresRetryCapability } of candidates.values()) {
                const active = snapshot.activeCommands.find(
                    (command) => command.commandId === work.commandId,
                );

                if (active?.status === 'pending') {
                    scheduleTimeout(active.commandId, active.deviceId);
                }

                if (!active || !workByCommandId.has(work.commandId)) {
                    continue;
                }

                if (
                    requiresRetryCapability &&
                    work.route.automaticRetry !== 'durable_source_receipt'
                ) {
                    continue;
                }

                scheduleImmediate(() => attemptDispatch(work.commandId));
            }
        },
        stop() {
            for (const handle of [...timeoutHandles.values(), ...retryHandles.values()]) {
                commandTimer.clearTimeout(handle);
            }

            timeoutHandles.clear();
            retryHandles.clear();
            workByCommandId.clear();
        },
        onEventProcessed(activeCommandIdBeforeEvent, event, result) {
            if (result.status !== 'accepted') {
                return;
            }

            clearCompletedTimers(event.commandId, result.state.activeCommands);
            clearCompletedTimers(activeCommandIdBeforeEvent, result.state.activeCommands);
            const active = event.commandId
                ? result.state.activeCommands.find(
                      (command) => command.commandId === event.commandId,
                  )
                : undefined;

            if (active?.status === 'pending') {
                scheduleTimeout(active.commandId, active.deviceId);
            }
        },
    };

    function attemptDispatch(commandId: string): void {
        const work = workByCommandId.get(commandId);

        if (!work) {
            return;
        }

        const snapshot = getRoomSnapshot();
        const active = activeCommandForWork(snapshot, work);

        if (work.durability === 'durable' && snapshot.platform.storage.status !== 'available') {
            return;
        }

        if (
            active.status === 'pending' &&
            Date.parse(active.delivery.deadlineAt) <= Date.parse(clock.now())
        ) {
            emitTimeout(active.commandId, active.deviceId, active.delivery.deadlineAt);

            return;
        }

        const attemptedAt = clock.now();
        const dispatchScope = createDispatchScope();
        const result: unknown = dispatchScope.run(() =>
            work.route.dispatcher.dispatch(
                { ...work.request, commandId },
                {
                    attemptedAt,
                    deliveryKind: work.durability === 'durable' ? 'durable_outbox' : 'volatile',
                },
            ),
        );

        if (!isCommandDispatchResult(result)) {
            throw new Error('Dispatcher returned an invalid command handoff result.');
        }

        const mutation = (
            state: CommandDispatchOutboxState,
            fields: Partial<CommandDispatchOutboxIntent>,
        ) =>
            work.durability === 'durable'
                ? {
                      kind: 'upsert' as const,
                      intent: {
                          ...outboxIntent(
                              commandId,
                              work.request,
                              work.route,
                              active.requestedAt,
                              state,
                          ),
                          ...fields,
                      },
                  }
                : undefined;

        if (result.status === 'handed_off') {
            work.delivery = {
                status: 'handed_off',
                dispatchedAt: result.handedOffAt,
                deadlineAt:
                    active.status === 'pending'
                        ? active.delivery.deadlineAt
                        : new Date(
                              Date.parse(result.handedOffAt) + setPowerTimeoutMs,
                          ).toISOString(),
            };
            emitEvent(
                {
                    eventId: generateEventId(),
                    eventType: 'command.dispatched',
                    occurredAt: result.handedOffAt,
                    source: 'backend',
                    deviceId: work.request.deviceId,
                    commandId,
                    payload: { commandType: work.request.commandType, target: work.route.target },
                },
                mutation('delivered', {
                    attemptedAt,
                    handedOffAt: result.handedOffAt,
                    deadlineAt: work.delivery.deadlineAt,
                }),
            );
        } else if (result.status === 'not_handed_off') {
            emitEvent(
                {
                    eventId: generateEventId(),
                    eventType: 'command.failed',
                    occurredAt: attemptedAt,
                    source: 'backend',
                    deviceId: work.request.deviceId,
                    commandId,
                    payload: { reason: result.reason, message: result.message },
                },
                mutation('closed', { attemptedAt, closedAt: attemptedAt }),
            );
        } else {
            const firstAttemptedAt =
                active.status === 'pending'
                    ? active.delivery.status === 'uncertain'
                        ? active.delivery.firstAttemptedAt
                        : active.delivery.dispatchedAt
                    : attemptedAt;
            const deadlineAt =
                active.status === 'pending'
                    ? active.delivery.deadlineAt
                    : new Date(Date.parse(firstAttemptedAt) + setPowerTimeoutMs).toISOString();
            work.delivery = { status: 'uncertain', firstAttemptedAt, deadlineAt };
            const uncertaintyMutation = mutation('uncertain', {
                attemptedAt,
                firstAttemptedAt,
                deadlineAt,
                nextAttemptAt: new Date(Date.parse(attemptedAt) + retryIntervalMs).toISOString(),
            });

            if (active.status === 'accepted') {
                emitEvent(
                    {
                        eventId: generateEventId(),
                        eventType: 'command.delivery_uncertain',
                        occurredAt: attemptedAt,
                        source: 'backend',
                        deviceId: work.request.deviceId,
                        commandId,
                        payload: {
                            commandType: work.request.commandType,
                            target: work.route.target,
                            reason: result.reason,
                        },
                    },
                    uncertaintyMutation,
                );
            } else if (uncertaintyMutation) {
                commitOutboxMutation?.(uncertaintyMutation);
            }

            scheduleTimeout(commandId, work.request.deviceId);

            if (
                work.route.automaticRetry === 'durable_source_receipt' &&
                work.durability === 'durable'
            ) {
                scheduleRetryAt(
                    commandId,
                    uncertaintyMutation?.intent.nextAttemptAt ?? attemptedAt,
                );
            }
        }

        dispatchScope.flush();
        const pending = getRoomSnapshot().activeCommands.find(
            (command) => command.commandId === commandId,
        );

        if (pending?.status === 'pending') {
            scheduleTimeout(commandId, pending.deviceId);
        }
    }

    function scheduleRetryAt(commandId: string, nextAttemptAt: string): void {
        if (retryHandles.has(commandId)) {
            return;
        }

        const delayMs = Math.max(0, Date.parse(nextAttemptAt) - Date.parse(clock.now()));

        retryHandles.set(
            commandId,
            commandTimer.setTimeout(() => {
                retryHandles.delete(commandId);
                attemptDispatch(commandId);
            }, delayMs),
        );
    }

    function scheduleTimeout(commandId: string, deviceId: string): void {
        const active = getRoomSnapshot().activeCommands.find(
            (command) => command.commandId === commandId && command.status === 'pending',
        );

        if (!active || active.status !== 'pending' || timeoutHandles.has(commandId)) {
            return;
        }

        const remainingMs = Math.max(
            0,
            Date.parse(active.delivery.deadlineAt) - Date.parse(clock.now()),
        );

        if (remainingMs === 0) {
            emitTimeout(commandId, deviceId, active.delivery.deadlineAt);

            return;
        }

        timeoutHandles.set(
            commandId,
            commandTimer.setTimeout(() => {
                timeoutHandles.delete(commandId);
                emitTimeout(commandId, deviceId, active.delivery.deadlineAt);
            }, remainingMs),
        );
    }

    function emitTimeout(commandId: string, deviceId: string, deadlineAt: string): void {
        emitEvent({
            eventId: generateEventId(),
            eventType: 'command.timed_out',
            occurredAt: deadlineAt,
            source: 'backend',
            deviceId,
            commandId,
            payload: { timeoutMs: setPowerTimeoutMs, reason: 'confirmation_not_received' },
        });
    }

    function clearCompletedTimers(
        commandId: string | undefined,
        activeCommands: RoomSnapshotProjection['activeCommands'],
    ): void {
        if (!commandId || activeCommands.some((command) => command.commandId === commandId)) {
            return;
        }

        for (const handles of [timeoutHandles, retryHandles]) {
            const handle = handles.get(commandId);

            if (handle !== undefined) {
                commandTimer.clearTimeout(handle);
            }

            handles.delete(commandId);
        }

        workByCommandId.delete(commandId);
    }
}

function activeCommandForWork(
    snapshot: RoomSnapshotProjection,
    work: DispatchWork,
): RoomSnapshotProjection['activeCommands'][number] {
    const active = snapshot.activeCommands.find((command) => command.commandId === work.commandId);

    if (active) {
        return active;
    }

    return work.delivery
        ? {
              commandId: work.commandId,
              deviceId: work.request.deviceId,
              commandType: work.request.commandType,
              requestedState: work.request.requestedState,
              requestedAt: work.requestedAt,
              durability: work.durability,
              lifecycleDurability: work.lifecycleDurability,
              status: 'pending',
              delivery: work.delivery,
          }
        : {
              commandId: work.commandId,
              deviceId: work.request.deviceId,
              commandType: work.request.commandType,
              requestedState: work.request.requestedState,
              requestedAt: work.requestedAt,
              durability: work.durability,
              lifecycleDurability: work.lifecycleDurability,
              status: 'accepted',
          };
}

function isCommandDispatchResult(value: unknown): value is CommandDispatchResult {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('status' in value)) {
        return false;
    }

    if (value.status === 'handed_off') {
        return 'handedOffAt' in value && typeof value.handedOffAt === 'string';
    }

    if (value.status === 'not_handed_off') {
        return (
            'reason' in value &&
            typeof value.reason === 'string' &&
            'message' in value &&
            typeof value.message === 'string'
        );
    }

    return value.status === 'uncertain' && 'reason' in value && typeof value.reason === 'string';
}

function rejectionFor(
    availability: RoomSnapshotProjection['devices'][number]['commandAvailability'],
    snapshot: RoomSnapshotProjection,
    deviceId: string,
    route: SetPowerCommandRoute | undefined,
): { reason: string; message: string } | undefined {
    if (availability.policy === 'block') {
        return {
            reason: availability.reason ?? 'command_unavailable',
            message: 'Commands are not available for this device.',
        };
    }

    if (snapshot.activeCommands.some((command) => command.deviceId === deviceId)) {
        return {
            reason: 'command_already_active',
            message: 'Device already has an active command.',
        };
    }

    if (!route) {
        return { reason: 'unsupported_command', message: 'Device does not support this command.' };
    }

    return undefined;
}

function admittedRejection(
    commandId: string,
    rejection: { reason: string; message: string },
    snapshot: RoomSnapshotProjection,
): RejectedCommandResponse {
    const command = snapshot.recentCommands.find((candidate) => candidate.commandId === commandId);

    return {
        commandId,
        status: 'rejected',
        reason: rejection.reason,
        message: rejection.message,
        durability: command?.durability ?? 'volatile',
        lifecycleDurability: command?.lifecycleDurability ?? 'volatile',
    };
}

function outboxIntent(
    commandId: string,
    request: SetPowerCommandRequest,
    route: SetPowerCommandRoute,
    createdAt: string,
    state: CommandDispatchOutboxState,
): CommandDispatchOutboxIntent {
    return {
        commandId,
        deviceId: request.deviceId,
        commandType: request.commandType,
        requestedPower: request.requestedState.power,
        target: route.target,
        state,
        createdAt,
    };
}

function rejectedCommandEvent(
    commandId: string,
    request: SetPowerCommandRequest,
    occurredAt: string,
    reason: string,
    message: string,
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
            reason,
            message,
            commandType: request.commandType,
            requestedState: request.requestedState,
            requestedAt: occurredAt,
        },
    };
}
